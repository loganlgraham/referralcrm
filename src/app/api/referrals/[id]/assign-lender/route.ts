import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { assignLenderSchema } from '@/utils/validators';
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
  const parsed = assignLenderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id);
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canManageReferral(session, {
      assignedAgent: referral.assignedAgent?.toString?.(),
      lender: referral.lender?.toString?.(),
      org: referral.org
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const previousLender = referral.lender ? referral.lender.toString() : null;
  referral.lender = parsed.data.lenderId as any;
  referral.audit = referral.audit || [];
  referral.audit.push({
    actorId: session.user.id as any,
    actorRole: session.user.role,
    field: 'lender',
    previousValue: previousLender,
    newValue: parsed.data.lenderId,
    timestamp: new Date()
  } as any);
  await referral.save();

  return NextResponse.json({ id: referral._id.toString() });
}
