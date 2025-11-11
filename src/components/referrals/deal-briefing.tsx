'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RefreshCcw } from 'lucide-react';

interface DealBriefingData {
  briefing: string;
  riskScore: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  confidence: number | null;
  nextSteps: string[];
  risks: string[];
  generatedAt: string;
}

interface DealBriefingPanelProps {
  referralId: string;
}

const riskLevelClasses: Record<DealBriefingData['riskLevel'], { text: string; bar: string; badge: string }> = {
  Low: {
    text: 'text-emerald-600',
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-100'
  },
  Medium: {
    text: 'text-amber-600',
    bar: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 ring-amber-100'
  },
  High: {
    text: 'text-rose-600',
    bar: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 ring-rose-100'
  }
};

const clampScore = (value: number) => {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
};

export function DealBriefingPanel({ referralId }: DealBriefingPanelProps) {
  const [data, setData] = useState<DealBriefingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBriefing = useCallback(
    async (options?: { signal?: AbortSignal }) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/referrals/${referralId}/briefing`, {
          method: 'POST',
          signal: options?.signal,
        });

        const payload = (await response.json().catch(() => undefined)) as DealBriefingData | { error?: string } | undefined;

        if (!response.ok || !payload || typeof (payload as DealBriefingData).briefing !== 'string') {
          const message = (payload as { error?: string } | undefined)?.error || 'Unable to generate briefing right now.';
          throw new Error(message);
        }

        const dataPayload = payload as DealBriefingData;
        setData({
          ...dataPayload,
          riskScore: clampScore(dataPayload.riskScore),
          nextSteps: Array.isArray(dataPayload.nextSteps) ? dataPayload.nextSteps : [],
          risks: Array.isArray(dataPayload.risks) ? dataPayload.risks : [],
        });
      } catch (caughtError) {
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') {
          return;
        }
        console.error(caughtError);
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to generate briefing right now.');
      } finally {
        setLoading(false);
      }
    },
    [referralId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchBriefing({ signal: controller.signal });
    return () => controller.abort();
  }, [fetchBriefing]);

  const riskClasses = useMemo(() => {
    if (!data) {
      return riskLevelClasses.Medium;
    }
    return riskLevelClasses[data.riskLevel] ?? riskLevelClasses.Medium;
  }, [data]);

  const confidenceLabel = useMemo(() => {
    if (!data || data.confidence === null || Number.isNaN(data.confidence)) {
      return null;
    }
    const percent = Math.round(data.confidence * 100);
    return `${percent}% confidence`;
  }, [data]);

  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">AI deal briefing</h2>
          <p className="text-xs text-slate-500">Condenses borrower, financials, and notes into a quick read.</p>
        </div>
        <button
          type="button"
          onClick={() => fetchBriefing()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-4 w-4" aria-hidden="true" />}
          <span>{loading ? 'Generating…' : 'Refresh briefing'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-rose-700 underline"
            onClick={() => fetchBriefing()}
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
          <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200" />
        </div>
      )}

      {data && !error && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${riskClasses.badge}`}>
                <span>Risk: {data.riskLevel}</span>
                <span className="text-slate-500">({data.riskScore}/100)</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div className={`${riskClasses.bar} h-full`} style={{ width: `${data.riskScore}%` }} />
              </div>
            </div>
            {confidenceLabel && <p className={`text-sm font-medium ${riskClasses.text}`}>{confidenceLabel}</p>}
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500">Briefing</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{data.briefing}</p>
          </div>

          {data.nextSteps.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500">Recommended next steps</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                {data.nextSteps.map((step, index) => (
                  <li key={`${step}-${index}`}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {data.risks.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500">Watchouts</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
                {data.risks.map((risk, index) => (
                  <li key={`${risk}-${index}`}>{risk}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Generated {formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}
          </p>
        </div>
      )}
    </section>
  );
}
