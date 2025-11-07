import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral, ReferralDocument } from '@/models/referral';
import { updateReferralSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';

interface RouteContext {
  params: { id: string };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById<ReferralDocument>(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId')
    .lean();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, {
    assignedAgent: referral.assignedAgent,
    lender: referral.lender,
    org: referral.org
  })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.json(referral);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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
  const existing = await Referral.findById(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId');
  if (!existing) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canManageReferral(session, { assignedAgent: existing.assignedAgent, lender: existing.lender, org: existing.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const referral = await Referral.findByIdAndUpdate(
    context.params.id,
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

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, { assignedAgent: referral.assignedAgent, lender: referral.lender, org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  await Referral.findByIdAndUpdate(context.params.id, { deletedAt: new Date() });
  return new NextResponse(null, { status: 204 });
}
