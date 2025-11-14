'use client';

import { FormEvent, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, Circle, Loader2 } from 'lucide-react';

import { useFollowUpTasks } from '@/components/referrals/use-follow-up-tasks';
import type { ReferralLike } from '@/utils/sla-insights';
import { useCalendarTaskSubmission } from '@/components/referrals/use-calendar-task-submission';
import { useFollowUpTaskContext, type ManualTaskCategory } from '@/components/referrals/follow-up-task-provider';
import type { RecommendationPriority } from '@/utils/sla-insights';
import { toast } from 'sonner';

interface ReferralFollowUpCardProps {
  referral: ReferralLike & {
    borrower?: { name?: string };
  };
}

const PRIORITY_OPTIONS: RecommendationPriority[] = ['urgent', 'high', 'medium', 'low'];
const CATEGORY_OPTIONS: ManualTaskCategory[] = ['assignment', 'communication', 'pipeline', 'finance', 'ops'];

export function ReferralFollowUpCard({ referral }: ReferralFollowUpCardProps) {
  const tasks = useFollowUpTasks(referral);
  const hasTasks = tasks.length > 0;
  const incompleteTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const { submitTasks, addingTaskId, bulkAdding } = useCalendarTaskSubmission();
  const { addManualTask } = useFollowUpTaskContext();

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualMessage, setManualMessage] = useState('');
  const [manualDueAt, setManualDueAt] = useState('');
  const [manualPriority, setManualPriority] = useState<RecommendationPriority>('medium');
  const [manualCategory, setManualCategory] = useState<ManualTaskCategory>('communication');

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = manualTitle.trim();
    if (!title) {
      toast.error('Add a task name before saving.');
      return;
    }

    let dueAt: string | null = null;
    if (manualDueAt) {
      const dueDate = new Date(manualDueAt);
      if (!Number.isNaN(dueDate.getTime())) {
        dueAt = dueDate.toISOString();
      }
    }

    addManualTask(referral._id, {
      title,
      message: manualMessage.trim() || title,
      dueAt,
      priority: manualPriority,
      category: manualCategory,
    });

    setManualTitle('');
    setManualMessage('');
    setManualDueAt('');
    setManualPriority('medium');
    setManualCategory('communication');
    setShowManualForm(false);
    toast.success('Manual task added');
  };

  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Follow-up tasks</h2>
        <p className="text-xs text-slate-500">
          These action items stay in sync with the follow-up task board so your team sees one shared checklist.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-500">
          {hasTasks
            ? `${incompleteTasks.length} of ${tasks.length} tasks outstanding`
            : 'No AI tasks yet — add your own to get started.'}
        </div>
        <button
          type="button"
          onClick={() => setShowManualForm((previous) => !previous)}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {showManualForm ? 'Cancel manual task' : 'Add manual task'}
        </button>
      </div>
      {showManualForm && (
        <form onSubmit={handleManualSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Task name
              <input
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="Call the borrower"
                required
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Due by
              <input
                type="datetime-local"
                value={manualDueAt}
                onChange={(event) => setManualDueAt(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Priority
              <select
                value={manualPriority}
                onChange={(event) => setManualPriority(event.target.value as RecommendationPriority)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Category
              <select
                value={manualCategory}
                onChange={(event) => setManualCategory(event.target.value as ManualTaskCategory)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Details
            <textarea
              value={manualMessage}
              onChange={(event) => setManualMessage(event.target.value)}
              rows={3}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Add context or talking points"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-brand-dark"
            >
              Save manual task
            </button>
          </div>
        </form>
      )}
      {hasTasks ? (
        <>
          {incompleteTasks.length > 0 ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => submitTasks(incompleteTasks, 'bulk')}
                disabled={bulkAdding || addingTaskId !== null}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarPlus className="h-4 w-4" />
                )}
                {incompleteTasks.length > 1
                  ? 'Add outstanding tasks to Google Calendar'
                  : 'Add task to Google Calendar'}
              </button>
            </div>
          ) : null}
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                <button
                  type="button"
                  onClick={task.toggle}
                  className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-slate-500 transition hover:bg-slate-100 ${
                    task.completed ? 'border-emerald-500 text-emerald-600' : 'border-slate-300'
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
                  </div>
                  <p className="text-sm text-slate-600">{task.message}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="font-medium uppercase text-slate-400">{task.priority}</span>
                    {task.supportingMetric && <span>{task.supportingMetric}</span>}
                    {task.dueAt && <span>Due {new Date(task.dueAt).toLocaleString()}</span>}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => submitTasks([task], 'single')}
                      disabled={bulkAdding || (addingTaskId !== null && addingTaskId !== task.taskId)}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {addingTaskId === task.taskId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CalendarPlus className="h-4 w-4" />
                      )}
                      {addingTaskId === task.taskId ? 'Adding…' : 'Add to Google Calendar'}
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
        </>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          No outstanding follow-ups. Keep monitoring the AI coach for fresh recommendations.
        </div>
      )}
    </section>
  );
}
