import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Activity } from '@/models/activity';
import { createActivitySchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';
import { Referral } from '@/models/referral';
import { resolveActivityActor } from '@/lib/server/activities';
import { createAdminNotifications } from '@/lib/server/notifications';

interface Params {
  params: { id: string };
}

type LeanActivity = {
  _id: Types.ObjectId;
  referralId: Types.ObjectId;
  actor: 'Agent' | 'MC' | 'Admin' | 'System';
  actorId?: Types.ObjectId | null;
  channel: 'call' | 'sms' | 'email' | 'note' | 'status' | 'update';
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

type LeanReferralAccess = {
  assignedAgent?:
    | Types.ObjectId
    | string
    | null
    | {
        _id?: Types.ObjectId | string | null;
        userId?: Types.ObjectId | string | null;
      };
  lender?:
    | Types.ObjectId
    | string
    | null
    | {
        _id?: Types.ObjectId | string | null;
        userId?: Types.ObjectId | string | null;
      };
  org: 'AFC' | 'AHA';
  deletedAt?: Date | null;
};

const serializeActivity = (activity: LeanActivity) => ({
  ...activity,
  _id: activity._id.toString(),
  referralId: activity.referralId.toString(),
  actorId: activity.actorId ? activity.actorId.toString() : null
});

export async function GET(_: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById(params.id)
    .select('assignedAgent buySideAgent sellSideAgent lender org deletedAt')
    .populate('assignedAgent', 'userId')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
    .populate('lender', 'userId')
    .lean<LeanReferralAccess & { buySideAgent?: unknown; sellSideAgent?: unknown }>();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  const accessScope = {
    assignedAgent: referral.assignedAgent,
    buySideAgent: (referral as any).buySideAgent,
    sellSideAgent: (referral as any).sellSideAgent,
    lender: referral.lender,
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

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
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
    .select('assignedAgent lender org deletedAt borrower')
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId')
    .lean<LeanReferralAccess & { borrower?: { name?: string } }>();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  const accessScope = {
    assignedAgent: referral.assignedAgent,
    lender: referral.lender,
    org: referral.org
  };
  if (!canViewReferral(session, accessScope)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const activity = await Activity.create({
    referralId: params.id,
    actor: resolveActivityActor(session.user.role),
    actorId: session.user.id,
    channel: parsed.data.channel,
    content: parsed.data.content
  });

  // Create notifications for admins if this is an email activity from non-admin
  if (parsed.data.channel === 'email' && activity.actor !== 'Admin') {
    const actorName = session.user.name || session.user.email || 'A team member';
    const borrowerName = referral.borrower?.name || 'a referral';
    await createAdminNotifications({
      type: 'email_response',
      referralId: params.id,
      actorRole: session.user.role,
      actorName,
      content: `${actorName} responded via email to ${borrowerName}`,
    });
  }

  return NextResponse.json({ id: activity._id.toString() }, { status: 201 });
}
