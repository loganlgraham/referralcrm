import { NextRequest, NextResponse } from 'next/server';
import { differenceInDays } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { updateStatusSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { calculateReferralFeeDue } from '@/utils/referral';
import { DEFAULT_AGENT_COMMISSION_BPS, DEFAULT_REFERRAL_FEE_BPS } from '@/constants/referrals';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';
import { inferStateFromPostalCode } from '@/utils/location';
import { calculateBusinessMinutesBetween } from '@/utils/sla-insights';
import { createAdminNotifications } from '@/lib/server/notifications';
import { maybeNotifyAdminsOnUpdateRequestResponse } from '@/lib/server/update-request-response';
import { hasAhaOosAgentAttached } from '@/lib/server/auto-update-reminders';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import { mapReferralStatusToDealStatus } from '@/lib/server/referral-deal-status-mapper';
import { type ReferralStatus } from '@/constants/referrals';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { getReferralAppBaseUrl } from '@/lib/referral-links';
import { createNPSToken } from '@/lib/server/nps';
import {
  deriveReferralStatusFromSides,
  getAgentIdForSide,
  isSellSide,
  pickPrimarySideForReferral,
  resolveAgentSideForReferral,
  type ReferralSide,
} from '@/lib/server/referral-sides';

interface Params {
  params: { id: string };
}

const PRE_CONTRACT_STATUSES = new Set(['New Lead', 'Paired', 'In Communication', 'Active Lead', 'Showing Homes']);

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  if (parsed.data.createNewDeal && parsed.data.status !== 'Under Contract') {
    return NextResponse.json(
      { error: { createNewDeal: ['Deal creation is only supported when moving Under Contract.'] } },
      { status: 400 }
    );
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId ahaDesignation')
    .populate('buySideAgent', 'userId ahaDesignation')
    .populate('sellSideAgent', 'userId ahaDesignation')
    .populate('lender', 'userId name');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (
    !canManageReferral(session, {
      assignedAgent: referral.assignedAgent,
      buySideAgent: referral.buySideAgent,
      sellSideAgent: referral.sellSideAgent,
      lender: referral.lender,
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const now = new Date();
  const isAgentOrigin = referral.origin === 'agent';
  const isAgitDeal = (referral.assignedAgent as any)?.ahaDesignation === 'AGIT';
  const isNoFeeDeal = isAgentOrigin || isAgitDeal;
  let currentAgentId: string | null = null;
  if (session.user.role === 'agent') {
    const currentAgent = await Agent.findOne({ userId: session.user.id }).select('_id').lean<{ _id: unknown } | null>();
    currentAgentId = currentAgent?._id ? String(currentAgent._id) : null;
  }

  let sideFromAssignedDeal: ReferralSide | null = null;
  if (session.user.role === 'agent' && currentAgentId) {
    const assignedDeal = await Payment.findOne({
      referralId: referral._id,
      agentId: currentAgentId,
      usedAssignedAgent: true,
      agentAttribution: { $ne: 'OUTSIDE_AGENT' },
    })
      .sort({ createdAt: -1 })
      .select('side')
      .lean<{ side?: 'buy' | 'sell' | null } | null>();
    if (assignedDeal?.side === 'buy' || assignedDeal?.side === 'sell') {
      sideFromAssignedDeal = assignedDeal.side;
    }
  }

  const sideFromAgent = resolveAgentSideForReferral(
    {
      buySideAgent: referral.buySideAgent as any,
      sellSideAgent: referral.sellSideAgent as any,
      assignedAgent: referral.assignedAgent as any,
      dealSide: referral.dealSide ?? null,
      clientType: referral.clientType ?? null,
    },
    currentAgentId
  );
  const preferredAgentSideForRequest =
    session.user.role === 'agent' &&
    (parsed.data.status === 'Lost' || Boolean(parsed.data.terminateDeal))
      ? sideFromAssignedDeal ?? sideFromAgent
      : sideFromAgent;
  let requestSide: ReferralSide =
    parsed.data.side ??
    parsed.data.contractDetails?.dealSide ??
    preferredAgentSideForRequest ??
    pickPrimarySideForReferral({
      buySideAgent: referral.buySideAgent as any,
      sellSideAgent: referral.sellSideAgent as any,
      assignedAgent: referral.assignedAgent as any,
      dealSide: referral.dealSide ?? null,
      clientType: referral.clientType ?? null,
    });

  // Single-sided referrals must always write to their own side, regardless of
  // what the client sent (the UI's `dealSide` field can lag behind `clientType`
  // on Seller/Buyer referrals, which would otherwise silently update the wrong
  // side's status and leave `referral.status` unchanged).
  if (referral.clientType === 'Seller') {
    requestSide = 'sell';
  } else if (referral.clientType === 'Buyer') {
    requestSide = 'buy';
  }

  if (
    session.user.role === 'agent' &&
    sideFromAgent &&
    requestSide !== sideFromAgent
  ) {
    return NextResponse.json(
      { error: { side: ['Agents can only update statuses for their assigned side.'] } },
      { status: 403 }
    );
  }

  const requestedStatus = parsed.data.status;
  const nextStatus = requestedStatus === 'Showing Homes' ? 'Active Lead' : requestedStatus;
  const createNewDeal = Boolean(parsed.data.createNewDeal);
  const dealMappedStatusUpdateFromTable =
    session.user.role === 'agent' &&
    parsed.data.source === 'referral_table' &&
    (nextStatus === 'Closed' || nextStatus === 'Terminated');
  let shouldPersistReferralStatus = true;
  const previousStatusRaw = referral.status;
  const previousStatus = previousStatusRaw === 'Showing Homes' ? 'Active Lead' : previousStatusRaw;
  const previousStatusUpdatedAt =
    referral.statusLastUpdated instanceof Date
      ? referral.statusLastUpdated
      : referral.statusLastUpdated
      ? new Date(referral.statusLastUpdated)
      : null;
  const actorId = resolveAuditActorId(session.user.id);
  if (shouldPersistReferralStatus) {
    if (requestSide === 'sell') {
      referral.sellStatus = nextStatus;
    } else {
      referral.buyStatus = nextStatus;
    }
    referral.status = deriveReferralStatusFromSides(
      referral.buyStatus ?? previousStatus,
      referral.sellStatus ?? previousStatus,
      referral.clientType ?? null
    );
    referral.dealSide = requestSide;
    referral.statusLastUpdated = now;
    referral.audit = referral.audit || [];
    const auditEntry: Record<string, unknown> = {
      actorRole: session.user.role,
      field: 'status',
      previousValue: previousStatus,
      newValue: referral.status,
      timestamp: now
    };

    if (actorId) {
      auditEntry.actorId = actorId;
    }

    referral.audit.push(auditEntry as any);
  }

  let createdDeal: any = null;
  let syncedDeal: any = null;
  let syncError: { code: 'agent_record_missing' | 'deal_unassigned' | 'deal_missing'; message: string } | null = null;
  const sla = (referral.sla ??= {} as any);
  let slaModified = false;

  if (shouldPersistReferralStatus && !isAgentOrigin) {
    if (nextStatus === 'Under Contract') {
      if (sla.contractToCloseMinutes != null) {
        sla.previousContractToCloseMinutes = sla.contractToCloseMinutes;
      }
      if (sla.closedToPaidMinutes != null) {
        sla.previousClosedToPaidMinutes = sla.closedToPaidMinutes;
      }
      sla.contractToCloseMinutes = null;
      sla.closedToPaidMinutes = null;
      sla.lastClosedAt = null;
      sla.lastPaidAt = null;
      sla.lastUnderContractAt = now;
      // M-25: when a referral re-enters Under Contract after a Closed, clear
      // the stored daysToClose so it is recomputed from the new close date.
      sla.daysToClose = null;
      if (sla.daysToContract == null) {
        const createdAt = referral.createdAt instanceof Date ? referral.createdAt : new Date(referral.createdAt ?? now);
        const refDateRaw = referral.referralDate
          ? referral.referralDate instanceof Date
            ? referral.referralDate
            : new Date(referral.referralDate)
          : null;
        const createdOk = createdAt && !Number.isNaN(createdAt.getTime());
        const refOk = refDateRaw && !Number.isNaN(refDateRaw.getTime());
        const anchor =
          createdOk && refOk
            ? refDateRaw!.getTime() < createdAt!.getTime()
              ? refDateRaw!
              : createdAt!
            : refOk
              ? refDateRaw!
              : createdOk
                ? createdAt!
                : null;
        if (anchor && !Number.isNaN(anchor.getTime())) {
          sla.daysToContract = Math.max(differenceInDays(now, anchor), 0);
        }
      }
      slaModified = true;
    } else if (PRE_CONTRACT_STATUSES.has(nextStatus)) {
      if (nextStatus === 'Paired') {
        // Default automated update reminders to enabled when a referral is paired
        // ONLY if the attached agent has AHA_OOS designation.
        // Admins can explicitly disable per referral via the toggle.
        if (!referral.autoUpdateRemindersEnabled && hasAhaOosAgentAttached(referral)) {
          referral.autoUpdateRemindersEnabled = true;
          referral.audit.push({
            actorRole: session.user.role,
            actorId: actorId ?? undefined,
            field: 'autoUpdateRemindersEnabled',
            previousValue: false,
            newValue: true,
            timestamp: now,
          } as any);
        }

        sla.lastPairedAt = now;
        slaModified = true;
      } else if (nextStatus === 'In Communication') {
        let pairedAt: Date | null = null;
        if (sla.lastPairedAt) {
          const candidate = sla.lastPairedAt instanceof Date ? sla.lastPairedAt : new Date(sla.lastPairedAt);
          if (!Number.isNaN(candidate.getTime())) {
            pairedAt = candidate;
          }
        }
        if (!pairedAt && previousStatus === 'Paired' && previousStatusUpdatedAt) {
          pairedAt = previousStatusUpdatedAt;
        }
        if (!pairedAt) {
          const auditEntries = Array.isArray(referral.audit) ? referral.audit : [];
          for (let index = auditEntries.length - 1; index >= 0; index -= 1) {
            const entry = auditEntries[index];
            if (entry?.field === 'status' && entry.newValue === 'Paired' && entry.timestamp) {
              const timestamp = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
              if (!Number.isNaN(timestamp.getTime())) {
                pairedAt = timestamp;
                break;
              }
            }
          }
        }
        if (pairedAt) {
          const minutes = calculateBusinessMinutesBetween(pairedAt, now);
          if (minutes != null) {
            sla.timeToFirstAgentContactHours = Math.round((minutes / 60) * 10) / 10;
            sla.lastPairedAt = pairedAt;
            slaModified = true;
          }
        }
      } else if (nextStatus === 'New Lead' && sla.lastPairedAt) {
        sla.lastPairedAt = null;
        slaModified = true;
      }

      if (sla.contractToCloseMinutes != null) {
        sla.previousContractToCloseMinutes = sla.contractToCloseMinutes;
      }
      if (sla.closedToPaidMinutes != null) {
        sla.previousClosedToPaidMinutes = sla.closedToPaidMinutes;
      }
      sla.contractToCloseMinutes = null;
      sla.closedToPaidMinutes = null;
      sla.lastUnderContractAt = null;
      sla.lastClosedAt = null;
      sla.lastPaidAt = null;
      // M-25: re-opening to a pre-contract status wipes the close-related
      // stopwatches so future transitions recompute cleanly.
      sla.daysToClose = null;
      slaModified = true;
    } else if (nextStatus === 'Closed') {
      sla.lastClosedAt = now;
      // Calculate and store daysToClose if we have lastUnderContractAt
      if (sla.daysToClose == null && sla.lastUnderContractAt) {
        const underContractAt = sla.lastUnderContractAt instanceof Date 
          ? sla.lastUnderContractAt 
          : new Date(sla.lastUnderContractAt);
        if (!Number.isNaN(underContractAt.getTime())) {
          sla.daysToClose = Math.max(differenceInDays(now, underContractAt), 0);
        }
      }
      slaModified = true;
    }
  }

  if (shouldPersistReferralStatus && parsed.data.status === 'Under Contract') {
    const details = parsed.data.contractDetails;
    const underContractSide: ReferralSide = details?.dealSide ?? requestSide;
    const underContractUsedAfc = !isSellSide(underContractSide);

    if (details) {
      const propertyAddress = details.propertyAddress.trim();
      const propertyCity = details.propertyCity.trim();
      const propertyPostalCode = details.propertyPostalCode.trim();
      let propertyState = details.propertyState.trim().toUpperCase();

      const inferredState = await inferStateFromPostalCode(propertyPostalCode);
      if (inferredState) {
        propertyState = inferredState;
      }

      referral.propertyAddress = propertyAddress;
      referral.propertyCity = propertyCity;
      referral.propertyState = propertyState;
      referral.propertyPostalCode = propertyPostalCode;
      referral.estPurchasePriceCents = Math.round(details.contractPrice * 100);
      referral.commissionBasisPoints = Math.round(details.agentCommissionPercentage * 100);
      referral.referralFeeBasisPoints = isNoFeeDeal
        ? 0
        : Math.round(details.referralFeePercentage * 100);
      referral.dealSide = underContractSide;
      const commissionRate = details.agentCommissionPercentage / 100;
      const referralRate = details.referralFeePercentage / 100;
      const referralFeeDue = isNoFeeDeal ? 0 : details.contractPrice * commissionRate * referralRate;
      referral.referralFeeDueCents = Math.round(referralFeeDue * 100);
    }

    const sideAgentId = getAgentIdForSide(
      {
        buySideAgent: referral.buySideAgent as any,
        sellSideAgent: referral.sellSideAgent as any,
        assignedAgent: referral.assignedAgent as any,
      },
      underContractSide
    );

    if (!createNewDeal) {
      await Payment.updateMany(
        { referralId: referral._id, status: 'under_contract', side: underContractSide },
        {
          $set: {
            expectedAmountCents: isNoFeeDeal ? 0 : referral.referralFeeDueCents ?? 0,
            commissionBasisPoints: referral.commissionBasisPoints ?? null,
            referralFeeBasisPoints: isNoFeeDeal ? null : referral.referralFeeBasisPoints ?? null,
            side: underContractSide,
            contractPriceCents: referral.estPurchasePriceCents ?? null,
            usedAfc: underContractUsedAfc,
          },
        }
      );

      const activeDeal = await Payment.findOne({ referralId: referral._id, status: 'under_contract', side: underContractSide })
        .sort({ createdAt: -1 })
        .lean();

      if (!activeDeal) {
        const newDeal = await Payment.create({
          referralId: referral._id,
          status: 'under_contract',
          expectedAmountCents: isNoFeeDeal ? 0 : referral.referralFeeDueCents ?? 0,
          commissionBasisPoints: referral.commissionBasisPoints ?? null,
          referralFeeBasisPoints: isNoFeeDeal ? null : referral.referralFeeBasisPoints ?? null,
          side: underContractSide,
          contractPriceCents: referral.estPurchasePriceCents ?? null,
          usedAssignedAgent: true,
          usedAfc: underContractUsedAfc,
          underContractDate: new Date(),
          agentId: sideAgentId,
        });
        createdDeal = newDeal.toObject();
      }
    } else {
      const newDeal = await Payment.create({
        referralId: referral._id,
        status: 'under_contract',
        expectedAmountCents: isNoFeeDeal ? 0 : referral.referralFeeDueCents ?? 0,
        commissionBasisPoints: referral.commissionBasisPoints ?? null,
        referralFeeBasisPoints: isNoFeeDeal ? null : referral.referralFeeBasisPoints ?? null,
        side: underContractSide,
        contractPriceCents: referral.estPurchasePriceCents ?? null,
        usedAssignedAgent: true,
        usedAfc: underContractUsedAfc,
        underContractDate: new Date(),
        agentId: sideAgentId,
      });
      createdDeal = newDeal.toObject();
    }
  } else if (shouldPersistReferralStatus && (parsed.data.status === 'Terminated' || parsed.data.status === 'Lost')) {
    referral.estPurchasePriceCents = 0;
    referral.referralFeeDueCents = 0;
    await Payment.updateMany(
      { referralId: referral._id },
      { $set: { expectedAmountCents: 0 } }
    );

    // Auto-disable update reminders when referral status is Lost
    if (parsed.data.status === 'Lost' && referral.autoUpdateRemindersEnabled !== false) {
      referral.autoUpdateRemindersEnabled = false;
      const reminderAuditEntry: Record<string, unknown> = {
        actorRole: session.user.role,
        field: 'autoUpdateRemindersEnabled',
        previousValue: true,
        newValue: false,
        timestamp: now,
      };
      if (actorId) {
        reminderAuditEntry.actorId = actorId;
      }
      referral.audit.push(reminderAuditEntry as any);
      await logReferralActivity({
        referralId: referral._id.toString(),
        actorRole: session.user.role,
        actorId: session.user.id,
        channel: 'update',
        content: 'Automated update reminders disabled (referral lost)',
      });
    }
  } else if (shouldPersistReferralStatus && parsed.data.status !== 'Closed') {
    const hasActiveDeal = await Payment.exists({
      referralId: referral._id,
      status: {
        $in: [
          'under_contract',
          'past_inspection',
          'past_appraisal',
          'clear_to_close',
          'closed',
          'payment_sent',
          'paid'
        ],
      },
    });

    if (!hasActiveDeal) {
      if (isNoFeeDeal) {
        referral.referralFeeDueCents = 0;
        await Payment.updateMany(
          { referralId: referral._id, status: 'under_contract' },
          { $set: { expectedAmountCents: 0 } }
        );
      } else {
        const commissionBasisPoints = referral.commissionBasisPoints || DEFAULT_AGENT_COMMISSION_BPS;
        const referralFeeBasisPoints = referral.referralFeeBasisPoints ?? DEFAULT_REFERRAL_FEE_BPS;
        const baseAmount = referral.preApprovalAmountCents ?? 0;
        referral.referralFeeDueCents = calculateReferralFeeDue(
          baseAmount,
          commissionBasisPoints,
          referralFeeBasisPoints
        );
        await Payment.updateMany(
          { referralId: referral._id, status: 'under_contract' },
          { $set: { expectedAmountCents: referral.referralFeeDueCents ?? 0 } }
        );
      }
    }
  }

  const mappedDealStatus = mapReferralStatusToDealStatus(nextStatus as ReferralStatus);
  const shouldTerminateAttributedDeal = Boolean(parsed.data.terminateDeal);

  const buildAttributedDealQuery = (): {
    dealQuery: Record<string, unknown>;
    canSyncDealStatus: boolean;
  } => {
    const dealQuery: Record<string, unknown> = {
      referralId: referral._id,
      usedAssignedAgent: true,
      agentAttribution: { $ne: 'OUTSIDE_AGENT' },
      side: requestSide,
    };
    let canSyncDealStatus = true;

    if (session.user.role === 'agent' && !currentAgentId) {
      canSyncDealStatus = false;
      syncError = {
        code: 'agent_record_missing',
        message: 'Unable to sync deal status because your agent profile could not be resolved.',
      };
    } else if (session.user.role === 'agent' && currentAgentId) {
      dealQuery.agentId = currentAgentId;
    }

    return { dealQuery, canSyncDealStatus };
  };

  const forceLostForUnassignedDeal = async () => {
    if (session.user.role !== 'agent' || !currentAgentId) {
      return;
    }
    const unassignedDealQuery: Record<string, unknown> = {
      referralId: referral._id,
      side: requestSide,
      $or: [{ usedAssignedAgent: false }, { agentAttribution: 'OUTSIDE_AGENT' }],
    };
    const latestUnassignedDeal = await Payment.findOne(unassignedDealQuery).sort({ createdAt: -1 });

    if (latestUnassignedDeal) {
      if (requestSide === 'sell') {
        referral.sellStatus = 'Lost';
      } else {
        referral.buyStatus = 'Lost';
      }
      if (referral.status !== 'Lost') {
        const auditEntry: Record<string, unknown> = {
          actorRole: session.user.role,
          field: 'status',
          previousValue: referral.status,
          newValue: 'Lost',
          timestamp: now,
        };
        if (actorId) {
          auditEntry.actorId = actorId;
        }
        referral.audit = referral.audit || [];
        referral.audit.push(auditEntry as any);
        referral.status = 'Lost';
        referral.statusLastUpdated = now;
      }
      shouldPersistReferralStatus = true;
      syncError = {
        code: 'deal_unassigned',
        message:
          'This referral is tied to an unassigned/outside-agent deal. We moved your referral status to Lost.',
      };
    } else if (!shouldTerminateAttributedDeal) {
      syncError = {
        code: 'deal_missing',
        message:
          'No attributed deal was found for this referral side, so the status could not be synced to a deal.',
      };
    }
  };

  if (shouldTerminateAttributedDeal) {
    const { dealQuery, canSyncDealStatus } = buildAttributedDealQuery();
    const latestAttributedDeal = canSyncDealStatus
      ? await Payment.findOne(dealQuery).sort({ createdAt: -1 })
      : null;

    if (latestAttributedDeal) {
      latestAttributedDeal.status = 'terminated';
      latestAttributedDeal.terminatedReason =
        parsed.data.terminatedReason ?? latestAttributedDeal.terminatedReason;
      latestAttributedDeal.expectedAmountCents = 0;
      await latestAttributedDeal.save();
      syncedDeal = latestAttributedDeal.toObject();
    } else if (
      session.user.role === 'agent' &&
      parsed.data.source === 'referral_table' &&
      !syncError
    ) {
      await forceLostForUnassignedDeal();
    }
  } else if (mappedDealStatus && parsed.data.status !== 'Under Contract') {
    const { dealQuery, canSyncDealStatus } = buildAttributedDealQuery();

    const latestAttributedDeal = canSyncDealStatus ? await Payment.findOne(dealQuery).sort({ createdAt: -1 }) : null;

    if (latestAttributedDeal) {
      latestAttributedDeal.status = mappedDealStatus;
      if (mappedDealStatus === 'closed') {
        latestAttributedDeal.closingDate = parsed.data.closingDate
          ? new Date(parsed.data.closingDate)
          : latestAttributedDeal.closingDate ?? now;
      }
      if (mappedDealStatus === 'terminated') {
        latestAttributedDeal.terminatedReason = parsed.data.terminatedReason ?? latestAttributedDeal.terminatedReason;
      } else {
        latestAttributedDeal.terminatedReason = null;
      }
      await latestAttributedDeal.save();
      syncedDeal = latestAttributedDeal.toObject();

      if (mappedDealStatus === 'closed' && !isAgitDeal && isTransactionalEmailConfigured()) {
        const shouldSendClosedEmails = parsed.data.sendClosedEmails ?? false;
        const shouldSendAgentNpsEmail = parsed.data.sendAgentNpsEmail ?? false;
        const sendAgentClosedCongrats = latestAttributedDeal.usedAfc === true;
        const origin = getReferralAppBaseUrl();

        if (shouldSendClosedEmails || (shouldSendAgentNpsEmail && sendAgentClosedCongrats)) {
          try {
            const dealAgentId = latestAttributedDeal.agentId ? String(latestAttributedDeal.agentId) : null;
            const sideSpecificAgentId = getAgentIdForSide(
              {
                buySideAgent: referral.buySideAgent as any,
                sellSideAgent: referral.sellSideAgent as any,
                assignedAgent: referral.assignedAgent as any,
              },
              requestSide
            );
            const assignedAgentRef = referral.assignedAgent as { _id?: unknown } | null | undefined;
            const fallbackAssignedAgentId = assignedAgentRef?._id ? String(assignedAgentRef._id) : null;
            const resolvedAgentId = dealAgentId ?? sideSpecificAgentId ?? fallbackAssignedAgentId;
            const resolvedAgent = resolvedAgentId
              ? await Agent.findById(resolvedAgentId)
                .select('name email')
                .lean<{ _id: unknown; name?: string | null; email?: string | null } | null>()
              : null;
            const agentId = resolvedAgentId ?? (resolvedAgent?._id ? String(resolvedAgent._id) : null);
            const agentName = resolvedAgent?.name ?? 'this agent';
            const agentEmail = resolvedAgent?.email ?? null;
            const borrowerEmail = referral.borrower?.email ?? null;
            const borrowerName = referral.borrower?.name || referral.borrower?.firstName || 'Client';
            const borrowerFirstName =
              referral.borrower?.firstName ||
              (referral.borrower?.name ? referral.borrower.name.split(' ')[0] : null) ||
              'there';

            if (shouldSendClosedEmails && borrowerEmail && agentId) {
              const agentSurveyToken = await createNPSToken({
                paymentId: latestAttributedDeal._id.toString(),
                referralId: referral._id.toString(),
                type: 'agent',
                targetId: agentId,
                recipientEmail: borrowerEmail,
                recipientName: borrowerName,
                agentName,
              });
              const agentSurveyUrl = `${origin}/nps/agent?token=${agentSurveyToken}`;

              const borrowerSurveySentStatus = await sendTransactionalEmail({
                to: [borrowerEmail],
                subject: 'Congrats on Your New Home!',
                html: `
                  <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; color: #0f172a; line-height: 1.5;">
                    <p>Hi ${borrowerFirstName},</p>
                    <p>Congratulations on closing on your home! 🎉 If you have a quick moment, we'd really appreciate you leaving a rating for your agent, ${agentName}—your feedback means a lot and helps others tremendously. Wishing you all the best!</p>
                    <p style="margin: 20px 0 0 0;">
                      <a href="${agentSurveyUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
                        Rate Your Agent
                      </a>
                    </p>
                  </div>
                `,
                text: `Hi ${borrowerFirstName},\n\nCongratulations on closing on your home! 🎉 If you have a quick moment, we'd really appreciate you leaving a rating for your agent, ${agentName}—your feedback means a lot and helps others tremendously. Wishing you all the best!\n\nRate your agent: ${agentSurveyUrl}`,
              });
              if (borrowerSurveySentStatus === true) {
                await logReferralActivity({
                  referralId: referral._id,
                  actorRole: session.user.role,
                  actorId: session.user.id,
                  channel: 'email',
                  content: `Satisfaction rating survey emailed to borrower for feedback on ${agentName}.`,
                });
              }
            }

            if (shouldSendAgentNpsEmail && sendAgentClosedCongrats && agentEmail) {
              const lenderRef = referral.lender as { _id?: unknown } | null | undefined;
              const lenderId = lenderRef?._id ? String(lenderRef._id) : null;
              let lenderSurveyUrl: string | null = null;

              if (lenderId) {
                const lenderSurveyToken = await createNPSToken({
                  paymentId: latestAttributedDeal._id.toString(),
                  referralId: referral._id.toString(),
                  type: 'lender',
                  targetId: lenderId,
                  recipientEmail: agentEmail,
                  recipientName: agentName,
                });
                lenderSurveyUrl = `${origin}/nps/lender?token=${lenderSurveyToken}`;
              }

              const agentFirstName = agentName.split(' ')[0] || 'there';
              const borrowerDisplayName =
                referral.borrower?.name || referral.borrower?.firstName || 'your client';
              const mcQuestion =
                'If you have a quick moment: on a scale of 0-10, how likely are you to recommend American Financing to a client or colleague?';
              const mcBlockHtml = lenderSurveyUrl
                ? `
                    <p style="margin: 20px 0 0 0;">${mcQuestion}</p>
                    <p style="margin: 20px 0 0 0;">
                      <a href="${lenderSurveyUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
                        Rate Your Mortgage Consultant
                      </a>
                    </p>
                  `
                : '';
              const mcBlockText = lenderSurveyUrl
                ? `\n\n${mcQuestion}\n\nRate your mortgage consultant: ${lenderSurveyUrl}`
                : '';

              const agentCloseSurveySentStatus = await sendTransactionalEmail({
                to: [agentEmail],
                subject: 'Congratulations on Your Closed Deal!',
                html: `
                  <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; color: #0f172a; line-height: 1.5;">
                    <p>Hi ${agentFirstName},</p>
                    <p>Congratulations on closing your deal with ${borrowerDisplayName}! Great work getting this referral across the finish line.</p>${mcBlockHtml}
                  </div>
                `,
                text: `Hi ${agentFirstName},\n\nCongratulations on closing your deal with ${borrowerDisplayName}! Great work getting this referral across the finish line.${mcBlockText}`,
              });
              if (agentCloseSurveySentStatus === true && lenderSurveyUrl) {
                const lenderPopStatus = referral.lender as { name?: string | null } | null | undefined;
                const lenderLabelStatus = lenderPopStatus?.name?.trim() || 'their mortgage consultant';
                await logReferralActivity({
                  referralId: referral._id,
                  actorRole: session.user.role,
                  actorId: session.user.id,
                  channel: 'email',
                  content: `Satisfaction rating survey emailed to agent for feedback on ${lenderLabelStatus}.`,
                });
              }
            }
          } catch (emailError) {
            console.error('Failed to send close-status NPS emails:', emailError);
          }
        }
      }
    } else if (dealMappedStatusUpdateFromTable && session.user.role === 'agent' && currentAgentId) {
      await forceLostForUnassignedDeal();
    }
  }
  if (slaModified) {
    referral.markModified('sla');
  }
  if (shouldPersistReferralStatus || slaModified) {
    await referral.save();
  }

  if (shouldPersistReferralStatus && previousStatus !== referral.status) {
    await logReferralActivity({
      referralId: referral._id,
      actorRole: session.user.role,
      actorId: session.user.id,
      channel: 'status',
      content: `Status changed from ${previousStatus} to ${referral.status}`,
    });

    const transitionedToUnderContract =
      referral.status === 'Under Contract' && previousStatus !== 'Under Contract';

    if (
      session.user.role === 'agent' ||
      session.user.role === 'mc' ||
      transitionedToUnderContract
    ) {
      const actorName = session.user.name || session.user.email || 'A team member';
      const borrowerName = referral.borrower?.name || 'a referral';
      await createAdminNotifications({
        type: 'status_change',
        referralId: referral._id,
        borrowerName,
        actorRole: session.user.role,
        actorName,
        content: `${actorName} changed status from ${previousStatus} to ${referral.status} for ${borrowerName}`,
      });
    }

    // Check if this agent action should trigger an update request response notification
    if (session.user.role === 'agent') {
      const actorName = session.user.name || session.user.email || 'Agent';
      await maybeNotifyAdminsOnUpdateRequestResponse({
        referral: {
          _id: referral._id,
          lastAutoReminderSentAt: referral.lastAutoReminderSentAt,
          lastManualReminderSentAt: referral.lastManualReminderSentAt,
          lastUpdateRequestResponseNotifiedAt: referral.lastUpdateRequestResponseNotifiedAt,
          borrower: referral.borrower,
        },
        actorRole: session.user.role,
        actorName,
        actionAt: now,
        actionSummary: `changed status from ${previousStatus} to ${referral.status}`,
      });
    }

    await generateAndReconcileAdminTasks({
      referralId: referral._id.toString(),
      trigger: 'referral.status_changed',
      actorId: session.user.id,
    }).catch((error) => {
      console.error('[Admin Tasks] Failed to reconcile tasks after status change:', error);
    });
  }

  const statusLastUpdated = referral.statusLastUpdated ?? new Date();
  const daysInStatus = differenceInDays(new Date(), statusLastUpdated);

  if (syncError) {
    const sideStatus =
      requestSide === 'sell'
        ? (referral.sellStatus as ReferralStatus | undefined)
        : (referral.buyStatus as ReferralStatus | undefined);
    return NextResponse.json(
      {
        error: {
          message: syncError.message,
          status: [syncError.message],
          code: syncError.code,
        },
        currentStatus: sideStatus ?? referral.status ?? previousStatus,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    id: referral._id.toString(),
    status: shouldPersistReferralStatus ? referral.status : previousStatus,
    contractDetails:
      parsed.data.status === 'Under Contract'
        ? {
            propertyAddress: referral.propertyAddress ?? '',
            propertyCity: referral.propertyCity ?? '',
            propertyState: referral.propertyState ?? '',
            propertyPostalCode: referral.propertyPostalCode ?? '',
            contractPriceCents: referral.estPurchasePriceCents ?? 0,
            agentCommissionBasisPoints: referral.commissionBasisPoints ?? 0,
            referralFeeBasisPoints: referral.referralFeeBasisPoints ?? 0,
            referralFeeDueCents: referral.referralFeeDueCents ?? 0,
            dealSide: referral.dealSide ?? requestSide,
          }
        : undefined,
    deal:
      createdDeal || syncedDeal
        ? {
            _id: (createdDeal ?? syncedDeal)._id?.toString?.() ?? '',
            status: (createdDeal ?? syncedDeal).status ?? 'under_contract',
            expectedAmountCents: (createdDeal ?? syncedDeal).expectedAmountCents ?? 0,
            receivedAmountCents: (createdDeal ?? syncedDeal).receivedAmountCents ?? 0,
            terminatedReason: (createdDeal ?? syncedDeal).terminatedReason ?? null,
            agentAttribution: (createdDeal ?? syncedDeal).agentAttribution ?? null,
            usedAfc: Boolean((createdDeal ?? syncedDeal).usedAfc),
            usedAssignedAgent: Boolean((createdDeal ?? syncedDeal).usedAssignedAgent),
            commissionBasisPoints: (createdDeal ?? syncedDeal).commissionBasisPoints ?? null,
            referralFeeBasisPoints: (createdDeal ?? syncedDeal).referralFeeBasisPoints ?? null,
            side: (createdDeal ?? syncedDeal).side ?? null,
            contractPriceCents: (createdDeal ?? syncedDeal).contractPriceCents ?? null,
            createdAt: (createdDeal ?? syncedDeal).createdAt instanceof Date
              ? (createdDeal ?? syncedDeal).createdAt.toISOString()
              : (createdDeal ?? syncedDeal).createdAt ?? null,
            updatedAt: (createdDeal ?? syncedDeal).updatedAt instanceof Date
              ? (createdDeal ?? syncedDeal).updatedAt.toISOString()
              : (createdDeal ?? syncedDeal).updatedAt ?? null,
            closingDate: (createdDeal ?? syncedDeal).closingDate instanceof Date
              ? (createdDeal ?? syncedDeal).closingDate.toISOString()
              : (createdDeal ?? syncedDeal).closingDate ?? null,
            paidDate: (createdDeal ?? syncedDeal).paidDate instanceof Date
              ? (createdDeal ?? syncedDeal).paidDate.toISOString()
              : (createdDeal ?? syncedDeal).paidDate ?? null,
          }
        : undefined,
    preApprovalAmountCents: referral.preApprovalAmountCents ?? 0,
    referralFeeDueCents: referral.referralFeeDueCents ?? 0,
    contractPriceCents: referral.estPurchasePriceCents ?? 0,
    buyStatus: referral.buyStatus ?? 'New Lead',
    sellStatus: referral.sellStatus ?? 'New Lead',
    side: requestSide,
    statusLastUpdated: statusLastUpdated.toISOString(),
    daysInStatus,
  });
}
