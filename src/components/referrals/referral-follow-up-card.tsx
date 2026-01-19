'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckCircle2, Circle } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

import { useFollowUpTasks, type FollowUpTaskRole } from '@/components/referrals/use-follow-up-tasks';
import { useFollowUpTaskContext, type ManualTaskCategory } from '@/components/referrals/follow-up-task-provider';
import { SLA_TIME_ZONE, type RecommendationPriority, type ReferralLike } from '@/utils/sla-insights';
import { toast } from 'sonner';

interface ReferralFollowUpCardProps {
  referral: ReferralLike & {
    borrower?: { name?: string };
  };
}

const PRIORITY_OPTIONS: RecommendationPriority[] = ['urgent', 'high', 'medium', 'low'];
const CATEGORY_OPTIONS: ManualTaskCategory[] = ['assignment', 'communication', 'pipeline', 'finance', 'ops'];

export function ReferralFollowUpCard({ referral }: ReferralFollowUpCardProps) {
  const { data: session } = useSession();
  const viewerRole = useMemo<FollowUpTaskRole>(() => {
    const role = session?.user?.role;
    if (role === 'mc') return 'mc';
    if (role === 'agent') return 'agent';
    return 'admin';
  }, [session?.user?.role]);

  const tasks = useFollowUpTasks(referral, viewerRole);
  const hasTasks = tasks.length > 0;
  const incompleteTasks = useMemo(() => {
    const incomplete = tasks.filter((task) => !task.completed);
    console.log('Incomplete tasks:', incomplete.length, incomplete);
    return incomplete;
  }, [tasks]);
  const completedTasks = useMemo(() => {
    const completed = tasks.filter((task) => task.completed);
    console.log('Completed tasks:', completed.length, completed);
    return completed;
  }, [tasks]);
  const { addManualTask } = useFollowUpTaskContext();
  
  console.log('All tasks:', tasks.length, tasks);
  console.log('Should show completed link?', completedTasks.length > 0);

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualMessage, setManualMessage] = useState('');
  const [manualDueAt, setManualDueAt] = useState('');
  const [manualPriority, setManualPriority] = useState<RecommendationPriority>('medium');
  const [manualCategory, setManualCategory] = useState<ManualTaskCategory>('communication');
  const [showCompleted, setShowCompleted] = useState(false);

  const formatDueDate = (value: string): string => {
    try {
      return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
    } catch (error) {
      return new Date(value).toLocaleString();
    }
  };

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
            ? incompleteTasks.length > 0
              ? `${incompleteTasks.length} of ${tasks.length} tasks outstanding`
              : 'All tasks completed'
            : null}
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
              className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-800"
            >
              Save manual task
            </button>
          </div>
        </form>
      )}
      {hasTasks ? (
        <>
          {incompleteTasks.length > 0 ? (
            <ul className="space-y-3">
              {incompleteTasks.map((task) => (
                <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <button
                    type="button"
                    onClick={task.toggle}
                    className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-slate-500 transition hover:bg-slate-100 ${
                      task.completed ? 'border-slate-500 text-slate-700' : 'border-slate-300'
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
                      {task.isHistorical && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          {task.statusWhenCreated ? `From: ${task.statusWhenCreated}` : 'Previous Status'}
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
                      <div className="mt-3">
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
              No outstanding follow-ups. Keep monitoring the AI coach for fresh recommendations.
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
                          {task.isHistorical && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                              {task.statusWhenCreated ? `From: ${task.statusWhenCreated}` : 'Previous Status'}
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
                          <div className="mt-3">
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
          No outstanding follow-ups. Keep monitoring the AI coach for fresh recommendations.
        </div>
      )}
    </section>
  );
}
