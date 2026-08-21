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
    lostReferrals?: number;
    unattributableLostReferrals?: number;
    totalAgentRevenueCents?: number;
    referralFeesPaidCents?: number;
    avgResponseHours: number | null;
    npsScore: number | null;
  } | null;
  timeframeLabel: string;
}

export function ProfileMetrics() {
  const { data: session } = useSession();
  const normalizedRole = (() => {
    const role = (session?.user?.role as string | null) ?? null;
    if (role === 'mortgage-consultant') return 'mc';
    return role;
  })();

  const shouldFetch = normalizedRole === 'agent';

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
      <div className="rounded-card border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
        Unable to load your performance metrics right now.
      </div>
    );
  }

  if (isLoading || !data) {
    const placeholderCount = normalizedRole === 'agent' ? 12 : normalizedRole === 'mc' ? 9 : 6;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: placeholderCount }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-card border border-border bg-surface-raised" />
        ))}
      </div>
    );
  }

  if (!data.metrics) {
    return (
      <div className="rounded-card border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
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

  const cards: { label: string; value: string; helper?: string }[] = [
    { label: 'Total referrals', value: formatNumber(metrics.totalReferrals) },
    { label: 'Deals closed', value: formatNumber(metrics.dealsClosed) },
    { label: 'Close rate', value: `${metrics.closeRate.toFixed(1)}%` },
    { label: 'Active pipeline', value: formatNumber(metrics.activePipeline) },
    { label: 'Revenue realized', value: formatCurrency(metrics.revenueRealizedCents) },
    { label: 'Revenue expected', value: formatCurrency(metrics.revenueExpectedCents) }
  ];

  if (normalizedRole === 'agent') {
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
    const unattributableLost = metrics.unattributableLostReferrals ?? 0;
    cards.push({
      label: 'Lost referrals',
      value: formatNumber(metrics.lostReferrals ?? 0),
      helper:
        unattributableLost > 0
          ? `${formatNumber(unattributableLost)} more were lost before you could reach the borrower and are not counted here`
          : undefined
    });
    cards.push({ label: 'Total agent revenue', value: formatCurrency(metrics.totalAgentRevenueCents ?? 0) });
    cards.push({ label: 'Referral fees paid', value: formatCurrency(metrics.referralFeesPaidCents ?? 0) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
            Your performance snapshot
          </h2>
          <p className="text-eyebrow mt-1 text-foreground-subtle">{rangeLabel}</p>
        </div>
        <TimeframeDropdown
          timeframe={timeframe}
          rangeLabel={rangeLabel}
          customRange={customRange}
          onPresetSelect={handlePresetSelect}
          onCustomRangeSelect={handleCustomRangeSelect}
          maxDate={maxSelectableDate}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
            <p className="text-eyebrow text-foreground-subtle">{card.label}</p>
            <p className="text-numeric mt-2 text-xl font-semibold text-foreground">{card.value}</p>
            {card.helper ? <p className="mt-1 text-xs text-foreground-subtle">{card.helper}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
