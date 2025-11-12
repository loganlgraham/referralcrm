'use client';

import { useMemo } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

import { useFollowUpTaskContext } from '@/components/referrals/follow-up-task-provider';
import { useFollowUpTasks } from '@/components/referrals/use-follow-up-tasks';
import { computeSlaInsights, sortRecommendations, type ReferralLike } from '@/utils/sla-insights';

interface BoardReferral {
  _id: string;
  borrowerName: string;
  status: string;
  createdAt: string;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
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
  assignedAgent: referral.assignedAgentName ? { name: referral.assignedAgentName } : null,
  assignedAgentName: referral.assignedAgentName,
  borrower: { name: referral.borrowerName },
  notes: [],
  payments: [],
  audit: [],
});

export function FollowUpTasksBoard({ referrals }: FollowUpTasksBoardProps) {
  const { completions } = useFollowUpTaskContext();

  const summary = useMemo(() => {
    return referrals.reduce(
      (acc, referral) => {
        const referralLike = toReferralLike(referral);
        const insights = computeSlaInsights(referralLike);
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
  const outstanding = tasks.filter((task) => !task.completed).length;

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
        <div className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
          {outstanding} open task{outstanding === 1 ? '' : 's'}
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
                  <span className="text-xs font-semibold uppercase text-slate-400">{task.priority}</span>
                </div>
                <p className="text-sm text-slate-600">{task.message}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {task.supportingMetric && <span>{task.supportingMetric}</span>}
                  {task.dueAt && <span>Due {new Date(task.dueAt).toLocaleString()}</span>}
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
