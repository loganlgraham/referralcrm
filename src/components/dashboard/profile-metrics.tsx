'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';

import {
  TimeframeDropdown,
  TIMEFRAME_PRESETS,
  formatDateInput,
  formatDisplayRange,
  getPresetRange,
  isDateRangeValid,
  type DateRange,
  type TimeframeKey,
  type TimeframePreset
} from '@/components/dashboard/timeframe-controls';
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
    avgResponseHours: number | null;
    npsScore: number | null;
  } | null;
  timeframeLabel: string;
}

export function ProfileMetrics() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? null;
  const shouldFetch = role === 'mc' || role === 'agent';

  const [timeframe, setTimeframe] = useState<TimeframeKey>('month');
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('month'));
  const maxSelectableDate = formatDateInput(new Date());

  const requestKey = useMemo(() => {
    if (!shouldFetch) {
      return null;
    }
    const params = new URLSearchParams({ timeframe });
    if (timeframe === 'custom') {
      params.set('start', customRange.start);
      params.set('end', customRange.end);
    }
    return `/api/profile/metrics?${params.toString()}`;
  }, [shouldFetch, timeframe, customRange.start, customRange.end]);

  const { data, error, isLoading } = useSWR<ProfileMetricsResponse>(requestKey, fetcher, {
    refreshInterval: 120_000
  });

  const handlePresetSelect = (preset: TimeframePreset) => {
    setTimeframe(preset);
    setCustomRange(getPresetRange(preset));
  };

  const handleCustomRangeSelect = (range: DateRange) => {
    if (!isDateRangeValid(range)) {
      return;
    }
    setCustomRange(range);
    setTimeframe('custom');
  };

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
    const placeholderCount = role === 'agent' ? 9 : 6;
    return (
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: placeholderCount }).map((_, index) => (
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
  const fallbackLabel =
    timeframe === 'custom'
      ? formatDisplayRange(customRange)
      : TIMEFRAME_PRESETS.find((option) => option.value === timeframe)?.label ?? 'Select timeframe';
  const rangeLabel = data.timeframeLabel || fallbackLabel;

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
    cards.push({
      label: 'Avg. response time',
      value:
        typeof metrics.avgResponseHours === 'number'
          ? `${metrics.avgResponseHours.toFixed(1)} hrs`
          : 'Not set'
    });
    cards.push({
      label: 'NPS score',
      value: typeof metrics.npsScore === 'number' ? metrics.npsScore.toString() : 'Not set'
    });
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">Your performance snapshot</h2>
        <TimeframeDropdown
          timeframe={timeframe}
          rangeLabel={rangeLabel}
          customRange={customRange}
          onPresetSelect={handlePresetSelect}
          onCustomRangeSelect={handleCustomRangeSelect}
          maxDate={maxSelectableDate}
        />
      </div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{rangeLabel}</p>
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
