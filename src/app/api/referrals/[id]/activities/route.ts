import { NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Activity } from '@/models/activity';
import { createActivitySchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';
import { Referral } from '@/models/referral';

interface Params {
  params: { id: string };
}

type LeanActivity = {
  _id: Types.ObjectId;
  referralId: Types.ObjectId;
  actor: 'Agent' | 'MC' | 'System';
  actorId?: Types.ObjectId | null;
  channel: 'call' | 'sms' | 'email' | 'note';
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

type LeanReferralAccess = {
  assignedAgent?: Types.ObjectId | string | null;
  lender?: Types.ObjectId | string | null;
  org: 'AFC' | 'AHA';
};

const serializeActivity = (activity: LeanActivity) => ({
  ...activity,
  _id: activity._id.toString(),
  referralId: activity.referralId.toString(),
  actorId: activity.actorId ? activity.actorId.toString() : null
});

export async function GET(_: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById(params.id)
    .select('assignedAgent lender org')
    .lean<LeanReferralAccess>();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  const accessScope = {
    assignedAgent:
      typeof referral.assignedAgent === 'string'
        ? referral.assignedAgent
        : referral.assignedAgent?.toString?.(),
    lender:
      typeof referral.lender === 'string' ? referral.lender : referral.lender?.toString?.(),
    org: referral.org
  };
  if (!canViewReferral(session, accessScope)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const activities = await Activity.find({ referralId: params.id })
    .sort({ createdAt: -1 })
    .lean<LeanActivity[]>(); // array of LeanActivity
  return NextResponse.json(activities.map(serializeActivity));
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
  const referral = await Referral.findById(params.id)
    .select('assignedAgent lender org')
    .lean<LeanReferralAccess>();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  const accessScope = {
    assignedAgent:
      typeof referral.assignedAgent === 'string'
        ? referral.assignedAgent
        : referral.assignedAgent?.toString?.(),
    lender:
      typeof referral.lender === 'string' ? referral.lender : referral.lender?.toString?.(),
    org: referral.org
  };
  if (!canViewReferral(session, accessScope)) {
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
