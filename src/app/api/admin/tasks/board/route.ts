import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';
import { Referral } from '@/models/referral';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

function getDueBucket(effectiveDue: Date | null): string {
  if (!effectiveDue) return 'no_due_date';
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
  if (diffDays <= 7) return 'next_7_days';
  return 'later';
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
  const status = searchParams.get('status') ?? 'open';

  const tasks = await AdminTask.find({ status })
    .sort({ dueAt: 1, createdAt: 1 })
    .lean<AdminTaskLean[]>();

  const tasksWithEffective = tasks.map((task) => {
    const effectiveDue = getEffectiveDueDate(task);
    return {
      ...task,
      _id: task._id.toString(),
      referralId: task.referralId.toString(),
      effectiveDueAt: effectiveDue ? effectiveDue.toISOString() : null,
      effectiveDue,
      dueBucket: getDueBucket(effectiveDue ?? null),
    };
  });

  if (groupBy === 'agent') {
    const referralIds = [...new Set(tasksWithEffective.map((t) => t.referralId))];
    const referrals = await Referral.find({ _id: { $in: referralIds } })
      .populate('assignedAgent', 'name')
      .lean();

    const referralAgentMap = new Map<string, string>();
    for (const r of referrals) {
      const id = (r._id as { toString: () => string }).toString();
      const agent = r.assignedAgent as { name?: string } | null;
      referralAgentMap.set(id, agent?.name ?? 'Unassigned Agent');
    }

    const byAgent: Record<string, typeof tasksWithEffective> = {};
    for (const task of tasksWithEffective) {
      const agentName = referralAgentMap.get(task.referralId) ?? 'Unassigned Agent';
      if (!byAgent[agentName]) byAgent[agentName] = [];
      byAgent[agentName].push(task);
    }

    const sortedAgents = Object.keys(byAgent).sort((a, b) => {
      if (a === 'Unassigned Agent') return 1;
      if (b === 'Unassigned Agent') return -1;
      return a.localeCompare(b);
    });

    const payload = sortedAgents.map((agentName) => ({
      groupKey: agentName,
      groupLabel: agentName,
      tasks: byAgent[agentName].sort((a, b) => {
        const aDue = a.effectiveDue?.getTime() ?? Infinity;
        const bDue = b.effectiveDue?.getTime() ?? Infinity;
        return aDue - bDue;
      }),
    }));

    return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
  }

  const dueBuckets = ['overdue', 'today', 'next_7_days', 'later', 'no_due_date'];
  const byDue: Record<string, typeof tasksWithEffective> = {};
  for (const bucket of dueBuckets) {
    byDue[bucket] = [];
  }
  for (const task of tasksWithEffective) {
    byDue[task.dueBucket].push(task);
  }

  const payload = dueBuckets.map((bucket) => ({
    groupKey: bucket,
    groupLabel:
      bucket === 'overdue'
        ? 'Overdue'
        : bucket === 'today'
          ? 'Today'
          : bucket === 'next_7_days'
            ? 'Next 7 days'
            : bucket === 'later'
              ? 'Later'
              : 'No due date',
    tasks: byDue[bucket].sort((a, b) => {
      const aDue = a.effectiveDue?.getTime() ?? Infinity;
      const bDue = b.effectiveDue?.getTime() ?? Infinity;
      return aDue - bDue;
    }),
  }));

  return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
}
