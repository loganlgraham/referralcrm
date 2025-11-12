'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';

type TimeframeKey = 'day' | 'week' | 'month' | 'year' | 'ytd';

interface TrendPoint {
  key: string;
  label: string;
  value: number;
}

interface LeaderboardEntry {
  id: string;
  name: string;
  revenueCents?: number;
  expectedRevenueCents?: number;
  closeRate?: number;
  dealsClosed?: number;
  totalReferrals?: number;
  referrals?: number;
}

interface DashboardSummary {
  totalReferrals: number;
  dealsClosed: number;
  dealsUnderContract: number;
  closeRate: number;
  afcDealsLost: number;
  afcAttachRate: number;
  activePipeline: number;
  expectedRevenueCents: number;
  realizedRevenueCents: number;
  closedNotPaidCents: number;
  averageDaysClosedToPaid: number;
  averageRevenuePerDealCents: number;
  totalVolumeClosedCents: number;
  averagePaAmountCents: number;
  averageReferralFeePaidCents: number;
  pipelineValueCents: number;
}

interface DashboardResponse {
  timeframe: {
    key: TimeframeKey;
    label: string;
  };
  permissions: {
    canViewGlobal: boolean;
    role: string | null;
  };
  main: {
    summary: DashboardSummary;
    trends: {
      revenue: TrendPoint[];
      deals: TrendPoint[];
      closeRate: TrendPoint[];
      mcTransfers: TrendPoint[];
    };
    revenueBySource: { label: string; value: number }[];
    revenueByEndorser: { label: string; value: number }[];
    revenueByState: { label: string; value: number }[];
    monthlyReferrals: {
      monthKey: string;
      label: string;
      totalReferrals: number;
      preApprovals: number;
      conversionRate: number;
      updatedAt?: string;
    }[];
    preApprovalConversion: {
      trend: TrendPoint[];
      entries: {
        monthKey: string;
        label: string;
        totalReferrals: number;
        preApprovals: number;
        conversionRate: number;
        updatedAt?: string;
      }[];
    };
  };
  mc: {
    requestTrend: TrendPoint[];
    revenueLeaderboard: LeaderboardEntry[];
    closeRateLeaderboard: LeaderboardEntry[];
  };
  agent: {
    averageCommissionCents: number;
    referralLeaderboard: LeaderboardEntry[];
    closeRateLeaderboard: LeaderboardEntry[];
    revenuePaid: LeaderboardEntry[];
    revenueExpected: LeaderboardEntry[];
  };
  admin: {
    slaAverages: {
      timeToFirstAgentContactHours: number;
      timeToAssignmentHours: number;
      daysToContract: number;
      daysToClose: number;
    };
    averageDaysNewLeadToContract: number;
    averageDaysContractToClose: number;
  };
}

const TIMEFRAME_OPTIONS: { label: string; value: TimeframeKey }[] = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'YTD', value: 'ytd' }
];

const TAB_OPTIONS = [
  { label: 'Main', value: 'main' },
  { label: 'MC', value: 'mc' },
  { label: 'Agent', value: 'agent' },
  { label: 'Admin', value: 'admin' }
] as const;

const CHART_WIDTH = 320;
const CHART_HEIGHT = 180;
const CHART_PADDING_X = 36;
const CHART_PADDING_Y = 28;

