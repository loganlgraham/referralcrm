'use client';

import {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';
import { Trash2 } from 'lucide-react';
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

type NetworkFilter = 'ALL' | 'AHA' | 'AHA_OOS';

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

const LIST_PREVIEW_LIMIT = 5;

interface DashboardSummary {
  totalReferrals: number;
  dealsClosed: number;
  dealsUnderContract: number;
  pendingClosings: number;
  pendingClosingsThisMonth: number;
  pendingClosingsNextMonth: number;
  closeRate: number;
  afcDealsLost: number;
  afcAttachRate: number;
  ahaAttachRate: number;
  ahaOosAttachRate: number;
  activePipeline: number;
  expectedRevenueCents: number;
  realizedRevenueCents: number;
  closedNotPaidCents: number;
  averageDaysNewLeadToContract: number;
  averageDaysClosedToPaid: number;
  averageClosedDealAmountCents: number;
  averageRevenuePerDealCents: number;
  totalVolumeClosedCents: number;
  averagePaAmountCents: number;
  averageReferralFeePaidCents: number;
  pipelineValueCents: number;
  lostReferrals: number;
}

interface DashboardResponse {
  timeframe: {
    key: TimeframeKey;
    label: string;
    start: string | null;
    end: string | null;
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
      referrals: TrendPoint[];
    };
    revenueBySource: { label: string; value: number }[];
    revenueByEndorser: { label: string; value: number }[];
    revenueByState: { label: string; value: number }[];
    referralRequestsBySource: { label: string; value: number }[];
    referralRequestsByEndorser: { label: string; value: number }[];
    referralRequestsByState: { label: string; value: number }[];
    monthlyReferrals: {
      monthKey: string;
      label: string;
      totalReferrals: number;
      ahaReferrals: number;
      ahaOosReferrals: number;
      preApprovals: number;
      ahaPreApprovals: number;
      ahaOosPreApprovals: number;
      conversionRate: number;
      conversionRateAha: number;
      conversionRateAhaOos: number;
      updatedAt?: string;
    }[];
    preApprovalConversion: {
      trend: { all: TrendPoint[]; aha: TrendPoint[]; ahaOos: TrendPoint[] };
      entries: {
        monthKey: string;
        label: string;
        totalReferrals: number;
        ahaReferrals: number;
        ahaOosReferrals: number;
        preApprovals: number;
        ahaPreApprovals: number;
        ahaOosPreApprovals: number;
        conversionRate: number;
        conversionRateAha: number;
        conversionRateAhaOos: number;
        updatedAt?: string;
      }[];
    };
    terminatedDeals: {
      breakdown: { label: string; value: number; percentage: number }[];
      totalLostReferralFeeCents: number;
      totalDeals: number;
      deals: {
        id: string;
        reasonKey: string;
        reasonLabel: string;
        lostReferralFeeCents: number;
        mcName: string;
        agentName: string;
      }[];
    };
  };
  mc: {
    requestTrend: {
      all: TrendPoint[];
      aha: TrendPoint[];
      ahaOos: TrendPoint[];
    };
    revenueLeaderboard: LeaderboardEntry[];
    closeRateLeaderboard: LeaderboardEntry[];
    requestLeaderboard: {
      all: LeaderboardEntry[];
      aha: LeaderboardEntry[];
      ahaOos: LeaderboardEntry[];
    };
  };
  agent: {
    averageCommissionCents: number;
    averageCommissionPercent: number;
    averageReferralFeePercent: number;
    referralFeeSampleSize: number;
    commissionSampleSize: number;
    referralLeaderboard: LeaderboardEntry[];
    closeRateLeaderboard: LeaderboardEntry[];
    averageClosedDealAmount: LeaderboardEntry[];
    revenuePaid: LeaderboardEntry[];
    revenueExpected: LeaderboardEntry[];
    netRevenue: LeaderboardEntry[];
    lostDeals: LeaderboardEntry[];
    agentCreatedMcAssignments: LeaderboardEntry[];
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
    totalReferrals: number;
    assignedReferrals: number;
    unassignedReferrals: number;
    firstContactWithin24HoursRate: number;
    firstContactWithin24HoursCount: number;
    firstContactSampleSize: number;
  };
  agit: {
    totalReferrals: number;
    glennBeckReferrals: number;
    usedAfcCount: number;
    usedAfcRate: number;
    lostReferrals: number;
    closeRate: number;
    dealsClosed: number;
  };
}

const TAB_OPTIONS = [
  { label: 'Main', value: 'main' },
  { label: 'MC', value: 'mc' },
  { label: 'Agent', value: 'agent' },
  { label: 'Admin', value: 'admin' },
  { label: 'AGIT', value: 'agit' }
] as const;

type TabValue = (typeof TAB_OPTIONS)[number]['value'];

const NETWORK_FILTER_OPTIONS: { label: string; value: NetworkFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'AHA', value: 'AHA' },
  { label: 'AHA OOS', value: 'AHA_OOS' }
];

