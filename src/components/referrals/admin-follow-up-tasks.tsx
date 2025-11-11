'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RefreshCcw } from 'lucide-react';

interface FollowUpTask {
  audience: 'Agent' | 'MC' | 'Referral';
  title: string;
  summary: string;
  suggestedChannel: 'Phone' | 'Email' | 'Text' | 'Internal';
  urgency: 'Low' | 'Medium' | 'High';
}

interface FollowUpResponseMeta {
  source?: 'ai' | 'fallback';
  reason?: string;
}

interface FollowUpResponse {
  generatedAt: string;
  tasks: FollowUpTask[];
  meta?: FollowUpResponseMeta;
}

interface AdminFollowUpTasksPanelProps {
  referralId: string;
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

export function AdminFollowUpTasksPanel({ referralId }: AdminFollowUpTasksPanelProps) {
  const [data, setData] = useState<FollowUpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(
    async (options?: { signal?: AbortSignal }) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/referrals/${referralId}/followups`, {
          method: 'POST',
          signal: options?.signal,
        });

        const payload = (await response.json().catch(() => undefined)) as FollowUpResponse | { error?: string } | undefined;

        if (!response.ok || !payload || !Array.isArray((payload as FollowUpResponse).tasks)) {
          const message = (payload as { error?: string } | undefined)?.error || 'Unable to generate follow-up tasks right now.';
          throw new Error(message);
        }

        const tasks = (payload as FollowUpResponse).tasks.filter((task): task is FollowUpTask => {
          return (
            !!task &&
            typeof task === 'object' &&
            (task.audience === 'Agent' || task.audience === 'MC' || task.audience === 'Referral') &&
            typeof task.title === 'string' &&
            typeof task.summary === 'string' &&
            (task.suggestedChannel === 'Phone' ||
              task.suggestedChannel === 'Email' ||
              task.suggestedChannel === 'Text' ||
              task.suggestedChannel === 'Internal') &&
            (task.urgency === 'Low' || task.urgency === 'Medium' || task.urgency === 'High')
          );
        });

        setData({
          generatedAt: (payload as FollowUpResponse).generatedAt,
          tasks,
          meta: (payload as FollowUpResponse).meta,
        });
      } catch (caughtError) {
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') {
          return;
        }
        console.error(caughtError);
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to generate follow-up tasks right now.');
      } finally {
        setLoading(false);
      }
    },
    [referralId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchTasks({ signal: controller.signal });
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

  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Admin follow-up tasks</h2>
          <p className="text-xs text-slate-500">AI-suggested outreach for agents, MCs, and borrowers.</p>
        </div>
        <button
          type="button"
          onClick={() => fetchTasks()}
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
            onClick={() => fetchTasks()}
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

      {data && data.tasks.length > 0 && !error && (
        <div className="space-y-4">
          <ul className="space-y-3">
            {data.tasks.map((task, index) => (
              <li key={`${task.audience}-${task.title}-${index}`} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${audienceStyles[task.audience]}`}>
                    <span>{task.audience}</span>
                    <span className="text-slate-400">• {task.suggestedChannel}</span>
                  </span>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${urgencyStyles[task.urgency]}`}>
                    {task.urgency} urgency
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-800">{task.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{task.summary}</p>
              </li>
            ))}
          </ul>
          {data.meta?.source === 'fallback' && (
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