function SummaryCard({ title, value, helper }: { title: string; value: string; helper?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

function MetricGroupCard({
  title,
  metrics
}: {
  title: string;
  metrics: { label: string; value: string; helper?: string }[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <dl className="mt-3 space-y-3">
        {metrics.map((metric) => (
          <div key={`${title}-${metric.label}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-slate-500">{metric.label}</dt>
              <dd className="text-sm font-semibold text-slate-900">{metric.value}</dd>
            </div>
            {metric.helper ? <p className="text-xs text-slate-400">{metric.helper}</p> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

function LineChartCard({
  title,
  data,
  formatValue,
  helper
}: {
  title: string;
  data: TrendPoint[];
  formatValue: (value: number) => string;
  helper?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const safeData = data ?? [];
  const hasData = safeData.length > 0;
  const maxValue = hasData ? Math.max(...safeData.map((point) => point.value), 0) : 0;
  const minValue = hasData ? Math.min(...safeData.map((point) => point.value), 0) : 0;
  const normalizedMax = maxValue === minValue ? maxValue || 1 : maxValue;
  const normalizedMin = maxValue === minValue ? 0 : minValue;

  const stepX = safeData.length > 1 ? (CHART_WIDTH - CHART_PADDING_X * 2) / (safeData.length - 1) : 0;
  const rangeY = normalizedMax - normalizedMin || 1;

  const points = safeData.map((point, index) => {
    const x = CHART_PADDING_X + stepX * index;
    const ratio = (point.value - normalizedMin) / rangeY;
    const y = CHART_PADDING_Y + (CHART_HEIGHT - CHART_PADDING_Y * 2) * (1 - ratio);
    return { x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

  const activeIndex = hoverIndex != null ? hoverIndex : safeData.length > 0 ? safeData.length - 1 : null;
  const activePoint = activeIndex != null ? safeData[activeIndex] : null;
  const gradientId = useMemo(() => `gradient-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [title]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
        </div>
        {activePoint ? (
          <div className="text-right text-sm text-slate-700">
            <p className="font-semibold">{formatValue(activePoint.value)}</p>
            <p className="text-xs text-slate-500">{activePoint.label}</p>
          </div>
        ) : null}
      </div>
      <div className="mt-4">
        {hasData ? (
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-48 w-full"
            role="img"
            aria-label={`${title} trend chart`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={path} fill="none" stroke="#0ea5e9" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.length >= 2 ? (
              <path
                d={`${path} L${points[points.length - 1].x.toFixed(2)} ${CHART_HEIGHT - CHART_PADDING_Y} L${points[0].x.toFixed(2)} ${CHART_HEIGHT - CHART_PADDING_Y} Z`}
                fill={`url(#${gradientId})`}
                opacity={0.2}
              />
            ) : null}
            {points.map((point, index) => (
              <g key={safeData[index].key}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={activeIndex === index ? 5 : 3}
                  fill={activeIndex === index ? '#0ea5e9' : '#bae6fd'}
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              </g>
            ))}
            <line
              x1={CHART_PADDING_X}
              x2={CHART_WIDTH - CHART_PADDING_X}
              y1={CHART_HEIGHT - CHART_PADDING_Y}
              y2={CHART_HEIGHT - CHART_PADDING_Y}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={CHART_PADDING_X} y={CHART_HEIGHT - CHART_PADDING_Y / 2} className="text-[10px] fill-slate-400">
              {formatValue(normalizedMin)}
            </text>
            <text
              x={CHART_PADDING_X}
              y={CHART_PADDING_Y - 6}
              className="text-[10px] fill-slate-400"
            >
              {formatValue(normalizedMax)}
            </text>
          </svg>
        ) : (
          <div className="flex h-48 w-full items-center justify-center rounded-md bg-slate-50 text-sm text-slate-500">
            No data for this period.
          </div>
        )}
      </div>
    </div>
  );
}

function RevenueList({ title, items }: { title: string; items: { label: string; value: number }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-4 space-y-3">
        {items.length ? (
          items.slice(0, 8).map((item) => (
            <li key={item.label} className="flex items-center justify-between text-sm text-slate-700">
              <span className="font-medium text-slate-900">{item.label}</span>
              <span>{formatCurrency(item.value)}</span>
            </li>
          ))
        ) : (
          <li className="text-sm text-slate-500">No revenue recorded.</li>
        )}
      </ul>
    </div>
  );
}

function LeaderboardTable({ title, entries, valueLabel }: { title: string; entries: LeaderboardEntry[]; valueLabel: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">Rank</th>
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium text-right">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {entries.length ? (
            entries.map((entry, index) => (
              <tr key={`${entry.id}-${index}`} className="border-t border-slate-100 text-slate-700">
                <td className="py-2">#{index + 1}</td>
                <td className="py-2 font-medium text-slate-900">{entry.name}</td>
                <td className="py-2 text-right">
                  {entry.revenueCents != null
                    ? formatCurrency(entry.revenueCents)
                    : entry.expectedRevenueCents != null
                      ? formatCurrency(entry.expectedRevenueCents)
                      : entry.closeRate != null
                        ? `${entry.closeRate.toFixed(1)}%`
                        : entry.referrals != null
                          ? formatNumber(entry.referrals)
                          : entry.dealsClosed != null
                            ? `${formatNumber(entry.dealsClosed)} / ${formatNumber(entry.totalReferrals ?? 0)}`
                            : '—'}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="py-6 text-center text-sm text-slate-500">
                Nothing to display for this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PreApprovalConversionSection({
  monthlyReferrals,
  conversion,
  canEdit,
  onSaved
}: {
  monthlyReferrals: DashboardResponse['main']['monthlyReferrals'];
  conversion: DashboardResponse['main']['preApprovalConversion'];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const match = monthlyReferrals.find((entry) => entry.monthKey === selectedMonth);
    if (match) {
      setInputValue(match.preApprovals > 0 ? String(match.preApprovals) : '');
    } else {
      setInputValue('');
    }
  }, [monthlyReferrals, selectedMonth]);

  useEffect(() => {
    if (!selectedMonth && monthlyReferrals.length) {
      const lastEntry = monthlyReferrals[monthlyReferrals.length - 1];
      setSelectedMonth(lastEntry?.monthKey ?? '');
    }
  }, [monthlyReferrals, selectedMonth]);

  const selectedEntry = monthlyReferrals.find((entry) => entry.monthKey === selectedMonth);
  const referralsForMonth = selectedEntry?.totalReferrals ?? 0;
  const existingPreApprovals = selectedEntry?.preApprovals ?? 0;
  const currentConversion = selectedEntry && existingPreApprovals > 0
    ? (referralsForMonth / existingPreApprovals) * 100
    : 0;

  const sortedEntries = useMemo(() => {
    return [...conversion.entries].sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
  }, [conversion.entries]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedMonth) return;

    const numericValue = Number(inputValue);
    if (Number.isNaN(numericValue) || numericValue < 0) {
      setErrorMessage('Enter a non-negative number.');
      setStatus('error');
      return;
    }

    setStatus('saving');
    setErrorMessage(null);

    const response = await fetch('/api/dashboard/pre-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: selectedMonth, preApprovals: numericValue })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setErrorMessage(payload.error ?? 'Unable to save pre-approvals.');
      setStatus('error');
      return;
    }

    setStatus('saved');
    onSaved();
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pre-approval conversion</p>
          <p className="text-xs text-slate-500">
            Track how referral volume compares with the number of pre-approvals you issue each month.
          </p>
        </div>
        {canEdit ? (
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Month
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="mt-1 w-40 rounded border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Pre-approvals
              <input
                type="number"
                min={0}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                className="mt-1 w-32 rounded border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === 'saving'}
            >
              {status === 'saving' ? 'Saving…' : 'Save entry'}
            </button>
          </form>
        ) : null}
      </div>
      {selectedEntry ? (
        <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          <p>
            {selectedEntry.label}: {formatNumber(referralsForMonth)} referrals ·{' '}
            {existingPreApprovals > 0 ? `${formatNumber(existingPreApprovals)} pre-approvals` : 'No pre-approvals recorded'} ·{' '}
            {existingPreApprovals > 0 ? `${currentConversion.toFixed(1)}% conversion` : 'Conversion unavailable'}
          </p>
        </div>
      ) : null}
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {status === 'saved' && !errorMessage ? (
        <p className="text-sm text-emerald-600">Pre-approvals saved.</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChartCard
          title="Conversion trend"
          data={conversion.trend}
          formatValue={(value) => `${value.toFixed(1)}%`}
          helper="Referrals ÷ pre-approvals across recorded months"
        />
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium text-right">Referrals</th>
                <th className="px-3 py-2 font-medium text-right">Pre-approvals</th>
                <th className="px-3 py-2 font-medium text-right">Conversion</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.length ? (
                sortedEntries.map((entry) => (
                  <tr key={entry.monthKey} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2 font-medium text-slate-900">{entry.label}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(entry.totalReferrals)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(entry.preApprovals)}</td>
                    <td className="px-3 py-2 text-right">{entry.conversionRate.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-500">
                      {entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    No pre-approval history captured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MainDashboard({
  data,
  canEditPreApprovals,
  onPreApprovalSaved
}: {
  data: DashboardResponse['main'];
  canEditPreApprovals: boolean;
  onPreApprovalSaved: () => void;
}) {
  const summary = data.summary;

  const highlights = [
    {
      title: 'Realized revenue',
      value: formatCurrency(summary.realizedRevenueCents),
      helper: `Closed, not paid ${formatCurrency(summary.closedNotPaidCents)}`
    },
    {
      title: 'Pipeline value',
      value: formatCurrency(summary.pipelineValueCents),
      helper: `${formatNumber(summary.activePipeline)} active referrals`
    },
    {
      title: 'Total referrals',
      value: formatNumber(summary.totalReferrals),
      helper: `${formatNumber(summary.dealsClosed)} closed`
    },
    {
      title: 'Close rate',
      value: `${summary.closeRate.toFixed(1)}%`,
      helper: `Avg. days closed → paid ${summary.averageDaysClosedToPaid.toFixed(1)} days`
    }
  ];

  const pipelineMetrics = [
    { label: 'Deals under contract', value: formatNumber(summary.dealsUnderContract) },
    { label: 'Active pipeline', value: formatNumber(summary.activePipeline) },
    {
      label: 'AFC attach rate',
      value: `${summary.afcAttachRate.toFixed(1)}%`,
      helper: `${formatNumber(summary.afcDealsLost)} deals lost`
    },
    { label: 'Avg. pre-approval amount', value: formatCurrency(summary.averagePaAmountCents) }
  ];

  const revenueMetrics = [
    { label: 'Expected revenue', value: formatCurrency(summary.expectedRevenueCents) },
    { label: 'Closed, not paid', value: formatCurrency(summary.closedNotPaidCents) },
    { label: 'Total volume closed', value: formatCurrency(summary.totalVolumeClosedCents) },
    { label: 'Avg. referral fee paid', value: formatCurrency(summary.averageReferralFeePaidCents) },
    { label: 'Avg. revenue per deal', value: formatCurrency(summary.averageRevenuePerDealCents) },
    { label: 'Avg. days closed → paid', value: `${summary.averageDaysClosedToPaid.toFixed(1)} days` }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {highlights.map((card) => (
          <SummaryCard key={card.title} title={card.title} value={card.value} helper={card.helper} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricGroupCard title="Pipeline health" metrics={pipelineMetrics} />
        <MetricGroupCard title="Revenue performance" metrics={revenueMetrics} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LineChartCard title="Revenue received" data={data.trends.revenue} formatValue={formatCurrency} />
        <LineChartCard title="Deals closed" data={data.trends.deals} formatValue={(value) => formatNumber(Math.round(value))} />
        <LineChartCard title="Close rate" data={data.trends.closeRate} formatValue={(value) => `${value.toFixed(1)}%`} />
        <LineChartCard title="MC transfers" data={data.trends.mcTransfers} formatValue={(value) => formatNumber(Math.round(value))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <RevenueList title="Revenue by source" items={data.revenueBySource} />
        <RevenueList title="Revenue by endorser" items={data.revenueByEndorser} />
        <RevenueList title="Revenue by state" items={data.revenueByState} />
      </div>

      <PreApprovalConversionSection
        monthlyReferrals={data.monthlyReferrals}
        conversion={data.preApprovalConversion}
        canEdit={canEditPreApprovals}
        onSaved={onPreApprovalSaved}
      />
    </div>
  );
}

function McDashboard({ data }: { data: DashboardResponse['mc'] }) {
  return (
    <div className="space-y-6">
      <LineChartCard
        title="Requests received"
        data={data.requestTrend}
        formatValue={(value) => formatNumber(Math.round(value))}
        helper="Trend of referral requests routed to MCs"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Revenue by MC" entries={data.revenueLeaderboard} valueLabel="Revenue" />
        <LeaderboardTable title="Close rate by MC" entries={data.closeRateLeaderboard} valueLabel="Close rate" />
      </div>
    </div>
  );
}

function AgentDashboard({ data }: { data: DashboardResponse['agent'] }) {
  return (
    <div className="space-y-6">
      <SummaryCard title="Average agent commission" value={formatCurrency(data.averageCommissionCents)} helper="Paid deals this period" />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Referrals by agent" entries={data.referralLeaderboard} valueLabel="Referrals" />
        <LeaderboardTable title="Close rate by agent" entries={data.closeRateLeaderboard} valueLabel="Close rate" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Revenue paid by agent" entries={data.revenuePaid} valueLabel="Revenue" />
        <LeaderboardTable title="Revenue expected by agent" entries={data.revenueExpected} valueLabel="Expected" />
      </div>
    </div>
  );
}

function AdminDashboard({ data }: { data: DashboardResponse['admin'] }) {
  const rows = [
    { label: 'Avg. time to first agent contact', value: `${data.slaAverages.timeToFirstAgentContactHours.toFixed(1)} hours` },
    { label: 'Avg. time to assignment', value: `${data.slaAverages.timeToAssignmentHours.toFixed(1)} hours` },
    { label: 'Avg. days to contract', value: `${data.averageDaysNewLeadToContract.toFixed(1)} days` },
    { label: 'Avg. days contract → close', value: `${data.averageDaysContractToClose.toFixed(1)} days` }
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Service-level summary</p>
        <ul className="mt-4 space-y-3 text-sm text-slate-700">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{row.label}</span>
              <span>{row.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<(typeof TAB_OPTIONS)[number]['value']>('main');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('month');
  const { data: session } = useSession();

  const { data, error, isLoading, mutate } = useSWR<DashboardResponse>(`/api/dashboard?timeframe=${timeframe}`, fetcher, {
    refreshInterval: 60_000
  });

  const role = session?.user?.role ?? data?.permissions?.role ?? null;
  const canViewGlobal = data?.permissions?.canViewGlobal ?? role === 'admin';

  const visibleTabs = useMemo(() => {
    return TAB_OPTIONS.filter((tab) => {
      if (tab.value === 'main' || tab.value === 'admin') {
        return canViewGlobal;
      }
      if (tab.value === 'mc') {
        return role === 'mc' || canViewGlobal;
      }
      if (tab.value === 'agent') {
        return role === 'agent' || canViewGlobal;
      }
      return true;
    });
  }, [canViewGlobal, role]);

  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some((tab) => tab.value === activeTab)) {
      setActiveTab(visibleTabs[0].value);
    }
  }, [visibleTabs, activeTab]);

  const handlePreApprovalSaved = () => {
    void mutate();
  };

  if (error) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-red-700">
        Unable to load dashboard analytics. Please try again later.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Performance dashboards</h1>
          <p className="text-sm text-slate-500">{data?.timeframe.label ?? 'Loading timeframe...'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TIMEFRAME_OPTIONS.map((option) => {
            const isActive = timeframe === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTimeframe(option.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? 'border-transparent bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-full border px-4 py-1 text-sm font-medium transition ${
                isActive
                  ? 'border-transparent bg-brand text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
      ) : null}

      {data ? (
        <div>
          {activeTab === 'main' ? (
            <MainDashboard
              data={data.main}
              canEditPreApprovals={canViewGlobal}
              onPreApprovalSaved={handlePreApprovalSaved}
            />
          ) : null}
          {activeTab === 'mc' ? <McDashboard data={data.mc} /> : null}
          {activeTab === 'agent' ? <AgentDashboard data={data.agent} /> : null}
          {activeTab === 'admin' ? <AdminDashboard data={data.admin} /> : null}
        </div>
      ) : null}
    </div>
  );
}
