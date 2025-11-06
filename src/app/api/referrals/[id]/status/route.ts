import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { updateStatusSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';

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
  const referral = await Referral.findById(params.id);
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canManageReferral(session, { assignedAgent: referral.assignedAgent?.toString?.(), lender: referral.lender?.toString?.(), org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const previousStatus = referral.status;
  referral.status = parsed.data.status;
  referral.statusLastUpdated = new Date();
  referral.audit = referral.audit || [];
  referral.audit.push({
    actorId: session.user.id as any,
    actorRole: session.user.role,
    field: 'status',
    previousValue: previousStatus,
    newValue: parsed.data.status,
    timestamp: new Date()
  } as any);

  if (parsed.data.status === 'Under Contract') {
    const details = parsed.data.contractDetails;
    if (!details) {
      return NextResponse.json(
        { error: { contractDetails: ['Contract details are required for Under Contract status.'] } },
        { status: 422 }
      );
    }

    referral.propertyAddress = details.propertyAddress;
    referral.estPurchasePriceCents = Math.round(details.contractPrice * 100);
    referral.commissionBasisPoints = Math.round(details.agentCommissionPercentage * 100);
    referral.referralFeeBasisPoints = Math.round(details.referralFeePercentage * 100);
    const commissionRate = details.agentCommissionPercentage / 100;
    const referralRate = details.referralFeePercentage / 100;
    const referralFeeDue = details.contractPrice * commissionRate * referralRate;
    referral.referralFeeDueCents = Math.round(referralFeeDue * 100);
  }
  await referral.save();

  return NextResponse.json({ id: referral._id.toString(), status: referral.status });
}
