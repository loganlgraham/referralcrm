'use client';

import { useCallback, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useFollowUpTasks } from '@/components/referrals/use-follow-up-tasks';
import type { ReferralLike } from '@/utils/sla-insights';

interface ReferralFollowUpCardProps {
  referral: ReferralLike & {
    borrower?: { name?: string };
  };
}

export function ReferralFollowUpCard({ referral }: ReferralFollowUpCardProps) {
  const tasks = useFollowUpTasks(referral);
  const hasTasks = tasks.length > 0;
  const incompleteTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const [addingTaskId, setAddingTaskId] = useState<string | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);

  const submitTasksToCalendar = useCallback(
    async (selected: typeof tasks, mode: 'single' | 'bulk') => {
      if (selected.length === 0) {
        toast.info('No tasks available to add to Google Calendar.');
        return;
      }

      if (mode === 'single') {
        setAddingTaskId(selected[0]?.taskId ?? null);
      } else {
        setBulkAdding(true);
      }

      try {
        const response = await fetch('/api/integrations/google/calendar/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: selected.map((task) => ({
              taskId: task.taskId,
              title: task.title,
              message: task.message,
              dueAt: task.dueAt ?? null,
              referralName: task.referralName ?? null,
              priority: task.priority,
              category: task.category,
            })),
          }),
        });

        if (response.ok) {
          const result = (await response.json().catch(() => ({ created: selected.length }))) as {
            created?: number;
          };
          const createdCount = typeof result.created === 'number' ? result.created : selected.length;
          if (mode === 'single') {
            toast.success('Task added to Google Calendar.');
          } else if (createdCount > 0) {
            toast.success(
              `${createdCount} task${createdCount === 1 ? '' : 's'} added to Google Calendar.`
            );
          } else {
            toast.info('No tasks were added to Google Calendar.');
          }
          return;
        }

        const errorPayload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message = errorPayload?.error;

        if (response.status === 412) {
          toast.error(
            message ??
              'Connect your Google account with calendar permissions to add tasks to Google Calendar.'
          );
          return;
        }

        if (response.status === 503) {
          toast.error(message ?? 'Google Calendar integration is not configured.');
          return;
        }

        toast.error(message ?? 'Unable to add task to Google Calendar.');
      } catch (error) {
        console.error('Failed to add follow-up tasks to Google Calendar', error);
        toast.error('Unable to add task to Google Calendar. Please try again later.');
      } finally {
        if (mode === 'single') {
          setAddingTaskId(null);
        } else {
          setBulkAdding(false);
        }
      }
    },
    []
  );

  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Follow-up tasks</h2>
        <p className="text-xs text-slate-500">
          These action items stay in sync with the follow-up task board so your team sees one shared checklist.
        </p>
      </div>
      {hasTasks ? (
        <>
          {incompleteTasks.length > 0 ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => submitTasksToCalendar(incompleteTasks, 'bulk')}
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
                      onClick={() => submitTasksToCalendar([task], 'single')}
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
