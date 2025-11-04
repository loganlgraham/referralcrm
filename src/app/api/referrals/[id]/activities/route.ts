import { NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Activity } from '@/models/activity';
import { createActivitySchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';
import { Referral } from '@/models/referral';

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
  const activities = await Activity.find({ referralId: params.id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json(
    activities.map((activity) => ({ ...activity, _id: activity._id.toString(), createdAt: activity.createdAt }))
  );
}

export async function POST(request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = createActivitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id);
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, { assignedAgent: referral.assignedAgent?.toString?.(), lender: referral.lender?.toString?.(), org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const activity = await Activity.create({
    referralId: params.id,
    actor: session.user.role === 'agent' ? 'Agent' : 'MC',
    actorId: session.user.id,
    channel: parsed.data.channel,
    content: parsed.data.content
  });

  return NextResponse.json({ id: activity._id.toString() }, { status: 201 });
}
