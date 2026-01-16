'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

import { useFollowUpTaskContext } from '@/components/referrals/follow-up-task-provider';
import {
  buildFollowUpTasksForReferral,
  type FollowUpTask,
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
  const { completions, manualTasks, toggleTask, removeManualTask } = useFollowUpTaskContext();

  const tasksByReferral = useMemo(() => {
    return referrals.reduce<Record<string, FollowUpTask[]>>((acc, referral) => {
      const referralLike = toReferralLike(referral);
      const tasks = buildFollowUpTasksForReferral(referralLike, {
        completions,
        manualTasks,
        toggleTask,
        removeManualTask,
        viewerRole,
      });
      acc[referral._id] = tasks;
      return acc;
    }, {});
  }, [completions, manualTasks, referrals, removeManualTask, toggleTask, viewerRole]);

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
        {referrals.map((referral) => (
          <FollowUpTaskGroup
            key={referral._id}
            referral={referral}
            tasks={tasksByReferral[referral._id] ?? []}
            viewerRole={viewerRole}
          />
        ))}
      </div>
    </div>
  );
}

function FollowUpTaskGroup({
  referral,
  tasks,
  viewerRole,
}: {
  referral: BoardReferral;
  tasks: FollowUpTask[];
  viewerRole: FollowUpTaskRole;
}) {
  const referralLike = toReferralLike(referral);
  const roleFilteredTasks = useMemo(
    () => tasks.filter((task) => task.role === viewerRole),
    [tasks, viewerRole]
  );
  const incompleteTasks = useMemo(
    () => roleFilteredTasks.filter((task) => !task.completed),
    [roleFilteredTasks]
  );
  const completedTasks = useMemo(
    () => roleFilteredTasks.filter((task) => task.completed),
    [roleFilteredTasks]
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const outstanding = incompleteTasks.length;
  const assignmentName = resolvePrimaryAgentName(referralLike);
  const roleLabel: Record<FollowUpTaskRole, string> = {
    admin: 'Admin/Manager tasks',
    mc: 'MC tasks',
    agent: 'Agent tasks',
  };

  return (
    <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{getStatusLabel(referral)}</p>
          <Link href={`/referrals/${referral._id}`} className="text-lg font-semibold text-slate-900 underline-offset-2 hover:underline">
            {referral.borrowerName}
          </Link>
          <p className="text-xs text-slate-500">
            {assignmentName ? `Assigned to ${assignmentName}` : 'Agent assignment pending'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
            {outstanding} open task{outstanding === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {roleLabel[viewerRole]}
      </p>
      {roleFilteredTasks.length > 0 ? (
        <>
          {incompleteTasks.length > 0 ? (
            <ul className="space-y-3">
              {incompleteTasks.map((task) => (
                <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <button
                    type="button"
                    onClick={task.toggle}
                    className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:bg-slate-100"
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
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
              Nothing on deck—this referral is on track.
            </div>
          )}
          {completedTasks.length > 0 && (
            <div className="border-t border-slate-200 pt-3 text-xs text-slate-600">
              <button
                type="button"
                className="font-semibold text-slate-700 underline underline-offset-4"
                onClick={() => setShowCompleted((previous) => !previous)}
              >
                {showCompleted
                  ? 'Hide completed tasks'
                  : `Show ${completedTasks.length} completed ${completedTasks.length === 1 ? 'task' : 'tasks'}`}
              </button>
              {showCompleted && (
                <ul className="mt-3 space-y-3">
                  {completedTasks.map((task) => (
                    <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <button
                        type="button"
                        onClick={task.toggle}
                        className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 text-slate-700 transition hover:bg-slate-100"
                        aria-pressed={task.completed}
                        aria-label="Mark task incomplete"
                      >
                        <CheckCircle2 className="h-5 w-5" />
                      </button>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900 line-through">{task.title}</p>
                          <span className="text-xs uppercase tracking-wide text-slate-400">{task.category}</span>
                          {task.isManual && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                              Manual
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600">{task.message}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span className="font-medium uppercase text-slate-400">{task.priority}</span>
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          No {roleLabel[viewerRole].toLowerCase()} for this referral right now.
        </div>
      )}
    </section>
  );
}
