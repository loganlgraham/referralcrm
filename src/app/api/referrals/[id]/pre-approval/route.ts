import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { calculateReferralFeeDue } from '@/utils/referral';
import { DEFAULT_AGENT_COMMISSION_BPS, DEFAULT_REFERRAL_FEE_BPS } from '@/constants/referrals';

const schema = z.object({
  amount: z.number().min(0),
});

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
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

  if (
    !canManageReferral(session, {
      assignedAgent: referral.assignedAgent,
      lender: referral.lender,
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const amountCents = Math.round(parsed.data.amount * 100);
  referral.preApprovalAmountCents = amountCents;

  if (referral.status !== 'Under Contract' && referral.status !== 'Closed') {
    const commissionBasisPoints = referral.commissionBasisPoints || DEFAULT_AGENT_COMMISSION_BPS;
    const referralFeeBasisPoints = referral.referralFeeBasisPoints || DEFAULT_REFERRAL_FEE_BPS;
    referral.referralFeeDueCents = calculateReferralFeeDue(
      amountCents,
      commissionBasisPoints,
      referralFeeBasisPoints
    );
    await Payment.updateMany(
      { referralId: referral._id },
      { $set: { expectedAmountCents: referral.referralFeeDueCents ?? 0 } }
    );
  }

  await referral.save();

  return NextResponse.json({
    preApprovalAmountCents: referral.preApprovalAmountCents ?? 0,
    referralFeeDueCents: referral.referralFeeDueCents ?? 0,
  });
}
