'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Loader2, RefreshCcw, Undo2 } from 'lucide-react';

import { FollowUpTask, getFollowUpTaskId } from '@/lib/follow-ups';

interface FollowUpResponseMeta {
  source?: 'ai' | 'fallback';
  reason?: string;
}

interface FollowUpCompletionEntry {
  taskId: string;
  completedAt: string;
  completedBy?: { id: string; name?: string | null };
}

interface FollowUpResponse {
  generatedAt: string;
  tasks: FollowUpTask[];
  completed: FollowUpCompletionEntry[];
  meta?: FollowUpResponseMeta;
}

interface AdminFollowUpTasksPanelProps {
  referralId: string;
  showHeader?: boolean;
  variant?: 'card' | 'plain';
  className?: string;
}

const audienceStyles: Record<FollowUpTask['audience'], string> = {
  Agent: 'bg-sky-50 text-sky-700 ring-sky-100',
  MC: 'bg-amber-50 text-amber-700 ring-amber-100',
  Referral: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
};

const urgencyStyles: Record<FollowUpTask['urgency'], string> = {
  High: 'text-rose-600',
  Medium: 'text-amber-600',
  Low: 'text-slate-500',
};

export function AdminFollowUpTasksPanel({
  referralId,
  showHeader = true,
  variant = 'card',
  className,
}: AdminFollowUpTasksPanelProps) {
  const [data, setData] = useState<FollowUpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutatingTask, setMutatingTask] = useState<string | null>(null);

  const normalizePayload = useCallback((payload: unknown): FollowUpResponse | null => {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const generatedAtRaw = (payload as { generatedAt?: unknown }).generatedAt;
    const rawTasks = Array.isArray((payload as { tasks?: unknown }).tasks)
      ? ((payload as { tasks: unknown[] }).tasks ?? [])
      : [];
    const rawCompleted = Array.isArray((payload as { completed?: unknown }).completed)
      ? ((payload as { completed: unknown[] }).completed ?? [])
      : [];
    const meta = (payload as { meta?: FollowUpResponseMeta }).meta;

    const tasks = rawTasks
      .map((task) => {
        if (!task || typeof task !== 'object') {
          return null;
        }
        const audience = (task as { audience?: unknown }).audience;
        const title = (task as { title?: unknown }).title;
        const summary = (task as { summary?: unknown }).summary;
        const suggestedChannel = (task as { suggestedChannel?: unknown }).suggestedChannel;
        const urgency = (task as { urgency?: unknown }).urgency;

        if (
          (audience !== 'Agent' && audience !== 'MC' && audience !== 'Referral') ||
          typeof title !== 'string' ||
          typeof summary !== 'string' ||
          (suggestedChannel !== 'Phone' &&
            suggestedChannel !== 'Email' &&
            suggestedChannel !== 'Text' &&
            suggestedChannel !== 'Internal') ||
          (urgency !== 'Low' && urgency !== 'Medium' && urgency !== 'High')
        ) {
          return null;
        }

        return {
          audience,
          title,
          summary,
          suggestedChannel,
          urgency,
        } satisfies FollowUpTask;
      })
      .filter((task): task is FollowUpTask => task !== null);

    const validTaskIds = new Set(tasks.map((task) => getFollowUpTaskId(task)));

    const completed = rawCompleted
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const taskId = (entry as { taskId?: unknown }).taskId;
        const completedAt = (entry as { completedAt?: unknown }).completedAt;
        const completedByRaw = (entry as { completedBy?: unknown }).completedBy;

        if (typeof taskId !== 'string' || typeof completedAt !== 'string') {
          return null;
        }

        let completedBy: FollowUpCompletionEntry['completedBy'];
        if (completedByRaw && typeof completedByRaw === 'object') {
          const idValue = (completedByRaw as { id?: unknown }).id;
          const nameValue = (completedByRaw as { name?: unknown }).name;
          if (typeof idValue === 'string') {
            completedBy = {
              id: idValue,
              name: typeof nameValue === 'string' ? nameValue : null,
            };
          }
        }

        return {
          taskId,
          completedAt,
          completedBy,
        } satisfies FollowUpCompletionEntry;
      })
      .filter((entry): entry is FollowUpCompletionEntry => !!entry && validTaskIds.has(entry.taskId));

    const generatedAt = typeof generatedAtRaw === 'string' && generatedAtRaw ? generatedAtRaw : new Date().toISOString();

    const normalizedMeta = meta && meta.source ? meta : undefined;

    return {
      generatedAt,
      tasks,
      completed,
      meta: normalizedMeta,
    };
  }, []);

  const fetchTasks = useCallback(
    async (method: 'GET' | 'POST' = 'GET', options?: { signal?: AbortSignal }) => {
      setLoading(true);
      setError(null);
      setMutationError(null);
      try {
        const response = await fetch(`/api/referrals/${referralId}/followups`, {
          method,
          signal: options?.signal,
        });

        const payload = (await response.json().catch(() => undefined)) as unknown;

        if (!response.ok) {
          const message = (payload as { error?: string } | undefined)?.error || 'Unable to load follow-up tasks right now.';
          throw new Error(message);
        }

        const normalized = normalizePayload(payload);
        if (!normalized) {
          throw new Error('Follow-up plan response was malformed.');
        }

        setData(normalized);
      } catch (caughtError) {
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') {
          return;
        }
        console.error(caughtError);
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load follow-up tasks right now.');
      } finally {
        setLoading(false);
      }
    },
    [normalizePayload, referralId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchTasks('GET', { signal: controller.signal });
    return () => controller.abort();
  }, [fetchTasks]);

  const generatedLabel = useMemo(() => {
    if (!data?.generatedAt) {
      return null;
    }
    const timestamp = new Date(data.generatedAt);
    if (Number.isNaN(timestamp.getTime())) {
      return null;
    }
    return `Generated ${formatDistanceToNow(timestamp, { addSuffix: true })}`;
  }, [data?.generatedAt]);

  const tasks = data?.tasks ?? [];

  const completionMeta = useMemo(() => {
    const map = new Map<string, FollowUpCompletionEntry>();
    for (const entry of data?.completed ?? []) {
      map.set(entry.taskId, entry);
    }
    return map;
  }, [data?.completed]);

  const activeTasks = useMemo(() => {
    return tasks.filter((task) => !completionMeta.has(getFollowUpTaskId(task)));
  }, [completionMeta, tasks]);

  const completedTasks = useMemo(() => {
    return tasks.filter((task) => completionMeta.has(getFollowUpTaskId(task)));
  }, [completionMeta, tasks]);

  const updateCompletion = useCallback(
    async (task: FollowUpTask, action: 'complete' | 'undo') => {
      const taskId = getFollowUpTaskId(task);
      setMutationError(null);
      setMutatingTask(taskId);
      try {
        const response = await fetch(`/api/referrals/${referralId}/followups`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, taskId }),
        });

        const payload = (await response.json().catch(() => undefined)) as unknown;

        if (!response.ok) {
          const message = (payload as { error?: string } | undefined)?.error || 'Unable to update task status.';
          throw new Error(message);
        }

        const normalized = normalizePayload(payload);
        if (!normalized) {
          throw new Error('Follow-up plan response was malformed.');
        }

        setData(normalized);
      } catch (caughtError) {
        console.error(caughtError);
        setMutationError(caughtError instanceof Error ? caughtError.message : 'Unable to update task status.');
      } finally {
        setMutatingTask(null);
      }
    },
    [normalizePayload, referralId]
  );

  const containerClasses = clsx(
    'space-y-4',
    variant === 'card' && 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100',
    className,
  );

  return (
    <section className={containerClasses}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {showHeader ? (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Admin follow-up tasks</h2>
            <p className="text-xs text-slate-500">AI-suggested outreach for agents, MCs, and borrowers.</p>
          </div>
        ) : (
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Follow-up plan</div>
        )}
        <button
          type="button"
          onClick={() => fetchTasks('POST')}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-4 w-4" aria-hidden="true" />}
          <span>{loading ? 'Generating…' : 'Refresh tasks'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-rose-700 underline"
            onClick={() => fetchTasks('POST')}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-3">
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200" />
        </div>
      )}

      {tasks.length > 0 && !error && (
        <div className="space-y-4">
          {mutationError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{mutationError}</div>
          )}
          {activeTasks.length > 0 ? (
            <ul className="space-y-3">
              {activeTasks.map((task) => {
                const taskId = getFollowUpTaskId(task);
                return (
                  <li key={taskId} className="space-y-3 rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${audienceStyles[task.audience]}`}>
                        <span>{task.audience}</span>
                        <span className="text-slate-400">• {task.suggestedChannel}</span>
                      </span>
                      <span className={`text-xs font-semibold uppercase tracking-wide ${urgencyStyles[task.urgency]}`}>
                        {task.urgency} urgency
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">{task.title}</h3>
                      <p className="mt-2 text-sm text-slate-600">{task.summary}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateCompletion(task, 'complete')}
                      disabled={mutatingTask === taskId}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 transition hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Mark complete
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              All tasks are completed. Refresh to generate new outreach suggestions as needed.
            </div>
          )}
          {completedTasks.length > 0 && (
            <details className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-600">
                <span>Completed tasks ({completedTasks.length})</span>
                <span className="text-xs font-medium text-slate-400">Click to toggle</span>
              </summary>
              <ul className="space-y-3 border-t border-slate-200 px-4 py-3">
                {completedTasks.map((task) => {
                  const taskId = getFollowUpTaskId(task);
                  const completion = completionMeta.get(taskId);
                  const completedLabel = completion?.completedAt
                    ? `Completed ${formatDistanceToNow(new Date(completion.completedAt), { addSuffix: true })}`
                    : undefined;
                  const completedBy = completion?.completedBy?.name ? `by ${completion.completedBy.name}` : undefined;
                  const metaLabel = [completedLabel, completedBy].filter(Boolean).join(' ');
                  return (
                    <li key={`${taskId}-completed`} className="space-y-2 rounded-md border border-slate-200 bg-slate-100 p-3 text-slate-500">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide">{task.audience}</span>
                        {metaLabel && <span className="text-xs">{metaLabel}</span>}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{task.title}</p>
                        <p className="text-sm">{task.summary}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCompletion(task, 'undo')}
                        disabled={mutatingTask === taskId}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <Undo2 className="h-4 w-4" aria-hidden="true" />
                        Move back to active
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          {data?.meta?.source === 'fallback' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {data.meta.reason ?? 'Showing baseline suggestions while the AI plan is unavailable.'}
            </div>
          )}
          {generatedLabel && <p className="text-xs text-slate-400">{generatedLabel}</p>}
        </div>
      )}
    </section>
  );
}
