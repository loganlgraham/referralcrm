'use client';

import useSWR from 'swr';
import { useSession } from 'next-auth/react';

import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';

interface ProfileMetricsResponse {
  role: string | null;
  metrics: {
    totalReferrals: number;
    dealsClosed: number;
    activePipeline: number;
    closeRate: number;
    revenueRealizedCents: number;
    revenueExpectedCents: number;
    averageCommissionCents?: number;
  } | null;
  timeframeLabel: string;
}

export function ProfileMetrics() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? null;
  const shouldFetch = role === 'mc' || role === 'agent';

  const { data, error, isLoading } = useSWR<ProfileMetricsResponse>(
    shouldFetch ? '/api/profile/metrics' : null,
    fetcher,
    { refreshInterval: 120_000 }
  );

  if (!shouldFetch) {
    return null;
  }

  if (error) {
    return (
      <div className="mt-8 rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        Unable to load your performance metrics right now.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white" />
        ))}
      </div>
    );
  }

  if (!data.metrics) {
    return (
      <div className="mt-8 rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
        Complete your profile to start seeing personal performance insights.
      </div>
    );
  }

  const metrics = data.metrics;
  const cards = [
    { label: 'Total referrals', value: formatNumber(metrics.totalReferrals) },
    { label: 'Deals closed', value: formatNumber(metrics.dealsClosed) },
    { label: 'Close rate', value: `${metrics.closeRate.toFixed(1)}%` },
    { label: 'Active pipeline', value: formatNumber(metrics.activePipeline) },
    { label: 'Revenue realized', value: formatCurrency(metrics.revenueRealizedCents) },
    { label: 'Revenue expected', value: formatCurrency(metrics.revenueExpectedCents) }
  ];

  if (role === 'agent') {
    cards.push({ label: 'Avg. commission', value: formatCurrency(metrics.averageCommissionCents ?? 0) });
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Your performance snapshot</h2>
        <p className="text-xs uppercase tracking-wide text-slate-500">{data.timeframeLabel}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
