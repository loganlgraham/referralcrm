'use client';

import { useMemo, useState } from 'react';
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
    monthlyReferrals: { monthKey: string; label: string; totalReferrals: number }[];
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

function PreApprovalConversionTable({
  rows,
  timeframeKey
}: {
  rows: { monthKey: string; label: string; totalReferrals: number }[];
  timeframeKey: TimeframeKey;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pre-approval conversion</p>
          <p className="text-xs text-slate-500">Enter monthly pre-approvals to measure referrals to buyer conversion.</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-2 font-medium">Month</th>
              <th className="py-2 font-medium">Referrals</th>
              <th className="py-2 font-medium">Pre-approvals</th>
              <th className="py-2 font-medium">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const key = `${timeframeKey}-${row.monthKey}`;
                const value = inputs[key] ?? '';
                const parsed = Number(value);
                const preApprovals = Number.isFinite(parsed) ? parsed : 0;
                const conversion = preApprovals > 0 ? (row.totalReferrals / preApprovals) * 100 : 0;
                return (
                  <tr key={row.monthKey} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{row.label}</td>
                    <td className="py-2 text-slate-700">{formatNumber(row.totalReferrals)}</td>
                    <td className="py-2">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={value}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setInputs((current) => ({
                            ...current,
                            [key]: nextValue
                          }));
                        }}
                        className="w-32 rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-2 text-slate-700">{conversion > 0 ? `${conversion.toFixed(1)}%` : '—'}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-slate-500">
                  No referral history to analyze.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MainDashboard({ data, timeframeKey }: { data: DashboardResponse['main']; timeframeKey: TimeframeKey }) {
  const cards = useMemo(() => {
    const summary = data.summary;
    return [
      { title: 'Total referrals', value: formatNumber(summary.totalReferrals) },
      { title: 'Deals closed', value: formatNumber(summary.dealsClosed) },
      { title: 'Close rate', value: `${summary.closeRate.toFixed(1)}%` },
      { title: 'Deals under contract', value: formatNumber(summary.dealsUnderContract) },
      { title: 'AFC deals lost', value: formatNumber(summary.afcDealsLost) },
      { title: 'AFC attach rate', value: `${summary.afcAttachRate.toFixed(1)}%` },
      { title: 'Active pipeline', value: formatNumber(summary.activePipeline) },
      { title: 'Pipeline value', value: formatCurrency(summary.pipelineValueCents) },
      { title: 'Expected revenue', value: formatCurrency(summary.expectedRevenueCents) },
      { title: 'Realized revenue', value: formatCurrency(summary.realizedRevenueCents) },
      { title: 'Closed, not paid', value: formatCurrency(summary.closedNotPaidCents) },
      { title: 'Avg. days closed → paid', value: `${summary.averageDaysClosedToPaid.toFixed(1)} days` },
      { title: 'Avg. revenue per deal', value: formatCurrency(summary.averageRevenuePerDealCents) },
      { title: 'Total volume closed', value: formatCurrency(summary.totalVolumeClosedCents) },
      { title: 'Avg. pre-approval amount', value: formatCurrency(summary.averagePaAmountCents) },
      { title: 'Avg. referral fee paid', value: formatCurrency(summary.averageReferralFeePaidCents) }
    ];
  }, [data.summary]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <SummaryCard key={card.title} title={card.title} value={card.value} />
        ))}
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

      <PreApprovalConversionTable rows={data.monthlyReferrals} timeframeKey={timeframeKey} />
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

  const { data, error, isLoading } = useSWR<DashboardResponse>(`/api/dashboard?timeframe=${timeframe}`, fetcher, {
    refreshInterval: 60_000
  });

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
        {TAB_OPTIONS.map((tab) => {
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
          {activeTab === 'main' ? <MainDashboard data={data.main} timeframeKey={timeframe} /> : null}
          {activeTab === 'mc' ? <McDashboard data={data.mc} /> : null}
          {activeTab === 'agent' ? <AgentDashboard data={data.agent} /> : null}
          {activeTab === 'admin' ? <AdminDashboard data={data.admin} /> : null}
        </div>
      ) : null}
    </div>
  );
}
