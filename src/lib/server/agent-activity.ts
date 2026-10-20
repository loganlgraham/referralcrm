import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Activity } from '@/models/activity';
import { Agent } from '@/models/agent';
import { AgentLoginEvent } from '@/models/agent-login-event';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';

export type AgentActivityEntry = {
  id: string;
  action: 'login' | 'call' | 'sms' | 'email' | 'note' | 'status' | 'update';
  content: string;
  createdAt: string;
  referral: {
    id: string;
    borrowerName: string | null;
    loanFileNumber: string | null;
  } | null;
};

type AgentActivityIdentity = {
  agentId: Types.ObjectId;
  userId: Types.ObjectId | null;
  lastLoginAt: Date | null;
};

type LeanReferralActivity = {
  _id: Types.ObjectId;
  referralId: Types.ObjectId;
  channel: Exclude<AgentActivityEntry['action'], 'login'>;
  content: string;
  createdAt: Date;
};

type LeanLoginEvent = {
  _id: Types.ObjectId;
  loggedInAt: Date;
};

const resolveAgentIdentity = async (agentId: string): Promise<AgentActivityIdentity | null> => {
  if (!Types.ObjectId.isValid(agentId)) {
    return null;
  }

  const agent = await Agent.findById(agentId)
    .select('_id userId email')
    .lean<{
      _id: Types.ObjectId;
      userId?: Types.ObjectId | null;
      email?: string | null;
    } | null>();
  if (!agent) {
    return null;
  }

  const user = agent.userId
    ? await User.findById(agent.userId).select('_id lastLoginAt').lean<{
        _id: Types.ObjectId;
        lastLoginAt?: Date | null;
      } | null>()
    : agent.email
      ? await User.findOne({ email: agent.email.toLowerCase() })
          .select('_id lastLoginAt')
          .lean<{ _id: Types.ObjectId; lastLoginAt?: Date | null } | null>()
      : null;

  return {
    agentId: agent._id,
    userId: user?._id ?? agent.userId ?? null,
    lastLoginAt: user?.lastLoginAt ?? null,
  };
};

export async function recordAgentLoginEvent(input: {
  id?: string | null;
  email?: string | null;
}): Promise<void> {
  const userId =
    typeof input.id === 'string' && Types.ObjectId.isValid(input.id)
      ? new Types.ObjectId(input.id)
      : null;
  const email =
    typeof input.email === 'string' && input.email.trim()
      ? input.email.trim().toLowerCase()
      : null;
  if (!userId && !email) {
    return;
  }

  await connectMongo();
  const user = await User.findOne(userId ? { _id: userId } : { email })
    .select('_id email role')
    .lean<{ _id: Types.ObjectId; email?: string | null; role?: string | null } | null>();
  if (!user || user.role !== 'agent') {
    return;
  }

  const agent = await Agent.findOne({
    $or: [
      { userId: user._id },
      ...(user.email ? [{ email: user.email.toLowerCase() }] : []),
    ],
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();
  if (!agent) {
    return;
  }

  await AgentLoginEvent.create({
    agentId: agent._id,
    userId: user._id,
    loggedInAt: new Date(),
  });
}

export async function getAgentActivityEntries(
  agentId: string,
  limit?: number
): Promise<AgentActivityEntry[] | null> {
  await connectMongo();
  const identity = await resolveAgentIdentity(agentId);
  if (!identity) {
    return null;
  }

  const actorIds = [identity.agentId, identity.userId].filter(
    (value): value is Types.ObjectId => value != null
  );
  const activityQuery = Activity.find({
    actor: 'Agent',
    actorId: { $in: actorIds },
  })
    .sort({ createdAt: -1 })
    .select('_id referralId channel content createdAt');
  const loginQuery = AgentLoginEvent.find({ agentId: identity.agentId })
    .sort({ loggedInAt: -1 })
    .select('_id loggedInAt');

  if (limit != null) {
    activityQuery.limit(limit);
    loginQuery.limit(limit);
  }

  const [referralActivities, loginEvents] = await Promise.all([
    activityQuery.lean<LeanReferralActivity[]>(),
    loginQuery.lean<LeanLoginEvent[]>(),
  ]);

  const referralIds = referralActivities.map((activity) => activity.referralId);
  const referrals = referralIds.length
    ? await Referral.find({ _id: { $in: referralIds } })
        .select('_id borrower loanFileNumber')
        .lean<{
          _id: Types.ObjectId;
          borrower?: { name?: string | null } | null;
          loanFileNumber?: string | null;
        }[]>()
    : [];
  const referralById = new Map(referrals.map((referral) => [referral._id.toString(), referral]));

  const entries: AgentActivityEntry[] = referralActivities.map((activity) => {
    const referral = referralById.get(activity.referralId.toString());
    return {
      id: activity._id.toString(),
      action: activity.channel,
      content: activity.content,
      createdAt: activity.createdAt.toISOString(),
      referral: referral
        ? {
            id: referral._id.toString(),
            borrowerName: referral.borrower?.name ?? null,
            loanFileNumber: referral.loanFileNumber ?? null,
          }
        : null,
    };
  });

  entries.push(
    ...loginEvents.map((event) => ({
      id: `login-${event._id.toString()}`,
      action: 'login' as const,
      content: 'Logged in to the CRM',
      createdAt: event.loggedInAt.toISOString(),
      referral: null,
    }))
  );

  if (loginEvents.length === 0 && identity.lastLoginAt) {
    entries.push({
      id: `last-known-login-${identity.userId?.toString() ?? identity.agentId.toString()}`,
      action: 'login',
      content: 'Last known CRM login before detailed login tracking began',
      createdAt: identity.lastLoginAt.toISOString(),
      referral: null,
    });
  }

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return limit == null ? entries : entries.slice(0, limit);
}
