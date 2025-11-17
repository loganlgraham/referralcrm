'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, Circle, Loader2 } from 'lucide-react';

import { useFollowUpTaskContext } from '@/components/referrals/follow-up-task-provider';
import { useFollowUpTasks, type FollowUpTask } from '@/components/referrals/use-follow-up-tasks';
import { computeSlaInsights, sortRecommendations, type ReferralLike } from '@/utils/sla-insights';
import { useCalendarTaskSubmission } from '@/components/referrals/use-calendar-task-submission';

interface BoardReferral {
  _id: string;
  borrowerName: string;
  status: string;
  createdAt: string;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  lenderName?: string | null;
  origin?: 'agent' | 'mc' | 'admin' | null;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
}

interface FollowUpTasksBoardProps {
  referrals: BoardReferral[];
  viewerRole?: 'admin' | 'manager' | 'mc' | 'agent' | 'viewer';
}

interface TaskSnapshot {
  outstanding: FollowUpTask[];
  all: FollowUpTask[];
}

const toReferralLike = (
  referral: BoardReferral,
  viewerRole?: FollowUpTasksBoardProps['viewerRole']
): ReferralLike & { borrower: { name: string } } => ({
  _id: referral._id,
  createdAt: referral.createdAt,
  status: referral.status,
  statusLastUpdated: referral.statusLastUpdated ?? null,
  daysInStatus: referral.daysInStatus,
  assignedAgent: referral.assignedAgentName ? { name: referral.assignedAgentName } : null,
  assignedAgentName: referral.assignedAgentName,
  lender: referral.lenderName ? { name: referral.lenderName } : null,
  origin: referral.origin ?? undefined,
  viewerRole,
  dealStatus: referral.dealStatus ?? null,
  dealStatusLabel: referral.dealStatusLabel ?? null,
  borrower: { name: referral.borrowerName },
  notes: [],
  payments: [],
  audit: [],
});

