import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';
import { Referral } from '@/models/referral';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'completed';

interface TaskWithEffective {
  _id: string;
  referralId: string;
  title: string;
  description?: string;
  category?: string;
  priority?: string;
  status: 'open' | 'completed' | 'dismissed';
  dueAt?: string;
  dueAtOverride?: string;
  snoozedUntil?: string;
  ruleKey?: string | null;
  cycleKey: string;
  effectiveDueAt: string | null;
  effectiveDue: Date | null;
  completedAt?: string;
  createdAt: string;
  createdBy: string;
}

function getTaskBucket(effectiveDue: Date | null, status: string): TaskBucket {
  if (status === 'completed') return 'completed';
  if (!effectiveDue) return 'upcoming';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDate = new Date(
    effectiveDue.getFullYear(),
    effectiveDue.getMonth(),
    effectiveDue.getDate()
  );
  const diffMs = dueDate.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  return 'upcoming';
}

export interface ReferralTaskCard {
  referralId: string;
  borrower: { name: string; email: string; phone: string };
  agent: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  status: string;
  overdueTasks: TaskWithEffective[];
  todayTasks: TaskWithEffective[];
  upcomingTasks: TaskWithEffective[];
  completedTasks: TaskWithEffective[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as {
      status?: number;
      message?: string;
    };
    return new NextResponse(message, { status });
  }

  await connectMongo();

  const { searchParams } = new URL(request.url);
  const groupBy = searchParams.get('groupBy') ?? 'due';

  const tasks = await AdminTask.find({ status: { $in: ['open', 'completed'] } })
    .sort({ dueAt: 1, createdAt: 1 })
    .lean<AdminTaskLean[]>();

  const tasksWithEffective: TaskWithEffective[] = tasks.map((task) => {
    const effectiveDue = getEffectiveDueDate(task);
    const bucket = getTaskBucket(effectiveDue ?? null, task.status);
    return {
      _id: task._id.toString(),
      referralId: task.referralId.toString(),
      title: task.title,
      description: task.description,
      category: task.category,
      priority: task.priority,
      status: task.status,
      dueAt: task.dueAt?.toISOString(),
      dueAtOverride: task.dueAtOverride?.toISOString(),
      snoozedUntil: task.snoozedUntil?.toISOString(),
      ruleKey: task.ruleKey ?? undefined,
      cycleKey: task.cycleKey,
      effectiveDueAt: effectiveDue ? effectiveDue.toISOString() : null,
      effectiveDue,
      completedAt: task.completedAt?.toISOString(),
      createdAt: task.createdAt.toISOString(),
      createdBy: task.createdBy,
    };
  });

  const referralIds = [...new Set(tasksWithEffective.map((t) => t.referralId))];
  if (referralIds.length === 0) {
    const payload = groupBy === 'agent' ? [] : [];
    return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
  }

  const referrals = await Referral.find({ _id: { $in: referralIds } })
    .populate('assignedAgent', 'name email phone')
    .select('borrower status assignedAgent')
    .lean();

  const referralMap = new Map<
    string,
    {
      borrower: { name: string; email: string; phone: string };
      status: string;
      agent: { id: string | null; name: string | null; email: string | null; phone: string | null } | null;
    }
  >();

  for (const r of referrals) {
    const id = (r._id as { toString: () => string }).toString();
    const agent = r.assignedAgent as
      | { _id?: unknown; name?: string; email?: string; phone?: string }
      | null;
    const agentId =
      agent?._id != null
        ? typeof agent._id === 'object' && 'toString' in (agent._id as object)
          ? (agent._id as { toString: () => string }).toString()
          : String(agent._id)
        : null;
    referralMap.set(id, {
      borrower: {
        name: r.borrower?.name ?? '',
        email: r.borrower?.email ?? '',
        phone: r.borrower?.phone ?? '',
      },
      status: r.status ?? 'New Lead',
      agent: agent
        ? {
            id: agentId,
            name: agent.name ?? null,
            email: agent.email ?? null,
            phone: agent.phone ?? null,
          }
        : null,
    });
  }

  const byReferral = new Map<
    string,
    { overdue: TaskWithEffective[]; today: TaskWithEffective[]; upcoming: TaskWithEffective[]; completed: TaskWithEffective[] }
  >();

  for (const task of tasksWithEffective) {
    if (!byReferral.has(task.referralId)) {
      byReferral.set(task.referralId, {
        overdue: [],
        today: [],
        upcoming: [],
        completed: [],
      });
    }
    const buckets = byReferral.get(task.referralId)!;
    const bucket = getTaskBucket(task.effectiveDue, task.status);
    buckets[bucket].push(task);
  }

  const sortByEffectiveDue = (a: TaskWithEffective, b: TaskWithEffective) => {
    const aDue = a.effectiveDue?.getTime() ?? Infinity;
    const bDue = b.effectiveDue?.getTime() ?? Infinity;
    return aDue - bDue;
  };

  const sortCompletedByDate = (a: TaskWithEffective, b: TaskWithEffective) => {
    const aAt = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bAt = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bAt - aAt;
  };

  const referralCards: ReferralTaskCard[] = [];
  for (const [referralId, buckets] of byReferral) {
    const ref = referralMap.get(referralId);
    if (!ref) continue;

    referralCards.push({
      referralId,
      borrower: ref.borrower,
      agent: ref.agent,
      status: ref.status,
      overdueTasks: buckets.overdue.sort(sortByEffectiveDue),
      todayTasks: buckets.today.sort(sortByEffectiveDue),
      upcomingTasks: buckets.upcoming.sort(sortByEffectiveDue),
      completedTasks: buckets.completed.sort(sortCompletedByDate),
    });
  }

  const hasUrgentTasks = (card: ReferralTaskCard) =>
    card.overdueTasks.length > 0 || card.todayTasks.length > 0;

  const getEarliestUrgentDue = (card: ReferralTaskCard): number => {
    const overdue = card.overdueTasks[0]?.effectiveDue?.getTime();
    const today = card.todayTasks[0]?.effectiveDue?.getTime();
    if (overdue != null && today != null) return Math.min(overdue, today);
    return overdue ?? today ?? Infinity;
  };

  if (groupBy === 'agent') {
    const visibleCards = referralCards.filter(hasUrgentTasks);
    const byAgent = new Map<string, ReferralTaskCard[]>();

    for (const card of visibleCards) {
      const agentName = card.agent?.name ?? 'Unassigned Agent';
      if (!byAgent.has(agentName)) byAgent.set(agentName, []);
      byAgent.get(agentName)!.push(card);
    }

    const sortedAgents = [...byAgent.keys()].sort((a, b) => {
      if (a === 'Unassigned Agent') return 1;
      if (b === 'Unassigned Agent') return -1;
      return a.localeCompare(b);
    });

    const payload = sortedAgents.map((agentName) => ({
      groupKey: agentName,
      groupLabel: agentName,
      referralCards: byAgent.get(agentName)!.sort((a, b) => getEarliestUrgentDue(a) - getEarliestUrgentDue(b)),
    }));

    return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
  }

  const visibleCards = referralCards.filter(hasUrgentTasks).sort((a, b) => getEarliestUrgentDue(a) - getEarliestUrgentDue(b));
  return NextResponse.json(visibleCards, { headers: NO_CACHE_HEADERS });
}
