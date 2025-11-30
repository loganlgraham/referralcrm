'use client';

import { useEffect, useState } from 'react';
import { AlertCircleIcon, LineChartIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';

type MortgageMarketBrief = {
  headline: string;
  summary: string;
  rateSignals: string[];
  coachingAngles: string[];
  borrowerAdvice: string[];
  caution: string[];
  dataDate: string;
};

const defaultBrief: MortgageMarketBrief = {
  headline: 'Mortgage market check-in',
  summary: 'Tap “Refresh insights” to generate a daily coaching brief for agents.',
  rateSignals: [
    'Include today’s context on rate moves and the economic driver (jobs, inflation, bonds).',
    'Call out how lenders are responding with pricing or concessions.',
  ],
  coachingAngles: [
    'Give your referral a quick headline and confidence in the process.',
    'Offer a rate outlook, talk through lock vs. float, and align on next steps.',
  ],
  borrowerAdvice: [
    'Clarify budget, documents, and decision timeline before sending to the lender.',
    'Keep them focused on controllables: credit hygiene, cash to close, and rate-lock strategy.',
  ],
  caution: ['Set expectations that this briefing is informational only and not lender advice.'],
  dataDate: new Date().toISOString().slice(0, 10),
};

export function MortgageMarketInsights() {
  const [brief, setBrief] = useState<MortgageMarketBrief>(defaultBrief);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/mortgage-market', { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? 'Unable to load mortgage market insights.');
        return;
      }

      const payload = (await response.json()) as Partial<MortgageMarketBrief>;
      setBrief({
        ...defaultBrief,
        ...payload,
        rateSignals: payload.rateSignals ?? defaultBrief.rateSignals,
        coachingAngles: payload.coachingAngles ?? defaultBrief.coachingAngles,
        borrowerAdvice: payload.borrowerAdvice ?? defaultBrief.borrowerAdvice,
        caution: payload.caution ?? defaultBrief.caution,
        dataDate: payload.dataDate ?? defaultBrief.dataDate,
      });
    } catch (err) {
      setError('Unable to load mortgage market insights.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand/10 p-2 text-brand">
            <LineChartIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Mortgage market coaching feed</h1>
            <p className="text-sm text-slate-600">
              Daily, AI-assisted talking points that tie market conditions to borrower conversations.
            </p>
            <p className="mt-1 text-xs text-slate-500">Updated {brief.dataDate}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchInsights}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh insights'}
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircleIcon className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-800">Headline</h2>
            <p className="mt-1 text-base font-semibold text-slate-900">{brief.headline}</p>
            <p className="mt-2 text-sm text-slate-700">{brief.summary}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <LineChartIcon className="h-4 w-4 text-brand" />
              Rate and market signals
            </div>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {brief.rateSignals.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-brand">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <SparklesIcon className="h-4 w-4 text-brand" />
              Coaching angles for agents
            </div>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {brief.coachingAngles.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-brand">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-800">Borrower-ready talking points</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {brief.borrowerAdvice.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-brand">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <AlertCircleIcon className="h-4 w-4" />
              Use with care
            </div>
            <ul className="mt-3 space-y-2 text-sm text-amber-800">
              {brief.caution.map((item) => (
                <li key={item} className="flex gap-2">
                  <span>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-amber-700">
              These insights are informational only—agents should not promise rates or terms. Always defer to licensed lenders for eligibility and pricing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
