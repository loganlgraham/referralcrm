'use client';

import { FormEvent, useMemo, useState } from 'react';
import useSWR from 'swr';
import { formatInTimeZone } from 'date-fns-tz';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';

const SLA_TIME_ZONE = 'America/Denver';

interface AdminTask {
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
  effectiveDueAt?: string | null;
  createdAt: string;
  createdBy: string;
}

interface AdminTasksCardProps {
  referralId: string;
  viewerRole: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatDueDate(value: string | null | undefined): string {
  if (!value) return 'No due date';
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch {
    return new Date(value).toLocaleString();
  }
}

function getDueBucket(effectiveDue: string | null | undefined): number {
  if (!effectiveDue) return 4;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(effectiveDue);
  const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = dueDate.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 0;
  if (diffDays === 0) return 1;
  if (diffDays <= 7) return 2;
  return 3;
}

export function AdminTasksCard({ referralId, viewerRole }: AdminTasksCardProps) {
  if (viewerRole !== 'admin') {
    return null;
  }

  const [statusFilter, setStatusFilter] = useState<'open' | 'completed'>('open');
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDueAt, setManualDueAt] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState('');
  const [dueOverride, setDueOverride] = useState('');

  const tasksUrl = `/api/admin/tasks?referralId=${referralId}&status=${statusFilter}`;
  const { data: tasks = [], mutate } = useSWR<AdminTask[]>(tasksUrl, fetcher);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const bucketA = getDueBucket(a.effectiveDueAt);
      const bucketB = getDueBucket(b.effectiveDueAt);
      if (bucketA !== bucketB) return bucketA - bucketB;
      const dateA = a.effectiveDueAt ? new Date(a.effectiveDueAt).getTime() : Infinity;
      const dateB = b.effectiveDueAt ? new Date(b.effectiveDueAt).getTime() : Infinity;
      return dateA - dateB;
    });
  }, [tasks]);

  const { overdueAndToday, upcoming } = useMemo(() => {
    const overdueAndToday: AdminTask[] = [];
    const upcoming: AdminTask[] = [];
    for (const task of sortedTasks) {
      const bucket = getDueBucket(task.effectiveDueAt);
      if (bucket === 0 || bucket === 1) {
        overdueAndToday.push(task);
      } else {
        upcoming.push(task);
      }
    }
    return { overdueAndToday, upcoming };
  }, [sortedTasks]);

  const handleComplete = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task completed');
      void mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete task');
    }
  };

  const handleDismiss = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task dismissed');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss task');
    }
  };

  const handleSnooze = async (taskId: string) => {
    const until = snoozeUntil ? new Date(snoozeUntil) : null;
    if (!until || Number.isNaN(until.getTime())) {
      toast.error('Select a valid snooze date');
      return;
    }
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', snoozedUntil: until.toISOString() }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task snoozed');
      void mutate();
      setSnoozeUntil('');
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to snooze task');
    }
  };

  const handleUnsnooze = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsnooze' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Snooze cleared');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unsnooze task');
    }
  };

  const handleSetDueOverride = async (taskId: string, overrideValue: string | null) => {
    const override = overrideValue ? new Date(overrideValue) : null;
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_due_override',
          dueAtOverride: override && !Number.isNaN(override.getTime()) ? override.toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(override ? 'Due date updated' : 'Due date override cleared');
      void mutate();
      setDueOverride('');
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update due date');
    }
  };

  const handleManualSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = manualTitle.trim();
    if (!title) {
      toast.error('Add a task name before saving.');
      return;
    }
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralId,
          title,
          dueAt: manualDueAt ? new Date(manualDueAt).toISOString() : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task created');
      void mutate();
      setManualTitle('');
      setManualDueAt('');
      setShowManualForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Tasks</h2>
          <p className="text-xs text-slate-500">Admin tasks for this referral.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'open' ? 'completed' : 'open')}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            {statusFilter === 'open' ? 'Show completed' : 'Show open'}
          </button>
          {statusFilter === 'open' && (
            <button
              type="button"
              onClick={() => setShowManualForm(!showManualForm)}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark"
            >
              <Plus className="h-3.5 w-3.5" /> Add task
            </button>
          )}
        </div>
      </div>

      {showManualForm && (
        <form onSubmit={handleManualSubmit} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            type="text"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder="Task name"
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={manualDueAt}
            onChange={(e) => setManualDueAt(e.target.value)}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowManualForm(false);
                setManualTitle('');
                setManualDueAt('');
              }}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-2">
        {statusFilter === 'open' ? (
          overdueAndToday.length === 0 && upcoming.length === 0 ? (
            <li className="py-4 text-center text-sm text-slate-500">No open tasks</li>
          ) : (
            <>
              {overdueAndToday.map((task) => (
            <li
              key={task._id}
              className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
            >
              {statusFilter === 'open' ? (
                <button
                  type="button"
                  onClick={() => handleComplete(task._id)}
                  className="mt-0.5 shrink-0 text-slate-400 transition hover:text-brand"
                  title="Complete"
                >
                  <Circle className="h-5 w-5" />
                </button>
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {formatDueDate(task.effectiveDueAt ?? task.dueAt)}
                  {task.snoozedUntil && new Date(task.snoozedUntil) > new Date() && (
                    <span className="ml-1 text-amber-600">(snoozed)</span>
                  )}
                </p>
                {expandedTaskId === task._id && statusFilter === 'open' && (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    {task.ruleKey && (
                      <button
                        type="button"
                        onClick={() => handleDismiss(task._id)}
                        className="block text-xs font-semibold text-rose-600 hover:underline"
                      >
                        Dismiss
                      </button>
                    )}
                    {task.snoozedUntil && new Date(task.snoozedUntil) > new Date() ? (
                      <button
                        type="button"
                        onClick={() => handleUnsnooze(task._id)}
                        className="block text-xs font-semibold text-slate-600 hover:underline"
                      >
                        Unsnooze
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={snoozeUntil}
                          onChange={(e) => setSnoozeUntil(e.target.value)}
                          className="rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleSnooze(task._id)}
                          className="text-xs font-semibold text-slate-600 hover:underline"
                        >
                          Snooze
                        </button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="datetime-local"
                        value={dueOverride}
                        onChange={(e) => setDueOverride(e.target.value)}
                        placeholder="Override due date"
                        className="rounded border border-slate-200 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleSetDueOverride(task._id, null)}
                        className="text-xs font-semibold text-slate-600 hover:underline"
                      >
                        Clear override
                      </button>
                      {dueOverride && (
                        <button
                          type="button"
                          onClick={() => handleSetDueOverride(task._id, dueOverride)}
                          className="text-xs font-semibold text-brand hover:underline"
                        >
                          Set override
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {statusFilter === 'open' && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedTaskId(expandedTaskId === task._id ? null : task._id)
                  }
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              )}
            </li>
              ))}
              {upcoming.length > 0 && (
                <li className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowUpcoming(!showUpcoming)}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    {showUpcoming ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Upcoming tasks ({upcoming.length})
                  </button>
                  {showUpcoming && (
                    <ul className="mt-2 space-y-2">
                      {upcoming.map((task) => (
                        <li
                          key={task._id}
                          className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                        >
                          <button
                            type="button"
                            onClick={() => handleComplete(task._id)}
                            className="mt-0.5 shrink-0 text-slate-400 transition hover:text-brand"
                            title="Complete"
                          >
                            <Circle className="h-5 w-5" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900">{task.title}</p>
                            <p className="text-xs text-slate-500">
                              {formatDueDate(task.effectiveDueAt ?? task.dueAt)}
                              {task.snoozedUntil && new Date(task.snoozedUntil) > new Date() && (
                                <span className="ml-1 text-amber-600">(snoozed)</span>
                              )}
                            </p>
                            {expandedTaskId === task._id && (
                              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                                {task.ruleKey && (
                                  <button
                                    type="button"
                                    onClick={() => handleDismiss(task._id)}
                                    className="block text-xs font-semibold text-rose-600 hover:underline"
                                  >
                                    Dismiss
                                  </button>
                                )}
                                {task.snoozedUntil && new Date(task.snoozedUntil) > new Date() ? (
                                  <button
                                    type="button"
                                    onClick={() => handleUnsnooze(task._id)}
                                    className="block text-xs font-semibold text-slate-600 hover:underline"
                                  >
                                    Unsnooze
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="datetime-local"
                                      value={snoozeUntil}
                                      onChange={(e) => setSnoozeUntil(e.target.value)}
                                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSnooze(task._id)}
                                      className="text-xs font-semibold text-slate-600 hover:underline"
                                    >
                                      Snooze
                                    </button>
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="datetime-local"
                                    value={dueOverride}
                                    onChange={(e) => setDueOverride(e.target.value)}
                                    placeholder="Override due date"
                                    className="rounded border border-slate-200 px-2 py-1 text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSetDueOverride(task._id, null)}
                                    className="text-xs font-semibold text-slate-600 hover:underline"
                                  >
                                    Clear override
                                  </button>
                                  {dueOverride && (
                                    <button
                                      type="button"
                                      onClick={() => handleSetDueOverride(task._id, dueOverride)}
                                      className="text-xs font-semibold text-brand hover:underline"
                                    >
                                      Set override
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTaskId(expandedTaskId === task._id ? null : task._id)
                            }
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
            </>
          )
        ) : sortedTasks.length === 0 ? (
          <li className="py-4 text-center text-sm text-slate-500">No completed tasks</li>
        ) : (
          sortedTasks.map((task) => (
            <li
              key={task._id}
              className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {formatDueDate(task.effectiveDueAt ?? task.dueAt)}
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
