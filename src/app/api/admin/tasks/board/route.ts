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
type BoardGroupBy = 'due' | 'agent' | 'similar';
type BoardView = 'urgent' | 'upcoming';
type DateParts = { year: number; month: number; day: number };

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

interface GroupSection {
  groupKey: string;
  groupLabel: string;
  referralCards: ReferralTaskCard[];
}

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function deriveSimilarTaskGroup(title?: string | null): { key: string; label: string } {
  const normalized = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return { key: 'other', label: 'Other' };

  const tokens = normalized.split(' ').filter(Boolean);
  const significant = tokens.filter((token) => !TITLE_STOP_WORDS.has(token));
  const baseTokens = (significant.length > 0 ? significant : tokens).slice(0, 3);

  if (baseTokens.length === 0) return { key: 'other', label: 'Other' };

  return {
    key: baseTokens.join('-'),
    label: baseTokens.map(toTitleCase).join(' '),
  };
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

function getFocalTask(card: ReferralTaskCard, view: BoardView): TaskWithEffective | null {
  if (view === 'upcoming') {
    return card.upcomingTasks[0] ?? card.todayTasks[0] ?? card.overdueTasks[0] ?? card.completedTasks[0] ?? null;
  }

  return card.overdueTasks[0] ?? card.todayTasks[0] ?? card.upcomingTasks[0] ?? card.completedTasks[0] ?? null;
}

function parseDueDateParam(dueDateParam: string | null): DateParts | null {
  if (!dueDateParam) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDateParam);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  const isValid = (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
  if (!isValid) return null;

  return { year, month, day };
}

function isTaskDueOnSelectedDay(task: TaskWithEffective, selectedDay: DateParts): boolean {
  if (!task.effectiveDue) return false;
  return (
    task.effectiveDue.getFullYear() === selectedDay.year &&
    task.effectiveDue.getMonth() === selectedDay.month - 1 &&
    task.effectiveDue.getDate() === selectedDay.day
  );
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
  const groupByParam = searchParams.get('groupBy');
  const groupBy: BoardGroupBy =
    groupByParam === 'agent' || groupByParam === 'similar' || groupByParam === 'due'
      ? groupByParam
      : 'due';

  const viewParam = searchParams.get('view');
  const view: BoardView = viewParam === 'upcoming' || viewParam === 'urgent' ? viewParam : 'urgent';
  const selectedDay = parseDueDateParam(searchParams.get('dueDate'));

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
    return NextResponse.json([], { headers: NO_CACHE_HEADERS });
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

  const hasUpcomingTasks = (card: ReferralTaskCard) =>
    card.upcomingTasks.length > 0;

  const getEarliestUrgentDue = (card: ReferralTaskCard): number => {
    const overdue = card.overdueTasks[0]?.effectiveDue?.getTime();
    const today = card.todayTasks[0]?.effectiveDue?.getTime();
    if (overdue != null && today != null) return Math.min(overdue, today);
    return overdue ?? today ?? Infinity;
  };

  const getEarliestUpcomingDue = (card: ReferralTaskCard): number =>
    card.upcomingTasks[0]?.effectiveDue?.getTime() ?? Infinity;

  const cardFilter = view === 'upcoming' ? hasUpcomingTasks : hasUrgentTasks;
  const cardSorter = view === 'upcoming'
    ? (a: ReferralTaskCard, b: ReferralTaskCard) => getEarliestUpcomingDue(a) - getEarliestUpcomingDue(b)
    : (a: ReferralTaskCard, b: ReferralTaskCard) => getEarliestUrgentDue(a) - getEarliestUrgentDue(b);
  const selectedDayFilter = (card: ReferralTaskCard) => {
    const tasks = [
      ...card.overdueTasks,
      ...card.todayTasks,
      ...card.upcomingTasks,
      ...card.completedTasks,
    ];
    return tasks.some((task) => isTaskDueOnSelectedDay(task, selectedDay!));
  };
  const visibleCards = referralCards
    .filter(selectedDay ? selectedDayFilter : cardFilter)
    .sort(cardSorter);

  if (groupBy === 'agent') {
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
      referralCards: byAgent.get(agentName)!.sort(cardSorter),
    }));

    return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
  }

  if (groupBy === 'similar') {
    const bySimilarTask = new Map<string, { label: string; cards: ReferralTaskCard[] }>();

    for (const card of visibleCards) {
      const focalTask = getFocalTask(card, view);
      const { key, label } = deriveSimilarTaskGroup(focalTask?.title);
      if (!bySimilarTask.has(key)) {
        bySimilarTask.set(key, { label, cards: [] });
      }
      bySimilarTask.get(key)!.cards.push(card);
    }

    const payload: GroupSection[] = [...bySimilarTask.entries()]
      .sort((a, b) => {
        const countDiff = b[1].cards.length - a[1].cards.length;
        if (countDiff !== 0) return countDiff;
        return a[1].label.localeCompare(b[1].label);
      })
      .map(([groupKey, groupData]) => ({
        groupKey,
        groupLabel: groupData.label,
        referralCards: groupData.cards.sort(cardSorter),
      }));

    return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
  }

  return NextResponse.json(visibleCards, { headers: NO_CACHE_HEADERS });
}
