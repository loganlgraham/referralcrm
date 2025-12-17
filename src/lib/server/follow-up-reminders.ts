import { Session } from 'next-auth';

import {
  buildFollowUpTasksForReferral,
  type CompletionMap,
  type FollowUpTask,
  type FollowUpTaskRole,
  type ManualTask,
} from '@/lib/follow-up-tasks';
import { ACTIVE_REFERRAL_STATUS_VALUES } from '@/constants/referrals';
import { connectMongo } from '@/lib/mongoose';
import { getReferrals } from '@/lib/server/referrals';
import { User } from '@/models/user';
import { type ReferralLike } from '@/utils/sla-insights';

type UserRole = NonNullable<Awaited<ReturnType<typeof User.findOne>>['role']>;

const ROLE_TO_VIEWER: Partial<Record<UserRole, FollowUpTaskRole>> = {
  admin: 'admin',
  'mortgage-consultant': 'mc',
  agent: 'agent',
};

const parseReminderRoles = (value: string | undefined | null): UserRole[] => {
  if (!value) {
    return ['admin', 'mortgage-consultant', 'agent'];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is UserRole => entry === 'admin' || entry === 'mortgage-consultant' || entry === 'agent');
};

const toReferralLike = (
  referral: Awaited<ReturnType<typeof getReferrals>>['items'][number]
): ReferralLike & { borrower: { name: string } } => ({
  _id: referral._id,
  createdAt: referral.createdAt,
  status: referral.status,
  statusLastUpdated: referral.statusLastUpdated ?? null,
  daysInStatus: referral.daysInStatus,
  clientType: referral.clientType ?? undefined,
  dealSide: referral.dealSide ?? undefined,
  assignedAgent: referral.assignedAgentName ? { name: referral.assignedAgentName } : null,
  assignedAgentName: referral.assignedAgentName,
  buySideAgentName: referral.buySideAgentName ?? undefined,
  sellSideAgentName: referral.sellSideAgentName ?? undefined,
  lender: referral.lenderName ? { name: referral.lenderName } : null,
  origin: referral.origin ?? undefined,
  borrower: { name: referral.borrowerName },
  notes: [],
  payments: [],
  audit: [],
});

const noop = () => undefined;

const buildSessionForUser = (user: { _id: string; email?: string | null; name?: string | null; role?: string | null }) =>
  ({
    user: {
      id: user._id,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      role: user.role ?? undefined,
    },
    expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }) as Session;

const fetchAllReferralsForUser = async (session: Session) => {
  const items: Awaited<ReturnType<typeof getReferrals>>['items'] = [];
  let page = 1;
  let total = 0;

  do {
    const result = await getReferrals({ session, page });
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (items.length < total);

  return items.filter((item) => ACTIVE_REFERRAL_STATUS_VALUES.includes(item.status as (typeof ACTIVE_REFERRAL_STATUS_VALUES)[number]));
};

const mapTasksToReminderPayload = (tasks: FollowUpTask[]) =>
  tasks.map((task) => ({
    taskId: task.taskId,
    referralId: task.referralId,
    title: task.title,
    message: task.message,
    dueAt: task.dueAt ?? null,
    referralName: task.referralName ?? null,
    priority: task.priority,
    category: task.category,
  }));

export interface ReminderCandidate {
  user: { _id: string; email: string; role: UserRole };
  viewerRole: FollowUpTaskRole;
  tasks: ReturnType<typeof mapTasksToReminderPayload>;
}

export const collectReminderCandidates = async (): Promise<ReminderCandidate[]> => {
  await connectMongo();
  const allowedRoles = parseReminderRoles(process.env.TASK_REMINDER_ROLES);
  const users = await User.find({ role: { $in: allowedRoles }, email: { $exists: true, $ne: null } })
    .select('_id email role name')
    .lean<{ _id: string; email: string; role: UserRole; name?: string }[]>();

  const candidates: ReminderCandidate[] = [];
  for (const user of users) {
    const viewerRole = ROLE_TO_VIEWER[user.role];
    if (!viewerRole) {
      continue;
    }

    const session = buildSessionForUser({ _id: user._id.toString(), email: user.email, name: user.name, role: user.role });
    const referrals = await fetchAllReferralsForUser(session);
    if (!referrals.length) {
      continue;
    }

    const completions: CompletionMap = {};
    const manualTasks: Record<string, ManualTask[]> = {};
    const outstandingTasks: FollowUpTask[] = [];

    referrals.forEach((referral) => {
      const referralLike = toReferralLike(referral);
      const followUps = buildFollowUpTasksForReferral(referralLike, {
        completions,
        manualTasks,
        toggleTask: noop,
        removeManualTask: noop,
        viewerRole,
      });
      followUps
        .filter((task) => !task.completed && task.role === viewerRole)
        .forEach((task) => outstandingTasks.push(task));
    });

    if (outstandingTasks.length === 0) {
      continue;
    }

    candidates.push({
      user: { _id: user._id.toString(), email: user.email, role: user.role },
      viewerRole,
      tasks: mapTasksToReminderPayload(outstandingTasks),
    });
  }

  return candidates;
};
