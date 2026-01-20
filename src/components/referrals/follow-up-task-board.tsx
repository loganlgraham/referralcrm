'use client';

import Link from 'next/link';
import { useMemo, useEffect } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { addDays, startOfDay } from 'date-fns';
import { formatInTimeZone, utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';

import { useFollowUpTaskContext } from '@/components/referrals/follow-up-task-provider';
import {
  buildFollowUpTasksForReferral,
  type FollowUpTaskRole,
} from '@/components/referrals/use-follow-up-tasks';
import { type ReferralLike, resolvePrimaryAgentName, SLA_TIME_ZONE } from '@/utils/sla-insights';
import { normalizeReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';

interface BoardReferral {
  _id: string;
  borrowerName: string;
  status: string;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
  createdAt: string;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  buySideAgentName?: string | null;
  sellSideAgentName?: string | null;
  clientType?: 'Buyer' | 'Seller' | 'Both' | null;
  dealSide?: 'buy' | 'sell' | null;
  lenderName?: string | null;
  origin?: 'agent' | 'mc' | 'admin' | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  timeline?: 'asap' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months' | 'not_specified' | null;
  hasAhaOosAgentAttached?: boolean;
  hasAhaDesignatedAgentAttached?: boolean;
  hasAhaAgentAttached?: boolean;
}

interface FollowUpTasksBoardProps {
  referrals: BoardReferral[];
  viewerRole: FollowUpTaskRole;
}

const toReferralLike = (referral: BoardReferral): ReferralLike & { borrower: { name: string } } => ({
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
  ahaBucket: referral.ahaBucket ?? null,
  timeline: referral.timeline ?? undefined,
  hasAhaOosAgentAttached: referral.hasAhaOosAgentAttached ?? false,
  hasAhaDesignatedAgentAttached: referral.hasAhaDesignatedAgentAttached ?? false,
  hasAhaAgentAttached: referral.hasAhaAgentAttached ?? false,
});

const UNDER_CONTRACT_INDEX = REFERRAL_STATUSES.indexOf('Under Contract');

const isUnderContractOrLater = (status?: string | null) => {
  if (!status) return false;
  const normalized = normalizeReferralStatus(status);
  if (!normalized) return false;

  const statusIndex = REFERRAL_STATUSES.indexOf(normalized);
  return statusIndex >= UNDER_CONTRACT_INDEX && statusIndex !== -1;
};

const getStatusLabel = (referral: BoardReferral) => {
  if (isUnderContractOrLater(referral.status) && referral.dealStatusLabel) {
    return referral.dealStatusLabel;
  }

  return referral.status;
};

const formatDueDate = (value: string): string => {
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch (error) {
    return new Date(value).toLocaleString();
  }
};

export function FollowUpTasksBoard({ referrals, viewerRole }: FollowUpTasksBoardProps) {
  const { 
    completions, 
    manualTasks, 
    shownTasks, 
    taskMetadata, 
    toggleTask, 
    removeManualTask, 
    markTasksAsShown, 
    storeTaskMetadata 
  } = useFollowUpTaskContext();

  const taskResults = useMemo(() => {
    return referrals.reduce<Record<string, ReturnType<typeof buildFollowUpTasksForReferral>>>((acc, referral) => {
      const referralLike = toReferralLike(referral);
      const result = buildFollowUpTasksForReferral(referralLike, {
        completions,
        manualTasks,
        shownTasks,
        taskMetadata,
        toggleTask,
        removeManualTask,
        markTasksAsShown,
        storeTaskMetadata,
        viewerRole,
      });
      acc[referral._id] = result;
      return acc;
    }, {});
  }, [completions, manualTasks, shownTasks, taskMetadata, referrals, removeManualTask, toggleTask, markTasksAsShown, storeTaskMetadata, viewerRole]);

  // Handle side effects for marking tasks as shown and storing metadata
  useEffect(() => {
    Object.values(taskResults).forEach(({ tasks, currentTasks, referralId, referralStatus }) => {
      // Mark all task IDs as shown
      const allTaskIds = tasks.map((t) => t.id);
      const existingShownTasks = shownTasks[referralId] || [];
      
      // Only update if there are new task IDs
      const hasNewTasks = allTaskIds.some(id => !existingShownTasks.includes(id));
      if (hasNewTasks) {
        markTasksAsShown(referralId, allTaskIds);
      }

      // Store metadata for new tasks (only those not already in metadata)
      const metadataToStore = currentTasks
        .filter((task) => {
          const fullTaskId = task.taskId;
          return !taskMetadata[fullTaskId];
        })
        .map((task) => ({
          taskId: task.taskId,
          metadata: {
            title: task.title,
            message: task.message,
            priority: task.priority,
            category: task.category,
            dueAt: task.dueAt,
            supportingMetric: task.supportingMetric,
            isManual: task.isManual,
            createdAt: new Date().toISOString(),
            statusWhenCreated: referralStatus,
          },
        }));

      if (metadataToStore.length > 0) {
        storeTaskMetadata(metadataToStore);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrals, completions, manualTasks, shownTasks, taskMetadata, viewerRole]);

  const tasksByReferral = useMemo(() => {
    return Object.entries(taskResults).reduce<Record<string, ReturnType<typeof buildFollowUpTasksForReferral>['tasks']>>(
      (acc, [id, result]) => {
      acc[id] = result.tasks;
      return acc;
      },
      {}
    );
  }, [taskResults]);

  const flatIncompleteTasks = useMemo(() => {
    return referrals.flatMap((referral) => {
      const tasks = tasksByReferral[referral._id] ?? [];
      return tasks
        .filter((task) => !task.completed)
        .map((task) => ({
          task,
          referral,
          assignmentName: resolvePrimaryAgentName(toReferralLike(referral)),
          statusLabel: getStatusLabel(referral),
        }));
    });
  }, [referrals, tasksByReferral]);

  const { dueTodayTasks, everythingElseTasks } = useMemo(() => {
    const nowSla = utcToZonedTime(new Date(), SLA_TIME_ZONE);
    const startOfToday = zonedTimeToUtc(startOfDay(nowSla), SLA_TIME_ZONE);
    const startOfTomorrow = zonedTimeToUtc(startOfDay(addDays(nowSla, 1)), SLA_TIME_ZONE);

    const dueToday: typeof flatIncompleteTasks = [];
    const everythingElse: typeof flatIncompleteTasks = [];

    const sortByDueAt = (left: (typeof flatIncompleteTasks)[number], right: (typeof flatIncompleteTasks)[number]) => {
      const leftDue = left.task.dueAt ? new Date(left.task.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.task.dueAt ? new Date(right.task.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return leftDue - rightDue;
    };

    flatIncompleteTasks.forEach((item) => {
      if (!item.task.dueAt) {
        everythingElse.push(item);
        return;
      }

      const dueAt = new Date(item.task.dueAt);
      if (Number.isNaN(dueAt.getTime())) {
        everythingElse.push(item);
        return;
      }

      if (dueAt < startOfTomorrow) {
        dueToday.push(item);
      } else {
        everythingElse.push(item);
      }
    });

    dueToday.sort(sortByDueAt);
    everythingElse.sort(sortByDueAt);

    return { dueTodayTasks: dueToday, everythingElseTasks: everythingElse };
  }, [flatIncompleteTasks]);

  const summary = useMemo(() => {
    return Object.values(tasksByReferral).reduce(
      (acc, tasks) => {
        const outstanding = tasks.filter((task) => !task.completed).length;
        return {
          total: acc.total + tasks.length,
          outstanding: acc.outstanding + outstanding,
        };
      },
      { total: 0, outstanding: 0 }
    );
  }, [tasksByReferral]);
  const roleLabel: Record<FollowUpTaskRole, string> = {
    admin: 'Admin/Manager',
    mc: 'MC',
    agent: 'Agent',
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Follow-up tasks</h1>
        <p className="text-sm text-slate-500">
          AI-generated reminders consolidate here so you can coach agents across every active referral.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-slate-900/10 px-3 py-1 font-semibold text-slate-800">
            {summary.outstanding} outstanding
          </span>
          <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-600">
            {summary.total} total suggestions
          </span>
        </div>
      </header>
      <div className="space-y-5">
        {flatIncompleteTasks.length > 0 ? (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Due today</h2>
              {dueTodayTasks.length > 0 ? (
                <ul className="space-y-3">
                  {dueTodayTasks.map(({ task, referral, assignmentName, statusLabel }) => (
                    <li key={task.taskId} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{statusLabel}</p>
                            <Link
                              href={`/referrals/${referral._id}`}
                              className="text-base font-semibold text-slate-900 underline-offset-2 hover:underline"
                            >
                              {referral.borrowerName}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {assignmentName ? `Assigned to ${assignmentName}` : 'Agent assignment pending'}
                            </p>
                          </div>
                          <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
                            {roleLabel[viewerRole]} tasks
                          </span>
                        </div>
                        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                          <button
                            type="button"
                            onClick={task.toggle}
                            className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:bg-slate-100 [will-change:opacity]"
                            aria-pressed={task.completed}
                            aria-label={task.completed ? 'Mark task incomplete' : 'Mark task complete'}
                          >
                            {task.completed ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                          </button>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-900">{task.title}</p>
                              <span className="text-xs uppercase tracking-wide text-slate-400">{task.category}</span>
                              {task.isManual && (
                                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                                  Manual
                                </span>
                              )}
                              {task.isHistorical && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                                  {task.statusWhenCreated ? `From: ${task.statusWhenCreated}` : 'Previous Status'}
                                </span>
                              )}
                              <span className="text-xs font-semibold uppercase text-slate-400">{task.priority}</span>
                            </div>
                            <p className="text-sm text-slate-600">{task.message}</p>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                              {task.supportingMetric && <span>{task.supportingMetric}</span>}
                              {task.dueAt && <span>Due {formatDueDate(task.dueAt)}</span>}
                            </div>
                            {task.isManual && task.remove && (
                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={task.remove}
                                  className="inline-flex items-center rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                                >
                                  Remove task
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                  No tasks due today.
                </div>
              )}
            </section>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Everything else</h2>
              {everythingElseTasks.length > 0 ? (
                <ul className="space-y-3">
                  {everythingElseTasks.map(({ task, referral, assignmentName, statusLabel }) => (
                    <li key={task.taskId} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{statusLabel}</p>
                            <Link
                              href={`/referrals/${referral._id}`}
                              className="text-base font-semibold text-slate-900 underline-offset-2 hover:underline"
                            >
                              {referral.borrowerName}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {assignmentName ? `Assigned to ${assignmentName}` : 'Agent assignment pending'}
                            </p>
                          </div>
                          <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
                            {roleLabel[viewerRole]} tasks
                          </span>
                        </div>
                        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                          <button
                            type="button"
                            onClick={task.toggle}
                            className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:bg-slate-100 [will-change:opacity]"
                            aria-pressed={task.completed}
                            aria-label={task.completed ? 'Mark task incomplete' : 'Mark task complete'}
                          >
                            {task.completed ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                          </button>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-900">{task.title}</p>
                              <span className="text-xs uppercase tracking-wide text-slate-400">{task.category}</span>
                              {task.isManual && (
                                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                                  Manual
                                </span>
                              )}
                              {task.isHistorical && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                                  {task.statusWhenCreated ? `From: ${task.statusWhenCreated}` : 'Previous Status'}
                                </span>
                              )}
                              <span className="text-xs font-semibold uppercase text-slate-400">{task.priority}</span>
                            </div>
                            <p className="text-sm text-slate-600">{task.message}</p>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                              {task.supportingMetric && <span>{task.supportingMetric}</span>}
                              {task.dueAt && <span>Due {formatDueDate(task.dueAt)}</span>}
                            </div>
                            {task.isManual && task.remove && (
                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={task.remove}
                                  className="inline-flex items-center rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                                >
                                  Remove task
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                  No other tasks coming up.
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
            No referrals with incomplete tasks at this time.
          </div>
        )}
      </div>
    </div>
  );
}