export function FollowUpTasksBoard({ referrals, viewerRole }: FollowUpTasksBoardProps) {
  const { completions } = useFollowUpTaskContext();
  const [taskSnapshots, setTaskSnapshots] = useState<Record<string, TaskSnapshot>>({});
  const {
    submitTasks: submitAllTasks,
    addingTaskId: addingAllTaskId,
    bulkAdding: bulkAddingAll,
  } = useCalendarTaskSubmission();

  const summaryFallback = useMemo(() => {
    return referrals.reduce(
      (acc, referral) => {
        const referralLike = toReferralLike(referral, viewerRole);
        const insights = computeSlaInsights(referralLike, { viewerRole });
        const ordered = sortRecommendations(insights.recommendations);
        const outstanding = ordered.filter((item) => {
          const taskId = `${referral._id}::${item.id}`;
          return !(completions[taskId]?.completed ?? false);
        });
        return {
          total: acc.total + ordered.length,
          outstanding: acc.outstanding + outstanding.length,
        };
      },
      { total: 0, outstanding: 0 }
    );
  }, [completions, referrals, viewerRole]);

  const summaryFromSnapshots = useMemo(() => {
    if (Object.keys(taskSnapshots).length === 0) {
      return null;
    }
    return Object.values(taskSnapshots).reduce(
      (acc, snapshot) => ({
        total: acc.total + snapshot.all.length,
        outstanding: acc.outstanding + snapshot.outstanding.length,
      }),
      { total: 0, outstanding: 0 }
    );
  }, [taskSnapshots]);

  const summary = summaryFromSnapshots ?? summaryFallback;
  const outstandingTasks = useMemo(() => {
    return Object.values(taskSnapshots).flatMap((snapshot) => snapshot?.outstanding ?? []);
  }, [taskSnapshots]);
  const addAllDisabled =
    outstandingTasks.length === 0 || bulkAddingAll || addingAllTaskId !== null;

  const handleTaskSnapshot = useCallback(
    (referralId: string, all: FollowUpTask[], outstanding: FollowUpTask[]) => {
      setTaskSnapshots((previous) => ({ ...previous, [referralId]: { all, outstanding } }));
    },
    []
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Follow-up tasks</h1>
        <p className="text-sm text-slate-500">
          AI-generated reminders consolidate here so you can coach agents across every active referral.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/10 px-3 py-1 font-medium text-brand">
              {summary.outstanding} outstanding
            </span>
            <button
              type="button"
              onClick={() => submitAllTasks(outstandingTasks, 'bulk')}
              disabled={addAllDisabled}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-brand/30 bg-white text-brand transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Add all outstanding tasks to Google Calendar"
            >
              {bulkAddingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
            </button>
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-600">
            {summary.total} total suggestions
          </span>
        </div>
      </header>
      {referrals.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white/60 p-6 text-sm text-slate-600">
          No referrals are available for follow-ups right now. If you recently added a referral, refresh in a moment and try again.
        </div>
      ) : (
        <div className="space-y-5">
          {referrals.map((referral) => (
            <FollowUpTaskGroup
              key={referral._id}
              referral={referral}
              viewerRole={viewerRole}
              onTasksSnapshot={handleTaskSnapshot}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpTaskGroup({
  referral,
  viewerRole,
  onTasksSnapshot,
}: {
  referral: BoardReferral;
  viewerRole?: FollowUpTasksBoardProps['viewerRole'];
  onTasksSnapshot?: (referralId: string, all: FollowUpTask[], outstanding: FollowUpTask[]) => void;
}) {
  const referralLike = toReferralLike(referral, viewerRole);
  const tasks = useFollowUpTasks(referralLike, { viewerRole });
  const { submitTasks, addingTaskId, bulkAdding } = useCalendarTaskSubmission();
  const incompleteTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const outstanding = incompleteTasks.length;

  useEffect(() => {
    onTasksSnapshot?.(referral._id, tasks, incompleteTasks);
  }, [incompleteTasks, onTasksSnapshot, referral._id, tasks]);

  return (
    <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">{referral.status}</p>
          <h2 className="text-lg font-semibold text-slate-900">{referral.borrowerName}</h2>
          <p className="text-xs text-slate-500">
            {referral.assignedAgentName
              ? `Assigned to ${referral.assignedAgentName}`
              : 'Agent assignment pending'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
            {outstanding} open task{outstanding === 1 ? '' : 's'}
          </div>
          {outstanding > 0 ? (
            <button
              type="button"
              onClick={() => submitTasks(incompleteTasks, 'bulk')}
              disabled={bulkAdding || addingTaskId !== null}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
              {outstanding > 1 ? 'Add outstanding tasks to Google Calendar' : 'Add task to Google Calendar'}
            </button>
          ) : null}
        </div>
      </div>
      {tasks.length > 0 ? (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <button
                type="button"
                onClick={task.toggle}
                className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border transition hover:bg-slate-100 ${
                  task.completed ? 'border-emerald-500 text-emerald-600' : 'border-slate-300 text-slate-500'
                }`}
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
                  <span className="text-xs font-semibold uppercase text-slate-400">{task.priority}</span>
                </div>
                <p className="text-sm text-slate-600">{task.message}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {task.supportingMetric && <span>{task.supportingMetric}</span>}
                  {task.dueAt && <span>Due {new Date(task.dueAt).toLocaleString()}</span>}
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => submitTasks([task], 'single')}
                    disabled={
                      bulkAdding || (addingTaskId !== null && addingTaskId !== task.taskId)
                    }
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Add this task to Google Calendar"
                  >
                    {addingTaskId === task.taskId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CalendarPlus className="h-4 w-4" />
                    )}
                  </button>
                  {task.isManual && task.remove && (
                    <button
                      type="button"
                      onClick={task.remove}
                      className="ml-2 inline-flex items-center rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                    >
                      Remove task
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          Nothing on deck—this referral is on track.
        </div>
      )}
    </section>
  );
}