const DEFAULT_NETWORK_FILTER: Record<TabValue, NetworkFilter> = {
  main: 'ALL',
  mc: 'ALL',
  agent: 'ALL',
  admin: 'AHA_OOS',
  agit: 'ALL'
};

function NetworkFilterButtons({
  value,
  onChange
}: {
  value: NetworkFilter;
  onChange: (value: NetworkFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {NETWORK_FILTER_OPTIONS.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
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
  );
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 180;
const CHART_PADDING_X = 36;
const CHART_PADDING_Y = 28;

function SummaryCard({
  title,
  value,
  helper,
  extraStats
}: {
  title: string;
  value: string;
  helper?: string;
  extraStats?: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
      {extraStats?.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {extraStats.map((stat) => (
            <div key={`${title}-${stat.label}`} className="rounded bg-slate-50 px-2 py-1">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{stat.label}</dt>
              <dd className="text-sm font-semibold text-slate-900">{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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
  helper,
  actions
}: {
  title: string;
  data: TrendPoint[];
  formatValue: (value: number) => string;
  helper?: string;
  actions?: ReactNode;
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
  const tooltipPoint = activeIndex != null ? points[activeIndex] : null;

  let tooltipMetrics: {
    width: number;
    height: number;
    x: number;
    y: number;
    valueLabel: string;
    labelText: string;
  } | null = null;

  if (tooltipPoint && activePoint) {
    const valueLabel = formatValue(activePoint.value);
    const labelText = activePoint.label;
    const textLength = Math.max(valueLabel.length, labelText.length);
    const width = Math.min(Math.max(textLength * 7 + 24, 96), CHART_WIDTH - CHART_PADDING_X);
    const height = 38;
    const x = Math.min(
      Math.max(tooltipPoint.x - width / 2, CHART_PADDING_X),
      CHART_WIDTH - CHART_PADDING_X - width
    );
    const y = Math.max(tooltipPoint.y - height - 8, 8);
    tooltipMetrics = { width, height, x, y, valueLabel, labelText };
  }

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!hasData) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    let closestIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = Math.abs(point.x - relativeX);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });
    setHoverIndex(closestIndex);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          {activePoint ? (
            <div className="text-right text-sm text-slate-700">
              <p className="font-semibold">{formatValue(activePoint.value)}</p>
              <p className="text-xs text-slate-500">{activePoint.label}</p>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        {hasData ? (
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-48 w-full"
            role="img"
            aria-label={`${title} trend chart`}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIndex(null)}
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
                />
              </g>
            ))}
            {tooltipPoint && tooltipMetrics ? (
              <g pointerEvents="none">
                <line
                  x1={tooltipPoint.x}
                  x2={tooltipPoint.x}
                  y1={CHART_PADDING_Y}
                  y2={CHART_HEIGHT - CHART_PADDING_Y}
                  stroke="#cbd5f5"
                  strokeDasharray="4 4"
                />
                <rect
                  x={tooltipMetrics.x}
                  y={tooltipMetrics.y}
                  width={tooltipMetrics.width}
                  height={tooltipMetrics.height}
                  rx={6}
                  fill="#ffffff"
                  stroke="#cbd5f5"
                />
                <text
                  x={tooltipMetrics.x + 8}
                  y={tooltipMetrics.y + 18}
                  className="text-[11px] font-semibold fill-slate-900"
                >
                  {tooltipMetrics.valueLabel}
                </text>
                <text
                  x={tooltipMetrics.x + 8}
                  y={tooltipMetrics.y + tooltipMetrics.height - 10}
                  className="text-[10px] fill-slate-500"
                >
                  {tooltipMetrics.labelText}
                </text>
              </g>
            ) : null}
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

function MultiLineChartCard({
  title,
  series,
  formatValue,
  helper,
  actions
}: {
  title: string;
  series: { label: string; color: string; data: TrendPoint[] }[];
  formatValue: (value: number) => string;
  helper?: string;
  actions?: ReactNode;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const safeSeries = series.map((entry) => ({ ...entry, data: entry.data ?? [] }));
  const referenceSeries =
    safeSeries.find((entry) => entry.data.length === Math.max(...safeSeries.map((s) => s.data.length)))?.data ?? [];
  const hasData = referenceSeries.length > 0;
  const allValues = safeSeries.flatMap((entry) => entry.data.map((point) => point.value));
  const maxValue = hasData ? Math.max(...allValues, 0) : 0;
  const minValue = hasData ? Math.min(...allValues, 0) : 0;
  const normalizedMax = maxValue === minValue ? maxValue || 1 : maxValue;
  const normalizedMin = maxValue === minValue ? 0 : minValue;

  const stepX = referenceSeries.length > 1 ? (CHART_WIDTH - CHART_PADDING_X * 2) / (referenceSeries.length - 1) : 0;
  const rangeY = normalizedMax - normalizedMin || 1;

  const seriesPoints = safeSeries.map((entry) => ({
    ...entry,
    points: referenceSeries.map((refPoint, index) => {
      const value = entry.data[index]?.value ?? 0;
      const label = entry.data[index]?.label ?? refPoint.label;
      const x = CHART_PADDING_X + stepX * index;
      const ratio = (value - normalizedMin) / rangeY;
      const y = CHART_PADDING_Y + (CHART_HEIGHT - CHART_PADDING_Y * 2) * (1 - ratio);
      return { x, y, label, value };
    })
  }));

  const activeIndex = hoverIndex != null ? hoverIndex : referenceSeries.length > 0 ? referenceSeries.length - 1 : null;
  const tooltipPoint =
    activeIndex != null && seriesPoints[0]?.points[activeIndex]
      ? seriesPoints[0].points[activeIndex]
      : null;
  const labelText = activeIndex != null && referenceSeries[activeIndex] ? referenceSeries[activeIndex].label : '';

  const tooltipValues =
    activeIndex != null
      ? seriesPoints.map((entry) => ({
          label: entry.label,
          color: entry.color,
          value: entry.points[activeIndex]?.value ?? 0
        }))
      : [];

  let tooltipMetrics: {
    width: number;
    height: number;
    x: number;
    y: number;
  } | null = null;

  if (tooltipPoint && labelText) {
    const longestValue = Math.max(...tooltipValues.map((item) => formatValue(item.value).length), 0);
    const textLength = Math.max(labelText.length, longestValue + 6);
    const width = Math.min(Math.max(textLength * 7 + 24, 140), CHART_WIDTH - CHART_PADDING_X);
    const height = 52 + tooltipValues.length * 16;
    const x = Math.min(
      Math.max(tooltipPoint.x - width / 2, CHART_PADDING_X),
      CHART_WIDTH - CHART_PADDING_X - width
    );
    const y = Math.max(tooltipPoint.y - height - 8, 8);
    tooltipMetrics = { width, height, x, y };
  }

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!hasData) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    let closestIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    seriesPoints[0]?.points.forEach((point, index) => {
      const distance = Math.abs(point.x - relativeX);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });
    setHoverIndex(closestIndex);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
        </div>
        {actions}
      </div>
      {hasData ? (
        <div className="mt-4">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-48 w-full"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="gridGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <rect
              x={CHART_PADDING_X}
              y={CHART_PADDING_Y}
              width={CHART_WIDTH - CHART_PADDING_X * 2}
              height={CHART_HEIGHT - CHART_PADDING_Y * 2}
              fill="url(#gridGradient)"
              className="stroke-0"
            />
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = CHART_PADDING_Y + (CHART_HEIGHT - CHART_PADDING_Y * 2) * ratio;
              const value = normalizedMax - (normalizedMax - normalizedMin) * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1={CHART_PADDING_X}
                    y1={y}
                    x2={CHART_WIDTH - CHART_PADDING_X}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={CHART_WIDTH - CHART_PADDING_X + 6}
                    y={y + 4}
                    className="fill-slate-400 text-[10px]"
                  >
                    {formatValue(value)}
                  </text>
                </g>
              );
            })}
            {seriesPoints.map((entry) => {
              const path = entry.points
                .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
                .join(' ');
              return (
                <g key={entry.label}>
                  <path d={path} fill="none" stroke={entry.color} strokeWidth={2.5} />
                  {entry.points.map((point, index) => (
                    <circle
                      key={`${entry.label}-${point.x}-${point.y}`}
                      cx={point.x}
                      cy={point.y}
                      r={activeIndex === index ? 4 : 3}
                      fill={entry.color}
                      opacity={activeIndex == null || activeIndex === index ? 1 : 0.25}
                    />
                  ))}
                </g>
              );
            })}
            {tooltipPoint && tooltipMetrics ? (
              <g>
                <line
                  x1={tooltipPoint.x}
                  y1={CHART_PADDING_Y}
                  x2={tooltipPoint.x}
                  y2={CHART_HEIGHT - CHART_PADDING_Y}
                  stroke="#cbd5e1"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <rect
                  x={tooltipMetrics.x}
                  y={tooltipMetrics.y}
                  width={tooltipMetrics.width}
                  height={tooltipMetrics.height}
                  rx={6}
                  className="fill-white"
                  stroke="#cbd5e1"
                />
                <text x={tooltipMetrics.x + 10} y={tooltipMetrics.y + 18} className="text-[11px] font-semibold fill-slate-900">
                  {labelText}
                </text>
                {tooltipValues.map((item, index) => (
                  <text
                    key={item.label}
                    x={tooltipMetrics.x + 10}
                    y={tooltipMetrics.y + 34 + index * 14}
                    className="text-[11px] fill-slate-600"
                  >
                    <tspan fill={item.color}>● </tspan>
                    {item.label}: {formatValue(item.value)}
                  </text>
                ))}
              </g>
            ) : null}
          </svg>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {seriesPoints.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.label}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-slate-500">No data available.</div>
      )}
    </div>
  );
}

function PieChartCard({
  title,
  data,
  helper
}: {
  title: string;
  data: { label: string; value: number; percentage?: number }[];
  helper?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#0284c7'];

  const describeArc = (startAngle: number, endAngle: number, radius: number, cx: number, cy: number) => {
    const start = {
      x: cx + radius * Math.cos(startAngle),
      y: cy + radius * Math.sin(startAngle)
    };
    const end = {
      x: cx + radius * Math.cos(endAngle),
      y: cy + radius * Math.sin(endAngle)
    };
    const largeArcFlag = endAngle - startAngle <= Math.PI ? 0 : 1;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
  };

  let currentAngle = -Math.PI / 2;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
        </div>
        <p className="text-xs font-semibold text-slate-700">{total > 0 ? `${formatNumber(total)} deals` : '—'}</p>
      </div>
      {total > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr,1.2fr] sm:items-center">
          <div className="flex justify-center">
            <svg viewBox="0 0 160 160" className="h-48 w-48">
              {data.map((item, index) => {
                const sliceAngle = (item.value / total) * Math.PI * 2;
                const startAngle = currentAngle;
                const endAngle = currentAngle + sliceAngle;
                currentAngle = endAngle;
                const path = describeArc(startAngle, endAngle, 70, 80, 80);
                return (
                  <path
                    key={`${item.label}-${index}`}
                    d={path}
                    fill={colors[index % colors.length]}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          </div>
          <div className="space-y-2">
            {data.map((item, index) => {
              const resolvedPercentage = item.percentage ?? (total ? (item.value / total) * 100 : 0);
              return (
                <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: colors[index % colors.length] }}
                      aria-hidden
                    />
                    <span className="font-medium text-slate-900">{item.label}</span>
                  </div>
                  <span className="text-slate-600">{`${formatNumber(item.value)} (${resolvedPercentage.toFixed(1)}%)`}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-6 flex h-40 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-500">
          No terminated deals recorded this period.
        </div>
      )}
    </div>
  );
}

function TerminatedDealsList({
  deals,
  totalLostReferralFeeCents,
  totalDeals
}: {
  deals: DashboardResponse['main']['terminatedDeals']['deals'];
  totalLostReferralFeeCents: number;
  totalDeals: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayedDeals = showAll ? deals : deals.slice(0, LIST_PREVIEW_LIMIT);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Terminated deals</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(totalLostReferralFeeCents)}</p>
          <p className="text-xs text-slate-500">{formatNumber(totalDeals)} lost deals</p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-slate-100">
        {deals.length ? (
          displayedDeals.map((deal) => (
            <div key={deal.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{deal.mcName}, {deal.agentName}</p>
                <p className="text-xs text-slate-500">{deal.reasonLabel}</p>
              </div>
              <p className="whitespace-nowrap text-sm font-semibold text-rose-600">
                {formatCurrency(deal.lostReferralFeeCents)}
              </p>
            </div>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No terminated deals this period.</p>
        )}
      </div>
      {deals.length > LIST_PREVIEW_LIMIT ? (
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          onClick={() => setShowAll((prev) => !prev)}
        >
          {showAll ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function RankedList({
  title,
  items,
  formatValue = formatCurrency,
  emptyMessage = 'No data recorded.'
}: {
  title: string;
  items: { label: string; value: number }[];
  formatValue?: (value: number) => string;
  emptyMessage?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayedItems = showAll ? items : items.slice(0, LIST_PREVIEW_LIMIT);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-4 space-y-3">
        <ul className="space-y-3">
          {items.length ? (
            displayedItems.map((item) => (
              <li key={item.label} className="flex items-center justify-between text-sm text-slate-700">
                <span className="font-medium text-slate-900">{item.label}</span>
                <span>{formatValue(item.value)}</span>
              </li>
            ))
          ) : (
            <li className="text-sm text-slate-500">{emptyMessage}</li>
          )}
        </ul>
        {items.length > LIST_PREVIEW_LIMIT ? (
          <button
            type="button"
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LeaderboardTable({
  title,
  entries,
  valueLabel,
  actions
}: {
  title: string;
  entries: LeaderboardEntry[];
  valueLabel: string;
  actions?: ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayedEntries = showAll ? entries : entries.slice(0, LIST_PREVIEW_LIMIT);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
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
            displayedEntries.map((entry, index) => (
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
      {entries.length > LIST_PREVIEW_LIMIT ? (
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          onClick={() => setShowAll((prev) => !prev)}
        >
          {showAll ? 'Show less' : 'Show more'}
        </button>
      ) : null}
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
  const [inputAhaValue, setInputAhaValue] = useState<string>('');
  const [inputAhaOosValue, setInputAhaOosValue] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deletingMonth, setDeletingMonth] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const match = monthlyReferrals.find((entry) => entry.monthKey === selectedMonth);
    if (match) {
      setInputAhaValue(match.ahaPreApprovals > 0 ? String(match.ahaPreApprovals) : '');
      setInputAhaOosValue(match.ahaOosPreApprovals > 0 ? String(match.ahaOosPreApprovals) : '');
    } else {
      setInputAhaValue('');
      setInputAhaOosValue('');
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
  const ahaPreApprovals = selectedEntry?.ahaPreApprovals ?? 0;
  const ahaOosPreApprovals = selectedEntry?.ahaOosPreApprovals ?? 0;
  const ahaReferrals = selectedEntry?.ahaReferrals ?? 0;
  const ahaOosReferrals = selectedEntry?.ahaOosReferrals ?? 0;
  const currentConversion = selectedEntry && existingPreApprovals > 0
    ? (referralsForMonth / existingPreApprovals) * 100
    : 0;
  const ahaConversion = ahaPreApprovals > 0 ? (ahaReferrals / ahaPreApprovals) * 100 : 0;
  const ahaOosConversion = ahaOosPreApprovals > 0 ? (ahaOosReferrals / ahaOosPreApprovals) * 100 : 0;

  const sortedEntries = useMemo(() => {
    return conversion.entries
      .filter(
        (entry) =>
          entry.totalReferrals > 0 ||
          entry.preApprovals > 0 ||
          entry.ahaPreApprovals > 0 ||
          entry.ahaOosPreApprovals > 0
      )
      .sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
  }, [conversion.entries]);

  const conversionSeries = useMemo(
    () => [
      { label: 'All', color: '#0ea5e9', data: conversion.trend.all ?? [] },
      { label: 'AHA', color: '#0ea64a', data: conversion.trend.aha ?? [] },
      { label: 'AHA OOS', color: '#6366f1', data: conversion.trend.ahaOos ?? [] }
    ],
    [conversion.trend]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedMonth) return;

    const ahaValue = Number(inputAhaValue);
    const ahaOosValue = Number(inputAhaOosValue);
    if (Number.isNaN(ahaValue) || ahaValue < 0) {
      setErrorMessage('Enter a non-negative number for AHA pre-approvals.');
      setStatus('error');
      return;
    }

    if (Number.isNaN(ahaOosValue) || ahaOosValue < 0) {
      setErrorMessage('Enter a non-negative number for AHA OOS pre-approvals.');
      setStatus('error');
      return;
    }

    setStatus('saving');
    setErrorMessage(null);

    const response = await fetch('/api/dashboard/pre-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: selectedMonth, ahaPreApprovals: ahaValue, ahaOosPreApprovals: ahaOosValue })
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

  const handleDelete = async (monthKey: string) => {
    if (!canEdit || deletingMonth) return;

    setDeletingMonth(monthKey);
    setErrorMessage(null);

    const response = await fetch('/api/dashboard/pre-approvals', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: monthKey })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setErrorMessage(payload.error ?? 'Unable to delete pre-approvals for this month.');
      setStatus('error');
      setDeletingMonth(null);
      return;
    }

    setDeletingMonth(null);
    setStatus('saved');
    onSaved();
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pre-approval conversion</p>
          <p className="text-xs text-slate-500">
            Track how referral volume compares with AHA and AHA OOS pre-approvals issued each month.
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
              Pre-approvals (AHA)
              <input
                type="number"
                min={0}
                value={inputAhaValue}
                onChange={(event) => setInputAhaValue(event.target.value)}
                className="mt-1 w-32 rounded border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Pre-approvals (AHA OOS)
              <input
                type="number"
                min={0}
                value={inputAhaOosValue}
                onChange={(event) => setInputAhaOosValue(event.target.value)}
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
            {existingPreApprovals > 0
              ? `${formatNumber(existingPreApprovals)} total pre-approvals`
              : 'No pre-approvals recorded'}{' '}
            · {existingPreApprovals > 0 ? `${currentConversion.toFixed(1)}% overall conversion` : 'Conversion unavailable'}
          </p>
          <p className="mt-1">
            AHA: {formatNumber(ahaReferrals)} referrals · {formatNumber(ahaPreApprovals)} pre-approvals ·{' '}
            {ahaPreApprovals > 0 ? `${ahaConversion.toFixed(1)}% conversion` : 'conversion unavailable'}
          </p>
          <p className="mt-1">
            AHA OOS: {formatNumber(ahaOosReferrals)} referrals · {formatNumber(ahaOosPreApprovals)} pre-approvals ·{' '}
            {ahaOosPreApprovals > 0 ? `${ahaOosConversion.toFixed(1)}% conversion` : 'conversion unavailable'}
          </p>
        </div>
      ) : null}
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {status === 'saved' && !errorMessage ? (
        <p className="text-sm text-slate-700">Pre-approvals saved.</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <MultiLineChartCard
          title="Conversion trend"
          series={conversionSeries}
          formatValue={(value) => `${value.toFixed(1)}%`}
          helper="Referrals ÷ pre-approvals across recorded months by network"
        />
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium text-right">Referrals</th>
                <th className="px-3 py-2 font-medium text-right">Pre-approvals (AHA)</th>
                <th className="px-3 py-2 font-medium text-right">Pre-approvals (AHA OOS)</th>
                <th className="px-3 py-2 font-medium text-right">Conversion (All)</th>
                <th className="px-3 py-2 font-medium text-right">Conversion (AHA)</th>
                <th className="px-3 py-2 font-medium text-right">Conversion (AHA OOS)</th>
                {canEdit ? <th className="px-3 py-2 font-medium text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedEntries.length ? (
                sortedEntries.map((entry) => (
                  <tr key={entry.monthKey} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2 font-medium text-slate-900">{entry.label}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(entry.totalReferrals)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(entry.ahaPreApprovals)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(entry.ahaOosPreApprovals)}</td>
                    <td className="px-3 py-2 text-right">{entry.conversionRate.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">{entry.conversionRateAha.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">{entry.conversionRateAhaOos.toFixed(1)}%</td>
                    {canEdit ? (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center rounded border border-transparent px-2 py-1 text-sm text-slate-600 hover:text-red-600 disabled:opacity-50"
                          onClick={() => handleDelete(entry.monthKey)}
                          disabled={deletingMonth === entry.monthKey}
                          aria-label={`Delete ${entry.label} pre-approvals`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="px-3 py-6 text-center text-sm text-slate-500">
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

  const highlights: {
    title: string;
    value: string;
    helper?: string;
    extraStats: { label: string; value: string }[];
  }[] = [
    {
      title: 'Realized revenue',
      value: formatCurrency(summary.realizedRevenueCents),
      extraStats: [{ label: 'Closed, not paid', value: formatCurrency(summary.closedNotPaidCents) }]
    },
    {
      title: 'Pending closings',
      value: formatNumber(summary.pendingClosings),
      extraStats: [
        { label: 'This month', value: formatNumber(summary.pendingClosingsThisMonth) },
        { label: 'Next month', value: formatNumber(summary.pendingClosingsNextMonth) }
      ]
    },
    {
      title: 'Total referrals',
      value: formatNumber(summary.totalReferrals),
      extraStats: [{ label: 'Closed', value: formatNumber(summary.dealsClosed) }]
    },
    {
      title: 'Close rate',
      value: `${summary.closeRate.toFixed(1)}%`,
      extraStats: [
        {
          label: 'Avg. days closed → paid',
          value: `${summary.averageDaysClosedToPaid.toFixed(1)} days`
        }
      ]
    }
  ];

  const pipelineMetrics = [
    { label: 'Pipeline value', value: formatCurrency(summary.pipelineValueCents) },
    { label: 'Active pipeline', value: formatNumber(summary.activePipeline) },
    { label: 'Lost referrals', value: formatNumber(summary.lostReferrals) },
    {
      label: 'AFC attach rate',
      value: `${summary.afcAttachRate.toFixed(1)}%`,
      helper: `${formatNumber(summary.afcDealsLost)} deals lost`
    },
    { label: 'AHA attach rate', value: `${summary.ahaAttachRate.toFixed(1)}%` },
    { label: 'AHA OOS attach rate', value: `${summary.ahaOosAttachRate.toFixed(1)}%` },
    { label: 'Avg. pre-approval amount', value: formatCurrency(summary.averagePaAmountCents) }
  ];

  const revenueMetrics = [
    { label: 'Expected revenue', value: formatCurrency(summary.expectedRevenueCents) },
    { label: 'Closed, not paid', value: formatCurrency(summary.closedNotPaidCents) },
    { label: 'Total volume closed', value: formatCurrency(summary.totalVolumeClosedCents) },
    { label: 'Avg. referral fee paid', value: formatCurrency(summary.averageReferralFeePaidCents) },
    { label: 'Avg. days new lead → under contract', value: `${summary.averageDaysNewLeadToContract.toFixed(1)} days` },
    { label: 'Avg. days closed → paid', value: `${summary.averageDaysClosedToPaid.toFixed(1)} days` },
    { label: 'Avg. closed deal amount', value: formatCurrency(summary.averageClosedDealAmountCents) }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {highlights.map((card) => (
          <SummaryCard
            key={card.title}
            title={card.title}
            value={card.value}
            helper={card.helper}
            extraStats={card.extraStats}
          />
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
        <LineChartCard title="Referrals received" data={data.trends.referrals} formatValue={(value) => formatNumber(Math.round(value))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <RankedList title="Revenue by source" items={data.revenueBySource} />
        <RankedList
          title="Referral requests by source"
          items={data.referralRequestsBySource}
          formatValue={(value) => formatNumber(value)}
          emptyMessage="No referral requests recorded."
        />
        <RankedList title="Revenue by endorser" items={data.revenueByEndorser} />
        <RankedList
          title="Referral requests by endorser"
          items={data.referralRequestsByEndorser}
          formatValue={(value) => formatNumber(value)}
          emptyMessage="No referral requests recorded."
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RankedList title="Revenue by state" items={data.revenueByState} />
        <RankedList
          title="Referral requests by state"
          items={data.referralRequestsByState}
          formatValue={(value) => formatNumber(value)}
          emptyMessage="No referral requests recorded."
        />
      </div>

      <PreApprovalConversionSection
        monthlyReferrals={data.monthlyReferrals}
        conversion={data.preApprovalConversion}
        canEdit={canEditPreApprovals}
        onSaved={onPreApprovalSaved}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <PieChartCard
          title="Terminated deals by reason"
          data={data.terminatedDeals.breakdown}
          helper="Distribution of terminated deals"
        />
        <TerminatedDealsList
          deals={data.terminatedDeals.deals}
          totalLostReferralFeeCents={data.terminatedDeals.totalLostReferralFeeCents}
          totalDeals={data.terminatedDeals.totalDeals}
        />
      </div>
    </div>
  );
}

function McDashboard({ data }: { data: DashboardResponse['mc'] }) {
  return (
    <div className="space-y-6">
      <LineChartCard
        title="Requests received"
        data={data.requestTrend.all}
        formatValue={(value) => formatNumber(Math.round(value))}
        helper="Trend of referral requests routed to MCs (network filter applied above)"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable
          title="Referral requests by MC"
          entries={data.requestLeaderboard.all}
          valueLabel="Requests"
        />
        <LeaderboardTable title="Revenue by MC" entries={data.revenueLeaderboard} valueLabel="Revenue" />
        <LeaderboardTable title="Close rate by MC" entries={data.closeRateLeaderboard} valueLabel="Close rate" />
      </div>
    </div>
  );
}

function AgentDashboard({ data }: { data: DashboardResponse['agent'] }) {
  const averageCommissionDisplay =
    data.averageCommissionPercent > 0 ? `${data.averageCommissionPercent.toFixed(2)}%` : '—';
  const commissionHelper =
    data.commissionSampleSize > 0
      ? `Across ${formatNumber(data.commissionSampleSize)} closed/paid deals`
      : 'No closed or paid deals this period';

  const averageReferralFeeDisplay =
    data.averageReferralFeePercent > 0 ? `${data.averageReferralFeePercent.toFixed(2)}%` : '—';
  const referralFeeHelper =
    data.referralFeeSampleSize > 0
      ? `Across ${formatNumber(data.referralFeeSampleSize)} closed/paid deals`
      : 'No closed or paid deals this period';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard title="Average agent commission" value={averageCommissionDisplay} helper={commissionHelper} />
        <SummaryCard title="Average referral fee" value={averageReferralFeeDisplay} helper={referralFeeHelper} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Referrals by agent" entries={data.referralLeaderboard} valueLabel="Referrals" />
        <LeaderboardTable title="Close rate by agent" entries={data.closeRateLeaderboard} valueLabel="Close rate" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable
          title="Avg. closed deal amount by agent"
          entries={data.averageClosedDealAmount}
          valueLabel="Avg. closed deal"
        />
        <LeaderboardTable title="Revenue paid by agent" entries={data.revenuePaid} valueLabel="Revenue" />
        <LeaderboardTable title="Revenue expected by agent" entries={data.revenueExpected} valueLabel="Expected" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <LeaderboardTable title="Agent net earnings" entries={data.netRevenue} valueLabel="Net revenue" />
        <LeaderboardTable title="Deals lost to outside agents" entries={data.lostDeals} valueLabel="Lost deals" />
        <LeaderboardTable
          title="Agent-created referrals assigned to MCs"
          entries={data.agentCreatedMcAssignments}
          valueLabel="Referrals"
        />
      </div>
    </div>
  );
}

function AdminDashboard({ data }: { data: DashboardResponse['admin'] }) {
  const assignmentRate = data.totalReferrals
    ? (data.assignedReferrals / data.totalReferrals) * 100
    : 0;
  const assignmentHelper = data.totalReferrals
    ? `${formatNumber(data.assignedReferrals)} of ${formatNumber(data.totalReferrals)} referrals assigned`
    : 'No referrals this period';
  const firstContactHelper = data.firstContactSampleSize
    ? `${formatNumber(data.firstContactWithin24HoursCount)} of ${formatNumber(data.firstContactSampleSize)} contacts`
    : 'No contact records available';

  const cards = [
    {
      title: 'Avg. time to first agent contact',
      value: `${data.slaAverages.timeToFirstAgentContactHours.toFixed(1)} hours`,
      helper: 'Goal ≤ 24 hours'
    },
    { title: 'Avg. time to assignment', value: `${data.slaAverages.timeToAssignmentHours.toFixed(1)} hours` },
    { title: 'Avg. days to contract', value: `${data.averageDaysNewLeadToContract.toFixed(1)} days` },
    { title: 'Avg. days contract → close', value: `${data.averageDaysContractToClose.toFixed(1)} days` },
    { title: 'Assignment rate', value: `${assignmentRate.toFixed(1)}%`, helper: assignmentHelper },
    {
      title: 'First contact within 24h',
      value: `${data.firstContactWithin24HoursRate.toFixed(1)}%`,
      helper: firstContactHelper
    },
    {
      title: 'Unassigned referrals',
      value: formatNumber(data.unassignedReferrals),
      helper: data.unassignedReferrals > 0 ? 'Needs follow-up' : 'All referrals assigned'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <SummaryCard key={card.title} title={card.title} value={card.value} helper={card.helper} />
        ))}
      </div>
    </div>
  );
}

function AgitDashboard({ data }: { data: DashboardResponse['agit'] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard 
          title="Total Referrals" 
          value={formatNumber(data.totalReferrals)} 
        />
        <SummaryCard 
          title="Glenn Beck Referrals" 
          value={formatNumber(data.glennBeckReferrals)} 
        />
        <SummaryCard 
          title="Closed Deals" 
          value={formatNumber(data.dealsClosed)} 
        />
        <SummaryCard 
          title="Used AFC (Attach Rate)" 
          value={`${data.usedAfcRate.toFixed(1)}%`}
          helper={`${formatNumber(data.usedAfcCount)} went to another lender`}
        />
        <SummaryCard 
          title="Lost Referrals" 
          value={formatNumber(data.lostReferrals)} 
        />
        <SummaryCard 
          title="Close Rate" 
          value={`${data.closeRate.toFixed(1)}%`}
        />
      </div>
    </div>
  );
}

export function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<(typeof TAB_OPTIONS)[number]['value']>('main');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('month');
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('month'));
  const [networkFilters, setNetworkFilters] = useState<Record<TabValue, NetworkFilter>>(() => ({
    ...DEFAULT_NETWORK_FILTER
  }));
  const { data: session } = useSession();

  const activeNetworkFilter = networkFilters[activeTab] ?? 'ALL';
  const { start: customStart, end: customEnd } = customRange;

  const swrKey = useMemo<string | null>(() => {
    const params = new URLSearchParams({ timeframe, network: activeNetworkFilter });
    if (timeframe === 'custom') {
      if (!customStart || !customEnd || customStart > customEnd) {
        return null;
      }
      params.set('start', customStart);
      params.set('end', customEnd);
    }
    return `/api/dashboard?${params.toString()}`;
  }, [timeframe, activeNetworkFilter, customStart, customEnd]);

  const { data, error, isLoading, mutate } = useSWR<DashboardResponse>(swrKey, fetcher, {
    refreshInterval: 60_000
  });

  const handleNetworkFilterChange = (tab: TabValue, value: NetworkFilter) => {
    setNetworkFilters((prev) => {
      if (prev[tab] === value) {
        return prev;
      }
      return { ...prev, [tab]: value };
    });
  };

  useEffect(() => {
    if (timeframe === 'custom') {
      return;
    }
    setCustomRange(getPresetRange(timeframe));
  }, [timeframe]);

  const role = session?.user?.role ?? data?.permissions?.role ?? null;
  const canViewGlobal = data?.permissions?.canViewGlobal ?? role === 'admin';

  const visibleTabs = useMemo(() => {
    return TAB_OPTIONS.filter((tab) => {
      if (tab.value === 'main' || tab.value === 'admin' || tab.value === 'agit') {
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
    if (!swrKey) {
      return;
    }
    void mutate();
  };

  const maxSelectableDate = formatDateInput(new Date());
  const showSkeleton = Boolean(swrKey) && (isLoading || !data);

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

  const fallbackTimeframeLabel =
    timeframe === 'custom'
      ? formatDisplayRange(customRange)
      : TIMEFRAME_PRESETS.find((option) => option.value === timeframe)?.label ?? 'Select timeframe';
  const timeframeLabel = data?.timeframe.label ?? fallbackTimeframeLabel;

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
          <p className="text-sm text-slate-500">{timeframeLabel}</p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-6">
          <TimeframeDropdown
            timeframe={timeframe}
            rangeLabel={timeframeLabel}
            customRange={customRange}
            onPresetSelect={handlePresetSelect}
            onCustomRangeSelect={handleCustomRangeSelect}
            maxDate={maxSelectableDate}
          />
          <div className="flex flex-col items-end gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Network</span>
            <NetworkFilterButtons
              value={activeNetworkFilter}
              onChange={(value) => handleNetworkFilterChange(activeTab, value)}
            />
          </div>
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

      {showSkeleton ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
      ) : null}

      {!swrKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Select a start and end date to load dashboard metrics.
        </div>
      ) : data ? (
        <div>
          {activeTab === 'main' ? (
            <MainDashboard data={data.main} canEditPreApprovals={canViewGlobal} onPreApprovalSaved={handlePreApprovalSaved} />
          ) : null}
          {activeTab === 'mc' ? <McDashboard data={data.mc} /> : null}
          {activeTab === 'agent' ? <AgentDashboard data={data.agent} /> : null}
          {activeTab === 'admin' ? <AdminDashboard data={data.admin} /> : null}
          {activeTab === 'agit' ? <AgitDashboard data={data.agit} /> : null}
        </div>
      ) : null}
    </div>
  );
}
