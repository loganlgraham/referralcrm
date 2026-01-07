'use client';

import { useEffect, useState } from 'react';
import { AlertCircleIcon, LineChartIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';

type MortgageMarketBrief = {
  headline: string;
  summary: string;
  headlineStories?: { headline: string; takeaway: string; source?: string }[];
  rateSignals: string[];
  coachingAngles: string[];
  borrowerAdvice: string[];
  caution: string[];
  averageRates: { loanType: string; averageRate: string; change: string }[];
  dataDate: string;
  lastUpdated: string;
};

const defaultDateLabel = new Date().toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const defaultBrief: MortgageMarketBrief = {
  headline: 'Mortgage market snapshot',
  summary: 'Use the live widget for today’s quotes, speak in payments, and set expectations around lender-specific pricing.',
  headlineStories: [
    {
      headline: 'Waiting for live headlines…',
      takeaway: 'Tap refresh for a current market recap. Share local lender color you’re hearing on pricing or overlays.',
    },
  ],
  rateSignals: [
    'Use the live widget as your rate anchor—quotes vary by lender and change quickly.',
    'Government-backed options (FHA/VA) often price below conventional 30-year rates—good for payment-sensitive buyers.',
  ],
  coachingAngles: [
    'Align on a comfortable payment today, then suggest locking if quotes land near that target.',
    'Invite active buyers to a 10-minute check-in about timing, payments, and what locking with their lender would look like.',
  ],
  borrowerAdvice: [
    'Bring a fresh pay stub and asset snapshot to the lender partner—faster docs can mean better pricing and quicker locks.',
    'Expect lender-to-lender differences. Have a second quote ready if payment is tight.',
  ],
  caution: ['Use these talking points for education only. Always defer exact quotes to the lender you’re working with.'],
  averageRates: [],
  dataDate: defaultDateLabel,
  lastUpdated: defaultDateLabel,
};

export function MortgageMarketInsights() {
  const [brief, setBrief] = useState<MortgageMarketBrief>(defaultBrief);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayLabel = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

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

      const payload = (await response.json()) as Partial<MortgageMarketBrief> & { error?: string };

      if (payload.error) {
        setError(payload.error);
      }

      const fallbackString = (value: string | undefined, defaultValue: string) =>
        value && value.trim().length > 0 ? value : defaultValue;

      const fallbackList = (value: string[] | undefined, defaultValue: string[]) =>
        value && value.length > 0 ? value : defaultValue;

      setBrief({
        ...defaultBrief,
        ...payload,
        headlineStories: payload.headlineStories ?? defaultBrief.headlineStories,
        headline: fallbackString(payload.headline, defaultBrief.headline),
        summary: fallbackString(payload.summary, defaultBrief.summary),
        rateSignals: fallbackList(payload.rateSignals, defaultBrief.rateSignals),
        coachingAngles: fallbackList(payload.coachingAngles, defaultBrief.coachingAngles),
        borrowerAdvice: fallbackList(payload.borrowerAdvice, defaultBrief.borrowerAdvice),
        caution: fallbackList(payload.caution, defaultBrief.caution),
        averageRates:
          payload.averageRates && payload.averageRates.length > 0
            ? payload.averageRates
            : defaultBrief.averageRates,
        dataDate: fallbackString(payload.dataDate, defaultBrief.dataDate),
        lastUpdated: fallbackString(payload.lastUpdated, defaultBrief.lastUpdated),
      });
    } catch (err) {
      setError('Unable to load mortgage market insights.');
    } finally {
      setLoading(false);
    }
  };

  const asOfLabel = brief.dataDate && brief.dataDate !== '—' ? brief.dataDate : todayLabel;
  const lastUpdatedLabel = brief.lastUpdated && brief.lastUpdated !== '—' ? brief.lastUpdated : todayLabel;
  const parsedAsOf = new Date(asOfLabel);
  const daysOld = Number.isNaN(parsedAsOf.getTime())
    ? 0
    : Math.max(0, Math.floor((Date.now() - parsedAsOf.getTime()) / (1000 * 60 * 60 * 24)));
  const isStale = daysOld > 3;

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
            <h1 className="text-lg font-semibold text-slate-900">Mortgage Market</h1>
            <p className="text-sm text-slate-600">
              Live snapshot plus agent talking points—use the widget for quotes and defer specifics to your lender partner.
            </p>
            <p className="mt-1 text-xs text-slate-500">Updated {lastUpdatedLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchInsights}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-dark hover:shadow disabled:cursor-not-allowed disabled:opacity-70"
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

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Live national rate snapshot</h2>
                <p className="text-xs text-slate-500">Widget powered by Mortgage News Daily—share with clients as a real-time reference.</p>
              </div>
              <div className="text-left text-xs text-slate-500 sm:text-right">
                <p>Rates as of {asOfLabel}</p>
                <p className="flex flex-wrap items-center gap-2">
                  <span>Local lender quotes may vary.</span>
                  {isStale ? <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-amber-700">Latest available; source may lag</span> : null}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.8fr)] lg:items-start lg:gap-6">
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                <div className="w-header" style={{ textAlign: 'center', padding: '6px 0', backgroundColor: '#0f172a', color: '#ffffff' }}>
                  <a href="https://www.mortgagenewsdaily.com/mortgage-rates" target="_blank" rel="noreferrer" style={{ color: '#ffffff', textDecoration: 'none' }}>
                    Mortgage Interest Rates
                  </a>
                </div>
                <iframe
                  src="//widgets.mortgagenewsdaily.com/widget/f/rates?t=large&sn=true&c=0f172a&u=&cbu=&w=720&h=290"
                  width="100%"
                  height="290"
                  frameBorder="0"
                  scrolling="no"
                  style={{
                    border: 'solid 1px #0f172a',
                    borderWidth: '0 1px',
                    boxSizing: 'border-box',
                    width: '100%',
                    height: '290px',
                    display: 'block',
                  }}
                />
                <div className="w-footer" style={{ textAlign: 'center', padding: '6px 0', backgroundColor: '#0f172a', color: '#ffffff' }}>
                  View More{' '}
                  <a href="https://www.mortgagenewsdaily.com/mortgage-rates" target="_blank" rel="noreferrer" style={{ color: '#ffffff', textDecoration: 'none' }}>
                    Mortgage Rates
                  </a>
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                {brief.averageRates && brief.averageRates.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pull these talking points from the widget</p>
                    <div className="space-y-2">
                      {brief.averageRates.slice(0, 6).map((rate) => (
                        <div key={rate.loanType} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2 text-sm">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900">{rate.loanType}</span>
                            <span className="text-xs text-slate-500">Widget feed • {asOfLabel}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-base font-semibold text-slate-900">{rate.averageRate}</p>
                            <p className="text-xs text-slate-500">Change: {rate.change}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Use the widget for live numbers. Quotes and payments come from the lender you’re working with.
                  </p>
                )}

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircleIcon className="h-4 w-4" />
                    Use with care
                  </div>
                  <ul className="mt-2 space-y-1">
                    {brief.caution.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span>•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-amber-700">
                    These insights are informational—quote specifics must come from the lender you’re working with.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="text-sm font-semibold text-slate-800">Headline</h2>
              <p className="mt-1 text-base font-semibold text-slate-900">{brief.headline}</p>
              <p className="mt-2 text-sm text-slate-700">{brief.summary}</p>
            </div>

            {brief.headlineStories && brief.headlineStories.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <SparklesIcon className="h-4 w-4 text-brand" />
                  Market headlines to share
                </div>
                <ul className="mt-3 space-y-3 text-sm text-slate-700">
                  {brief.headlineStories.map((item) => (
                    <li key={item.headline} className="space-y-1 rounded-md bg-slate-50 p-3">
                      <p className="font-semibold text-slate-900">{item.headline}</p>
                      <p className="text-slate-700">{item.takeaway}</p>
                      {item.source ? <p className="text-xs text-slate-500">Source: {item.source}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
          </div>
        </div>
      </div>
    </div>
  );
}
