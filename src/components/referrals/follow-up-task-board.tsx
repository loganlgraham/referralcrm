'use client';

import { useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, MailCheck } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

import { useFollowUpTaskContext } from '@/components/referrals/follow-up-task-provider';
import { useFollowUpTasks, getLatestCompletionForReferral } from '@/components/referrals/use-follow-up-tasks';
import {
  computeSlaInsights,
  sortRecommendations,
  type ReferralLike,
  resolvePrimaryAgentName,
  SLA_TIME_ZONE,
} from '@/utils/sla-insights';
import { useTaskReminderEmails } from '@/components/referrals/use-task-reminder-emails';
import { ReminderSettingsToggle } from './reminder-settings-toggle';

interface BoardReferral {
  _id: string;
  borrowerName: string;
  status: string;
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
}

interface FollowUpTasksBoardProps {
  referrals: BoardReferral[];
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
});

const formatDueDate = (value: string): string => {
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch (error) {
    return new Date(value).toLocaleString();
  }
};

export function FollowUpTasksBoard({ referrals }: FollowUpTasksBoardProps) {
  const { completions } = useFollowUpTaskContext();

  const summary = useMemo(() => {
    return referrals.reduce(
      (acc, referral) => {
        const referralLike = toReferralLike(referral);
        const lastCompletedAt = getLatestCompletionForReferral(referral._id, completions);
        const insights = computeSlaInsights(referralLike, { lastCompletedAt });
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
  }, [completions, referrals]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Follow-up tasks</h1>
        <p className="text-sm text-slate-500">
          AI-generated reminders consolidate here so you can coach agents across every active referral.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-brand/10 px-3 py-1 font-medium text-brand">
            {summary.outstanding} outstanding
          </span>
          <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-600">
            {summary.total} total suggestions
          </span>
        </div>
      </header>
      <ReminderSettingsToggle />
      <div className="space-y-5">
        {referrals.map((referral) => (
          <FollowUpTaskGroup key={referral._id} referral={referral} />
        ))}
      </div>
    </div>
  );
}

function FollowUpTaskGroup({ referral }: { referral: BoardReferral }) {
  const referralLike = toReferralLike(referral);
  const tasks = useFollowUpTasks(referralLike);
  const { sendReminders, sendingTaskId, bulkSending, reminderFrequency } = useTaskReminderEmails(referral._id);
  const incompleteTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const outstanding = incompleteTasks.length;
  const assignmentName = resolvePrimaryAgentName(referralLike);

  return (
    <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">{referral.status}</p>
          <h2 className="text-lg font-semibold text-slate-900">{referral.borrowerName}</h2>
          <p className="text-xs text-slate-500">
            {assignmentName ? `Assigned to ${assignmentName}` : 'Agent assignment pending'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
            {outstanding} open task{outstanding === 1 ? '' : 's'}
          </div>
          {outstanding > 0 ? (
            <button
              type="button"
              onClick={() => sendReminders(incompleteTasks, 'bulk')}
              disabled={bulkSending || sendingTaskId !== null}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
              {outstanding > 1
                ? `Email ${reminderFrequency} reminder for outstanding tasks`
                : `Email ${reminderFrequency} reminder`}
            </button>
          ) : null}
        </div>
      </div>
      <ReminderSettingsToggle
        referralId={referral._id}
        helperText="Defaults to your global reminder setting unless you override this referral."
      />
      {tasks.length > 0 ? (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.taskId}
              className={`flex items-start gap-3 rounded-lg border border-slate-200 p-3 ${
                task.completed ? 'bg-slate-50 opacity-70' : 'bg-white'
              }`}
            >
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
                  <p className={`font-medium ${task.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                    {task.title}
                  </p>
                  <span className="text-xs uppercase tracking-wide text-slate-400">{task.category}</span>
                  {task.isManual && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                      Manual
                    </span>
                  )}
                  <span className="text-xs font-semibold uppercase text-slate-400">{task.priority}</span>
                </div>
                <p className={`text-sm ${task.completed ? 'text-slate-500' : 'text-slate-600'}`}>{task.message}</p>
                <div className={`flex flex-wrap items-center gap-3 text-xs ${task.completed ? 'text-slate-400' : 'text-slate-500'}`}>
                  {task.supportingMetric && <span>{task.supportingMetric}</span>}
                  {task.dueAt && <span>Due {formatDueDate(task.dueAt)}</span>}
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => sendReminders([task], 'single')}
                    disabled={bulkSending || (sendingTaskId !== null && sendingTaskId !== task.taskId)}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sendingTaskId === task.taskId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MailCheck className="h-4 w-4" />
                    )}
                    {sendingTaskId === task.taskId ? 'Sending…' : `Email ${reminderFrequency} reminder`}
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
