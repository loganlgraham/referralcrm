import { NextRequest, NextResponse } from 'next/server';
import { differenceInDays, differenceInMinutes } from 'date-fns';

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

type ContractPayment = {
  _id: any;
  expectedCloseDate?: Date | string | null;
  closeDateHistory?: {
    previousDate: Date | string | null;
    nextDate: Date | string | null;
    changedAt: Date | string;
    changedBy: string | null;
  }[];
  usedAfc?: boolean | null;
  usedAssignedAgent?: boolean | null;
};

interface Params {
  params: { id: string };
}

const PRE_CONTRACT_STATUSES = new Set(['New Lead', 'Paired', 'In Communication', 'Active Lead', 'Showing Homes']);

const parseDateOnly = (value?: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

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

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canManageReferral(session, { assignedAgent: referral.assignedAgent, lender: referral.lender, org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const now = new Date();
  const requestedStatus = parsed.data.status;
  const createNewDeal = Boolean(parsed.data.createNewDeal);
  const nextStatus = requestedStatus === 'Showing Homes' ? 'Active Lead' : requestedStatus;
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
  let activeDeal: ContractPayment | null = null;
  const existingUnderContractDeals = await Payment.find({ referralId: referral._id, status: 'under_contract' })
    .sort({ createdAt: -1 })
    .lean<ContractPayment[]>();
  const hasExistingUnderContract = existingUnderContractDeals.length > 0;

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
    slaModified = true;
  } else if (PRE_CONTRACT_STATUSES.has(nextStatus)) {
    if (nextStatus === 'Paired') {
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
        const minutes = Math.max(differenceInMinutes(now, pairedAt), 0);
        sla.timeToFirstAgentContactHours = Math.round((minutes / 60) * 10) / 10;
        sla.lastPairedAt = pairedAt;
        slaModified = true;
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
    slaModified = true;
  }

  let expectedCloseDate: Date | null = null;
  let contractPayload: {
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyPostalCode: string;
    contractPriceCents: number;
    agentCommissionBasisPoints: number;
    referralFeeBasisPoints: number;
    referralFeeDueCents: number;
    dealSide: 'buy' | 'sell';
    expectedCloseDate: Date | null;
    usedAfc: boolean;
    usedAssignedAgent: boolean;
  } | null = null;

  if (parsed.data.status === 'Under Contract') {
    const details = parsed.data.contractDetails;
    if (!details) {
      return NextResponse.json(
        { error: { contractDetails: ['Contract details are required for Under Contract status.'] } },
        { status: 422 }
      );
    }

    const propertyAddress = details.propertyAddress.trim();
    const propertyCity = details.propertyCity.trim();
    const propertyState = details.propertyState.trim().toUpperCase();
    const propertyPostalCode = details.propertyPostalCode.trim();
    expectedCloseDate = parseDateOnly(details.expectedCloseDate ?? null);
    const usedAfc = details.dealSide === 'sell' ? false : details.usedAfc !== false;
    const usedAssignedAgent = details.usedAssignedAgent !== false;
    const contractPriceCents = Math.round(details.contractPrice * 100);
    const commissionBasisPoints = Math.round(details.agentCommissionPercentage * 100);
    const referralFeeBasisPoints = Math.round(details.referralFeePercentage * 100);
    const commissionRate = details.agentCommissionPercentage / 100;
    const referralRate = details.referralFeePercentage / 100;
    const referralFeeDueCents = Math.round(details.contractPrice * commissionRate * referralRate * 100);
    contractPayload = {
      propertyAddress,
      propertyCity,
      propertyState,
      propertyPostalCode,
      contractPriceCents,
      agentCommissionBasisPoints: commissionBasisPoints,
      referralFeeBasisPoints,
      referralFeeDueCents,
      dealSide: details.dealSide,
      expectedCloseDate,
      usedAfc,
      usedAssignedAgent,
    };

    if (!contractPayload) {
      return NextResponse.json({ error: 'Unable to save contract details' }, { status: 500 });
    }

    if (!createNewDeal && hasExistingUnderContract) {
      await Payment.updateMany(
        { referralId: referral._id, status: 'under_contract' },
        {
          $set: {
            expectedAmountCents: contractPayload.referralFeeDueCents ?? 0,
            commissionBasisPoints: contractPayload.agentCommissionBasisPoints ?? null,
            referralFeeBasisPoints: contractPayload.referralFeeBasisPoints ?? null,
            side: contractPayload.dealSide,
            contractPriceCents: contractPayload.contractPriceCents ?? null,
            expectedCloseDate,
            usedAfc,
            usedAssignedAgent,
          },
        }
      );

      activeDeal = existingUnderContractDeals[0] ?? null;
    }

    if (!activeDeal) {
      const newDeal = await Payment.create({
        referralId: referral._id,
        status: 'under_contract',
        expectedAmountCents: contractPayload.referralFeeDueCents ?? 0,
        commissionBasisPoints: contractPayload.agentCommissionBasisPoints ?? null,
        referralFeeBasisPoints: contractPayload.referralFeeBasisPoints ?? null,
        side: contractPayload.dealSide,
        contractPriceCents: contractPayload.contractPriceCents ?? null,
        expectedCloseDate,
        usedAfc,
        usedAssignedAgent,
      });
      createdDeal = newDeal.toObject();
      activeDeal = createdDeal;
    }

    if (activeDeal) {
      await Payment.updateOne(
        { _id: activeDeal._id },
        {
          $set: {
            usedAfc,
            usedAssignedAgent,
          },
        }
      );
    }

    referral.propertyAddress = propertyAddress;
    referral.propertyCity = propertyCity;
    referral.propertyState = propertyState;
    referral.propertyPostalCode = propertyPostalCode;
    referral.dealSide = contractPayload.dealSide;
    referral.expectedCloseDate = expectedCloseDate;

    if (!hasExistingUnderContract || !createNewDeal) {
      referral.estPurchasePriceCents = contractPayload.contractPriceCents;
      referral.commissionBasisPoints = contractPayload.agentCommissionBasisPoints;
      referral.referralFeeBasisPoints = contractPayload.referralFeeBasisPoints;
      referral.referralFeeDueCents = contractPayload.referralFeeDueCents;
    }

    if (activeDeal && expectedCloseDate) {
      const previousCloseDate = activeDeal.expectedCloseDate
        ? new Date(activeDeal.expectedCloseDate)
        : null;
      const hasChanged =
        !previousCloseDate || previousCloseDate.getTime() !== expectedCloseDate.getTime();
      if (hasChanged) {
        await Payment.updateOne(
          { _id: activeDeal._id },
          {
            $set: { expectedCloseDate },
            $push: {
              closeDateHistory: {
                previousDate: previousCloseDate,
                nextDate: expectedCloseDate,
                changedAt: now,
                changedBy: session.user.role ?? 'unknown',
              },
            },
          }
        );
      }
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
  }

  const statusLastUpdated = referral.statusLastUpdated ?? new Date();
  const daysInStatus = differenceInDays(new Date(), statusLastUpdated);

  return NextResponse.json({
    id: referral._id.toString(),
    status: referral.status,
    contractDetails:
      parsed.data.status === 'Under Contract'
        ? {
            propertyAddress: contractPayload?.propertyAddress ?? referral.propertyAddress ?? '',
            propertyCity: contractPayload?.propertyCity ?? referral.propertyCity ?? '',
            propertyState: contractPayload?.propertyState ?? referral.propertyState ?? '',
            propertyPostalCode: contractPayload?.propertyPostalCode ?? referral.propertyPostalCode ?? '',
            contractPriceCents: contractPayload?.contractPriceCents ?? referral.estPurchasePriceCents ?? 0,
            agentCommissionBasisPoints:
              contractPayload?.agentCommissionBasisPoints ?? referral.commissionBasisPoints ?? 0,
            referralFeeBasisPoints: contractPayload?.referralFeeBasisPoints ?? referral.referralFeeBasisPoints ?? 0,
            referralFeeDueCents: contractPayload?.referralFeeDueCents ?? referral.referralFeeDueCents ?? 0,
            dealSide: contractPayload?.dealSide ?? referral.dealSide ?? 'buy',
            expectedCloseDate: contractPayload?.expectedCloseDate ?? referral.expectedCloseDate ?? null,
            usedAfc:
              contractPayload?.usedAfc ?? (activeDeal ? activeDeal.usedAfc !== false : referral?.dealSide !== 'sell'),
            usedAssignedAgent: contractPayload?.usedAssignedAgent ?? activeDeal?.usedAssignedAgent !== false,
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
            usedAfc: createdDeal.usedAfc !== false,
            usedAssignedAgent: Boolean(createdDeal.usedAssignedAgent),
            commissionBasisPoints: createdDeal.commissionBasisPoints ?? null,
            referralFeeBasisPoints: createdDeal.referralFeeBasisPoints ?? null,
            side: createdDeal.side ?? null,
            contractPriceCents: createdDeal.contractPriceCents ?? null,
            expectedCloseDate: createdDeal.expectedCloseDate ?? null,
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
