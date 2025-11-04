import { NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { updateReferralSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';

interface Params {
  params: { id: string };
}

export async function GET(_: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById(params.id).lean();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, { assignedAgent: referral.assignedAgent?.toString?.(), lender: referral.lender?.toString?.(), org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.json(referral);
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = updateReferralSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const existing = await Referral.findById(params.id);
  if (!existing) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canManageReferral(session, { assignedAgent: existing.assignedAgent?.toString?.(), lender: existing.lender?.toString?.(), org: existing.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const referral = await Referral.findByIdAndUpdate(
    params.id,
    {
      ...parsed.data,
      $push: {
        audit: {
          actorId: session.user.id,
          actorRole: session.user.role,
          field: 'update',
          previousValue: null,
          newValue: parsed.data,
          timestamp: new Date()
        }
      }
    },
    { new: true }
  );

  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  return NextResponse.json(referral);
}

export async function DELETE(_: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById(params.id);
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, { assignedAgent: referral.assignedAgent?.toString?.(), lender: referral.lender?.toString?.(), org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  await Referral.findByIdAndUpdate(params.id, { deletedAt: new Date() });
  return new NextResponse(null, { status: 204 });
}
