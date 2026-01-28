import { NextRequest, NextResponse } from 'next/server';
import { differenceInDays } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
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
import { syncReferralTasks } from '@/lib/server/task-sync';
import { maybeNotifyAdminsOnUpdateRequestResponse } from '@/lib/server/update-request-response';

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
    .populate('assignedAgent', 'userId')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
    .populate('lender', 'userId');
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
  const requestedStatus = parsed.data.status;
  const nextStatus = requestedStatus === 'Showing Homes' ? 'Active Lead' : requestedStatus;
  const createNewDeal = Boolean(parsed.data.createNewDeal);
  const previousStatusRaw = referral.status;
  const previousStatus = previousStatusRaw === 'Showing Homes' ? 'Active Lead' : previousStatusRaw;
  const previousStatusUpdatedAt =
    referral.statusLastUpdated instanceof Date
      ? referral.statusLastUpdated
      : referral.statusLastUpdated
      ? new Date(referral.statusLastUpdated)
      : null;
  referral.status = nextStatus;
  referral.statusLastUpdated = now;
  referral.audit = referral.audit || [];
  const auditEntry: Record<string, unknown> = {
    actorRole: session.user.role,
    field: 'status',
    previousValue: previousStatus,
    newValue: nextStatus,
    timestamp: now
  };

  const actorId = resolveAuditActorId(session.user.id);
  if (actorId) {
    auditEntry.actorId = actorId;
  }

  referral.audit.push(auditEntry as any);

  let createdDeal: any = null;
  const sla = (referral.sla ??= {} as any);
  let slaModified = false;

  if (!isAgentOrigin) {
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
      if (sla.daysToContract == null) {
        const createdAt = referral.createdAt instanceof Date ? referral.createdAt : new Date(referral.createdAt ?? now);
        if (!Number.isNaN(createdAt.getTime())) {
          sla.daysToContract = Math.max(differenceInDays(now, createdAt), 0);
        }
      }
      slaModified = true;
    } else if (PRE_CONTRACT_STATUSES.has(nextStatus)) {
      if (nextStatus === 'Paired') {
        // Default automated update reminders to enabled when a referral is paired.
        // Admins can explicitly disable per referral via the toggle.
        if (!referral.autoUpdateRemindersEnabled) {
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

  if (parsed.data.status === 'Under Contract') {
    const details = parsed.data.contractDetails;

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
      referral.referralFeeBasisPoints = isAgentOrigin
        ? 0
        : Math.round(details.referralFeePercentage * 100);
      referral.dealSide = details.dealSide;
      const commissionRate = details.agentCommissionPercentage / 100;
      const referralRate = details.referralFeePercentage / 100;
      const referralFeeDue = isAgentOrigin ? 0 : details.contractPrice * commissionRate * referralRate;
      referral.referralFeeDueCents = Math.round(referralFeeDue * 100);
    }

    if (!createNewDeal) {
      await Payment.updateMany(
        { referralId: referral._id, status: 'under_contract' },
        {
          $set: {
            expectedAmountCents: isAgentOrigin ? 0 : referral.referralFeeDueCents ?? 0,
            commissionBasisPoints: referral.commissionBasisPoints ?? null,
            referralFeeBasisPoints: isAgentOrigin ? null : referral.referralFeeBasisPoints ?? null,
            side: referral.dealSide,
            contractPriceCents: referral.estPurchasePriceCents ?? null,
          },
        }
      );

      const activeDeal = await Payment.findOne({ referralId: referral._id, status: 'under_contract' })
        .sort({ createdAt: -1 })
        .lean();

      if (!activeDeal) {
        const newDeal = await Payment.create({
          referralId: referral._id,
          status: 'under_contract',
          expectedAmountCents: isAgentOrigin ? 0 : referral.referralFeeDueCents ?? 0,
          commissionBasisPoints: referral.commissionBasisPoints ?? null,
          referralFeeBasisPoints: isAgentOrigin ? null : referral.referralFeeBasisPoints ?? null,
          side: referral.dealSide,
          contractPriceCents: referral.estPurchasePriceCents ?? null,
          usedAssignedAgent: true,
          usedAfc: true,
          agentId:
            referral.assignedAgent && typeof (referral.assignedAgent as any) === 'object'
              ? ((referral.assignedAgent as any)._id ?? null)
              : referral.assignedAgent ?? null,
        });
        createdDeal = newDeal.toObject();
      }
    } else {
      const newDeal = await Payment.create({
        referralId: referral._id,
        status: 'under_contract',
        expectedAmountCents: isAgentOrigin ? 0 : referral.referralFeeDueCents ?? 0,
        commissionBasisPoints: referral.commissionBasisPoints ?? null,
        referralFeeBasisPoints: isAgentOrigin ? null : referral.referralFeeBasisPoints ?? null,
        side: referral.dealSide,
        contractPriceCents: referral.estPurchasePriceCents ?? null,
        usedAssignedAgent: true,
        usedAfc: true,
        agentId:
          referral.assignedAgent && typeof (referral.assignedAgent as any) === 'object'
            ? ((referral.assignedAgent as any)._id ?? null)
            : referral.assignedAgent ?? null,
      });
      createdDeal = newDeal.toObject();
    }
  } else if (parsed.data.status === 'Terminated' || parsed.data.status === 'Lost') {
    referral.estPurchasePriceCents = 0;
    referral.referralFeeDueCents = 0;
    await Payment.updateMany(
      { referralId: referral._id },
      { $set: { expectedAmountCents: 0 } }
    );
  } else if (parsed.data.status !== 'Closed') {
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
      if (isAgentOrigin) {
        referral.referralFeeDueCents = 0;
        await Payment.updateMany(
          { referralId: referral._id, status: 'under_contract' },
          { $set: { expectedAmountCents: 0 } }
        );
      } else {
        const commissionBasisPoints = referral.commissionBasisPoints || DEFAULT_AGENT_COMMISSION_BPS;
        const referralFeeBasisPoints = referral.referralFeeBasisPoints || DEFAULT_REFERRAL_FEE_BPS;
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
  if (slaModified) {
    referral.markModified('sla');
  }

  await referral.save();

  if (previousStatus !== referral.status) {
    await logReferralActivity({
      referralId: referral._id,
      actorRole: session.user.role,
      actorId: session.user.id,
      channel: 'status',
      content: `Status changed from ${previousStatus} to ${referral.status}`,
    });

    // Create notifications for admins if the status change was not made by an admin
    if (session.user.role !== 'admin') {
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

    // Sync follow-up tasks for the updated status (runs in background)
    syncReferralTasks(referral._id).catch((error) => {
      console.error('[Task Sync] Failed to sync tasks after status change:', error);
    });
  }

  const statusLastUpdated = referral.statusLastUpdated ?? new Date();
  const daysInStatus = differenceInDays(new Date(), statusLastUpdated);

  return NextResponse.json({
    id: referral._id.toString(),
    status: referral.status,
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
            dealSide: referral.dealSide ?? 'buy',
          }
        : undefined,
    deal:
      createdDeal
        ? {
            _id: createdDeal._id?.toString?.() ?? '',
            status: createdDeal.status ?? 'under_contract',
            expectedAmountCents: createdDeal.expectedAmountCents ?? 0,
            receivedAmountCents: createdDeal.receivedAmountCents ?? 0,
            terminatedReason: createdDeal.terminatedReason ?? null,
            agentAttribution: createdDeal.agentAttribution ?? null,
            usedAfc: Boolean(createdDeal.usedAfc),
            usedAssignedAgent: Boolean(createdDeal.usedAssignedAgent),
            commissionBasisPoints: createdDeal.commissionBasisPoints ?? null,
            referralFeeBasisPoints: createdDeal.referralFeeBasisPoints ?? null,
            side: createdDeal.side ?? null,
            contractPriceCents: createdDeal.contractPriceCents ?? null,
            createdAt: createdDeal.createdAt instanceof Date
              ? createdDeal.createdAt.toISOString()
              : createdDeal.createdAt ?? null,
            updatedAt: createdDeal.updatedAt instanceof Date
              ? createdDeal.updatedAt.toISOString()
              : createdDeal.updatedAt ?? null,
            paidDate: createdDeal.paidDate instanceof Date
              ? createdDeal.paidDate.toISOString()
              : createdDeal.paidDate ?? null,
          }
        : undefined,
    preApprovalAmountCents: referral.preApprovalAmountCents ?? 0,
    referralFeeDueCents: referral.referralFeeDueCents ?? 0,
    contractPriceCents: referral.estPurchasePriceCents ?? 0,
    statusLastUpdated: statusLastUpdated.toISOString(),
    daysInStatus,
  });
}
