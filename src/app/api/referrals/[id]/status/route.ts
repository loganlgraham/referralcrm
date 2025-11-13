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

interface Params {
  params: { id: string };
}

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
  const previousStatus = referral.status;
  referral.status = parsed.data.status;
  referral.statusLastUpdated = new Date();
  referral.audit = referral.audit || [];
  const auditEntry: Record<string, unknown> = {
    actorRole: session.user.role,
    field: 'status',
    previousValue: previousStatus,
    newValue: parsed.data.status,
    timestamp: new Date()
  };

  const actorId = resolveAuditActorId(session.user.id);
  if (actorId) {
    auditEntry.actorId = actorId;
  }

  referral.audit.push(auditEntry as any);

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

    referral.propertyAddress = propertyAddress;
    referral.propertyCity = propertyCity;
    referral.propertyState = propertyState;
    referral.propertyPostalCode = propertyPostalCode;
    referral.estPurchasePriceCents = Math.round(details.contractPrice * 100);
    referral.commissionBasisPoints = Math.round(details.agentCommissionPercentage * 100);
    referral.referralFeeBasisPoints = Math.round(details.referralFeePercentage * 100);
    const commissionRate = details.agentCommissionPercentage / 100;
    const referralRate = details.referralFeePercentage / 100;
    const referralFeeDue = details.contractPrice * commissionRate * referralRate;
    referral.referralFeeDueCents = Math.round(referralFeeDue * 100);

    await Payment.updateMany(
      { referralId: referral._id, status: 'under_contract' },
      { $set: { expectedAmountCents: referral.referralFeeDueCents ?? 0 } }
    );

    const activeDeal = await Payment.findOne({ referralId: referral._id, status: 'under_contract' })
      .sort({ createdAt: -1 })
      .lean();

    if (!activeDeal) {
      await Payment.create({
        referralId: referral._id,
        status: 'under_contract',
        expectedAmountCents: referral.referralFeeDueCents ?? 0,
      });
    }
  } else if (parsed.data.status === 'Terminated' || parsed.data.status === 'Lost') {
    referral.estPurchasePriceCents = 0;
    referral.referralFeeDueCents = 0;
    await Payment.updateMany(
      { referralId: referral._id },
      { $set: { expectedAmountCents: 0 } }
    );
  } else if (parsed.data.status !== 'Closed') {
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
            propertyAddress: referral.propertyAddress ?? '',
            propertyCity: referral.propertyCity ?? '',
            propertyState: referral.propertyState ?? '',
            propertyPostalCode: referral.propertyPostalCode ?? '',
            contractPriceCents: referral.estPurchasePriceCents ?? 0,
            agentCommissionBasisPoints: referral.commissionBasisPoints ?? 0,
            referralFeeBasisPoints: referral.referralFeeBasisPoints ?? 0,
            referralFeeDueCents: referral.referralFeeDueCents ?? 0,
          }
        : undefined,
    preApprovalAmountCents: referral.preApprovalAmountCents ?? 0,
    referralFeeDueCents: referral.referralFeeDueCents ?? 0,
    contractPriceCents: referral.estPurchasePriceCents ?? 0,
    statusLastUpdated: statusLastUpdated.toISOString(),
    daysInStatus,
  });
}
