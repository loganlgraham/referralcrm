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
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatDate, formatNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { DEAL_STATUS_LABELS, type DealStatus } from '@/constants/deals';
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
  assignedAgentCloses?: number;
  assignedAgentCloseRate?: number;
  totalClosedDeals?: number;
  outsideLenderLossCount?: number;
  outsideLenderLossRate?: number;
  referrals?: number;
}

interface AhaRankedAgent {
  id: string;
  name: string;
  score: number;
  baseScore: number;
  reliabilityFactor: number;
  rank: number;
  qualified: boolean;
  referralCount: number;
  netCommissionCents: number;
  kpis: {
    label: string;
    key: string;
    rawValue: number;
    displayValue: string;
    normalizedScore: number;
    weight: 'critical' | 'high' | 'medium' | 'low';
    neutralFilled: boolean;
  }[];
}

interface McRankedEntry {
  id: string;
  name: string;
  score: number;
  baseScore: number;
  reliabilityFactor: number;
  rank: number;
  qualified: boolean;
  referralCount: number;
  kpis: {
    label: string;
    key: string;
    rawValue: number;
    displayValue: string;
    normalizedScore: number;
    weight: 'critical' | 'high' | 'medium' | 'low';
    neutralFilled: boolean;
  }[];
}

interface McAfcRiskCallListEntry {
  rowId: string;
  referralId: string;
  borrowerName: string;
  mcId: string | null;
  mcName: string | null;
  agentId: string | null;
  agentName: string | null;
  status: string;
  source: string;
  closingDate: string | null;
  daysToClose: number | null;
  daysSinceActivity: number;
  usedAfc: boolean | null;
  riskScore: number;
  riskTier: 'high' | 'medium' | 'low';
  reasons: string[];
}

interface StageOnTransferSummaryEntry {
  category: 'Pre-approved' | 'Pre-approval TBD';
  totalReferrals: number;
  closedReferrals: number;
  closeRate: number;
}

type StageOnTransferCategory = StageOnTransferSummaryEntry['category'];

interface StageOnTransferDrilldownEntry {
  referralId: string;
  borrowerName: string;
  referralStatus: string;
  mcName: string;
  agentName: string;
  stageOnTransfer: StageOnTransferCategory;
  hasClosedDeal: boolean;
}

/** Target visible rows for scrollable dashboard lists (matches former collapsed preview). */
const LIST_SCROLL_VISIBLE_ROWS = 5;
const LEADERBOARD_ROW_HEIGHT_REM = 2.5;
const LEADERBOARD_HEADER_HEIGHT_REM = 1.75;
const TERMINATED_DEAL_ROW_HEIGHT_REM = 4;
const RANKED_LIST_ROW_HEIGHT_REM = 3.25;
const RANKED_LIST_PREVIEW_ROWS = 10;

const getCompositeScoreStyle = (score: number) => {
  if (score >= 75) return 'bg-emerald-50 text-emerald-700';
  if (score >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
};

const getKpiWeightBadge = (weight: 'critical' | 'high' | 'medium' | 'low') => {
  if (weight === 'critical') return 'bg-indigo-600 text-white';
  if (weight === 'high') return 'bg-[hsl(var(--text))] text-white';
  if (weight === 'medium') return 'bg-foreground-muted text-white';
  return 'bg-surface-subtle text-foreground-muted';
};

const getKpiWeightLabel = (weight: 'critical' | 'high' | 'medium' | 'low') => {
  if (weight === 'critical') return 'KEY';
  if (weight === 'high') return 'HIGH';
  if (weight === 'medium') return 'MED';
  return 'LOW';
};

interface LostDealEntry {
  id: string;
  referralId: string;
  borrowerName: string;
  agentName: string | null;
  mcName: string | null;
  status: string;
  expectedAmountCents: number;
}

interface PendingClosingEntry {
  id: string;
  referralId: string;
  borrowerName: string;
  agentName: string | null;
  mcName: string | null;
  status: string;
  closingDate: string | null;
  expectedAmountCents: number;
}

interface ClosedDealEntry {
  id: string;
  referralId: string;
  borrowerName: string;
  agentName: string | null;
  mcName: string | null;
  status: string;
  closingDate: string | null;
  paidDate: string | null;
  expectedAmountCents: number;
  receivedAmountCents: number;
  outstandingAmountCents: number;
  daysClosedToPaid: number | null;
}

interface DashboardSummary {
  totalReferrals: number;
  dealsClosed: number;
  dealsClosedInTimeframe: number;
  dealsUnderContract: number;
  pendingClosings: number;
  pendingClosingsThisMonth: number;
  pendingClosingsNextMonth: number;
  pendingClosingsList: PendingClosingEntry[];
  pendingClosingsThisMonthList: PendingClosingEntry[];
  pendingClosingsNextMonthList: PendingClosingEntry[];
  expectedRevenueFromPendingClosingsCents: number;
  generatedRevenueList: ClosedDealEntry[];
  closedNotPaidList: ClosedDealEntry[];
  dealsClosedList: ClosedDealEntry[];
  averageDaysClosedToPaidList: ClosedDealEntry[];
  closeRate: number;
  afcDealsLost: number;
  afcDealsLostList: LostDealEntry[];
  afcAttachRate: number;
  ahaDealsLost: number;
  ahaAttachRate: number;
  ahaOosDealsLost: number;
  ahaOosDealsLostList: LostDealEntry[];
  ahaOosAttachRate: number;
  activePipeline: number;
  expectedRevenueCents: number;
  realizedRevenueCents: number;
  generatedRevenueCents: number;
  closedNotPaidCents: number;
  /** Backend-calculated: realized / (realized + outstanding expected), or null. */
  revenueRealizationRatePercent: number | null;
  /** Backend-calculated: closedNotPaid / expected outstanding, or null. */
  closedNotPaidPercentOfExpected: number | null;
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

interface FunnelStage {
  status: string;
  label: string;
  count: number;
  conversionFromPrevious: number | null;
  dropOffPercent: number | null;
  avgDaysInStage: number | null;
}

interface FunnelTerminalTotals {
  lostTotal: number;
  terminatedTotal: number;
}

interface PeriodOverPeriod {
  previous: { totalReferrals: number; dealsClosed: number; realizedRevenueCents: number; closeRate: number };
  current: { totalReferrals: number; dealsClosed: number; realizedRevenueCents: number; closeRate: number };
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
    funnel?: { stages: FunnelStage[]; terminal?: FunnelTerminalTotals };
    periodOverPeriod?: PeriodOverPeriod | null;
    summary: DashboardSummary;
    trends: {
      revenue: TrendPoint[];
      revenueGenerated: TrendPoint[];
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
    kpiLeaderboard: { rankedMcs: McRankedEntry[] };
    afcRiskCallList: McAfcRiskCallListEntry[];
    stageOnTransferSummary: StageOnTransferSummaryEntry[];
    stageOnTransferDrilldown: Array<{
      category: StageOnTransferCategory;
      rows: StageOnTransferDrilldownEntry[];
    }>;
    pushbackSummary: {
      distinctDealsPushedBack: number;
      totalPushbackEvents: number;
      averageDaysPushedBackPerEvent: number;
      pushbackRatePercent: number;
      byMc: Array<{
        id: string;
        name: string;
        dealsPushedBack: number;
        totalDeals: number;
        pushbackRatePercent: number;
      }>;
    };
    revenueLeaderboard: LeaderboardEntry[];
    closeRateLeaderboard: LeaderboardEntry[];
    outsideLenderLossLeaderboard: LeaderboardEntry[];
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
    ahaLeaderboards: { rankedAgents: AhaRankedAgent[] };
    ahaOosLeaderboards: { rankedAgents: AhaRankedAgent[] };
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
    overdueTaskCount: number;
    dueTodayTaskCount: number;
    completedInTimeframeCount: number;
    onTimeTaskCompletionCount: number;
    onTimeTaskCompletionSampleSize: number;
    totalOpenTasks: number;
    taskActivityTrend: {
      outstanding: TrendPoint[];
      completed: TrendPoint[];
      created: TrendPoint[];
    };
    stalePipelineCount: number;
    stalePipelineList: StaleReferralEntry[];
    noOpenTaskReferrals: NoOpenTaskReferralEntry[];
  };
  agit: {
    agitReferrals: number;
    agitPercentage: number;
    usedAfcCount: number;
    usedAfcRate: number;
    lostReferrals: number;
    closeRate: number;
    dealsClosed: number;
    referralRows: AgitReferralRow[];
    dealRows: AgitDealRow[];
  };
}

interface AgitReferralRow {
  id: string;
  borrowerName: string;
  loanFileNumber: string | null;
  status: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  mcId: string | null;
  mcName: string | null;
  mcEmail: string | null;
  mcPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgitDealRow {
  id: string;
  referralId: string;
  borrowerName: string;
  status: string;
  expectedAmountCents: number;
  receivedAmountCents: number;
  agentId: string | null;
  agentName: string | null;
  mcId: string | null;
  mcName: string | null;
  mcEmail: string | null;
  mcPhone: string | null;
  closingDate: string | null;
  usedAfc: boolean | null;
}

interface StaleReferralEntry {
  id: string;
  borrowerName: string;
  status: string;
  agentName: string | null;
  mcName: string | null;
  lastActivityAt: string | null;
  daysSinceActivity: number;
}

interface NoOpenTaskReferralEntry {
  id: string;
  borrowerName: string;
  status: string;
  agentName: string | null;
  mcName: string | null;
  lastActivityAt: string | null;
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
                ? 'border-transparent bg-primary-600 text-white shadow-sm'
                : 'border-border bg-surface text-foreground-muted hover:border-border-strong hover:bg-surface-muted'
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
const CHART_PADDING_X = 44;
const CHART_PADDING_Y = 32;
/** Multi-line chart uses left Y-axis so labels don't overlap tooltip on the right */
const MULTI_LINE_CHART_PLOT_LEFT = 72;
const MULTI_LINE_CHART_PLOT_RIGHT = 296;
const MULTI_LINE_CHART_Y_TICKS = [0, 0.5, 1];

function SummaryCard({
  title,
  value,
  helper,
  extraStats,
  drillDownHref,
  onClick
}: {
  title: string;
  value: string;
  helper?: string;
  extraStats?: { label: string; value: string; onClick?: () => void }[];
  drillDownHref?: string;
  onClick?: () => void;
}) {
  const isHeaderInteractive = Boolean(drillDownHref ?? onClick);
  const headerContent = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {helper ? <p className="mt-1 text-xs text-foreground-subtle">{helper}</p> : null}
    </>
  );
  const headerInteractiveClass =
    'block w-full rounded-md text-left transition hover:bg-surface-muted cursor-pointer no-underline hover:no-underline';
  let headerNode: ReactNode;
  if (drillDownHref) {
    headerNode = (
      <Link href={drillDownHref} className={headerInteractiveClass}>
        {headerContent}
      </Link>
    );
  } else if (onClick) {
    headerNode = (
      <button type="button" onClick={onClick} className={headerInteractiveClass}>
        {headerContent}
      </button>
    );
  } else {
    headerNode = <div className="block w-full text-left">{headerContent}</div>;
  }
  const extraStatsNode = extraStats?.length ? (
    <dl className="mt-3 grid grid-cols-2 gap-2">
      {extraStats.map((stat) => {
        const tileBase = 'rounded-lg bg-surface-muted px-2 py-1 text-left transition min-h-[3.6rem] flex flex-col justify-between';
        if (stat.onClick) {
          return (
            <button
              key={`${title}-${stat.label}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                stat.onClick?.();
              }}
              className={`${tileBase} cursor-pointer hover:bg-surface-subtle hover:ring-1 hover:ring-sky-300`}
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-foreground-subtle leading-tight min-h-[1.8rem]">{stat.label}</dt>
              <dd className="text-sm font-semibold text-foreground">{stat.value}</dd>
            </button>
          );
        }
        return (
          <div key={`${title}-${stat.label}`} className={tileBase}>
            <dt className="text-xs font-medium uppercase tracking-wide text-foreground-subtle leading-tight min-h-[1.8rem]">{stat.label}</dt>
            <dd className="text-sm font-semibold text-foreground">{stat.value}</dd>
          </div>
        );
      })}
    </dl>
  ) : null;
  const wrapperClass = `rounded-card border border-border bg-surface-raised p-4 shadow-card block w-full text-left transition${isHeaderInteractive ? ' hover:border-sky-300 hover:shadow-md' : ''}`;
  return (
    <div className={wrapperClass}>
      {headerNode}
      {extraStatsNode}
    </div>
  );
}

function MetricGroupCard({
  title,
  metrics
}: {
  title: string;
  metrics: { label: string; value: string; helper?: string; onHelperClick?: () => void }[];
}) {
  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
      <dl className="mt-3 divide-y divide-border">
        {metrics.map((metric, index) => (
          <div key={`${title}-${metric.label}`} className="space-y-0.5 py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <dt className={index < 2 ? 'text-sm font-medium text-foreground-muted' : 'text-sm text-foreground-subtle'}>{metric.label}</dt>
              <dd className={index < 2 ? 'text-base font-bold text-foreground' : 'text-sm font-semibold text-foreground'}>{metric.value}</dd>
            </div>
            {metric.helper ? (
              metric.onHelperClick ? (
                <button
                  type="button"
                  onClick={metric.onHelperClick}
                  className="text-xs text-sky-600 underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
                >
                  {metric.helper}
                </button>
              ) : (
                <p className="text-xs text-foreground-subtle">{metric.helper}</p>
              )
            ) : null}
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
  actions,
  color = '#0ea5e9'
}: {
  title: string;
  data: TrendPoint[];
  formatValue: (value: number) => string;
  helper?: string;
  actions?: ReactNode;
  color?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const safeData = data ?? [];
  const hasData = safeData.length > 0;
  const maxValue = hasData ? Math.max(...safeData.map((point) => point.value), 0) : 0;
  const minValue = hasData ? Math.min(...safeData.map((point) => point.value), 0) : 0;
  const range = maxValue - minValue || 1;
  const headroom = range * 0.12;
  const normalizedMax = maxValue === minValue ? (maxValue || 1) * 1.15 : maxValue + headroom;
  const normalizedMin = maxValue === minValue ? 0 : Math.max(0, minValue - headroom);

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
    const roomAbove = tooltipPoint.y - CHART_PADDING_Y;
    const y =
      roomAbove >= height + 12
        ? tooltipPoint.y - height - 10
        : Math.min(tooltipPoint.y + 12, CHART_HEIGHT - CHART_PADDING_Y - height - 4);
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
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
          {helper ? <p className="text-xs text-foreground-subtle">{helper}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          {activePoint ? (
            <div className="text-right text-sm text-foreground-muted">
              <p className="font-semibold">{formatValue(activePoint.value)}</p>
              <p className="text-xs text-foreground-subtle">{activePoint.label}</p>
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
                <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.length >= 2 ? (
              <path
                d={`${path} L${points[points.length - 1].x.toFixed(2)} ${CHART_HEIGHT - CHART_PADDING_Y} L${points[0].x.toFixed(2)} ${CHART_HEIGHT - CHART_PADDING_Y} Z`}
                fill={`url(#${gradientId})`}
                opacity={0.25}
              />
            ) : null}
            {points.map((point, index) => (
              <g key={safeData[index].key}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={activeIndex === index ? 5 : 3}
                  fill={color}
                  opacity={activeIndex === index ? 1 : 0.45}
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
            <text
              x={CHART_PADDING_X - 6}
              y={CHART_HEIGHT - CHART_PADDING_Y / 2}
              textAnchor="end"
              className="text-[10px] fill-slate-400"
            >
              {formatValue(normalizedMin)}
            </text>
            <text
              x={CHART_PADDING_X - 6}
              y={CHART_PADDING_Y - 4}
              textAnchor="end"
              className="text-[10px] fill-slate-400"
            >
              {formatValue(normalizedMax)}
            </text>
          </svg>
        ) : (
          <div className="flex h-48 w-full items-center justify-center rounded-md bg-surface-muted text-sm text-foreground-subtle">
            No data for this period.
          </div>
        )}
      </div>
    </div>
  );
}

/** Short format for Y-axis labels so they fit in the left margin (value in cents) */
function formatAxisCurrency(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 100_00) {
    const k = cents / 100 / 1000;
    return `$${k >= 0 ? '' : '-'}${Math.abs(k).toFixed(k % 1 === 0 ? 0 : 1)}k`;
  }
  return formatCurrency(cents);
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

  const plotWidth = MULTI_LINE_CHART_PLOT_RIGHT - MULTI_LINE_CHART_PLOT_LEFT;
  const stepX = referenceSeries.length > 1 ? plotWidth / (referenceSeries.length - 1) : 0;
  const rangeY = normalizedMax - normalizedMin || 1;

  const seriesPoints = safeSeries.map((entry) => ({
    ...entry,
    points: referenceSeries.map((refPoint, index) => {
      const value = entry.data[index]?.value ?? 0;
      const label = entry.data[index]?.label ?? refPoint.label;
      const x = MULTI_LINE_CHART_PLOT_LEFT + stepX * index;
      const ratio = (value - normalizedMin) / rangeY;
      const y = CHART_PADDING_Y + (CHART_HEIGHT - CHART_PADDING_Y * 2) * (1 - ratio);
      return { x, y, label, value };
    })
  }));

  const activeIndex = hoverIndex != null ? hoverIndex : referenceSeries.length > 0 ? referenceSeries.length - 1 : null;
  const activePoint = activeIndex != null ? seriesPoints[0]?.points[activeIndex] : null;
  const labelText = activeIndex != null && referenceSeries[activeIndex] ? referenceSeries[activeIndex].label : '';

  const activeValues =
    activeIndex != null
      ? seriesPoints.map((entry) => ({
          color: entry.color,
          value: entry.points[activeIndex]?.value ?? 0
        }))
      : [];

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
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
          {helper ? <p className="text-xs text-foreground-subtle">{helper}</p> : null}
        </div>
        <div className="flex items-center gap-4">
          {actions}
          {hasData && labelText ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-foreground-subtle">{labelText}</span>
              {activeValues.map((item, index) => (
                <span key={index} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  {formatValue(item.value)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
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
              x={MULTI_LINE_CHART_PLOT_LEFT}
              y={CHART_PADDING_Y}
              width={plotWidth}
              height={CHART_HEIGHT - CHART_PADDING_Y * 2}
              fill="url(#gridGradient)"
              className="stroke-0"
            />
            {MULTI_LINE_CHART_Y_TICKS.map((ratio) => {
              const y = CHART_PADDING_Y + (CHART_HEIGHT - CHART_PADDING_Y * 2) * ratio;
              const value = normalizedMax - (normalizedMax - normalizedMin) * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1={MULTI_LINE_CHART_PLOT_LEFT}
                    y1={y}
                    x2={MULTI_LINE_CHART_PLOT_RIGHT}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={MULTI_LINE_CHART_PLOT_LEFT - 6}
                    y={y + 4}
                    textAnchor="end"
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
                      r={activeIndex === index ? 5 : 3}
                      fill={entry.color}
                      opacity={activeIndex == null || activeIndex === index ? 1 : 0.4}
                    />
                  ))}
                </g>
              );
            })}
            {activePoint ? (
              <line
                x1={activePoint.x}
                y1={CHART_PADDING_Y}
                x2={activePoint.x}
                y2={CHART_HEIGHT - CHART_PADDING_Y}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="4 4"
                className="pointer-events-none"
              />
            ) : null}
          </svg>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {seriesPoints.map((entry) => (
              <div key={entry.label} className="flex items-center gap-1.5 text-xs text-foreground-muted">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.label}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-foreground-subtle">No data available.</div>
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
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
          {helper ? <p className="text-xs text-foreground-subtle">{helper}</p> : null}
        </div>
        <p className="text-xs font-semibold text-foreground-muted">{total > 0 ? `${formatNumber(total)} deals` : '—'}</p>
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
                <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 text-sm text-foreground-muted">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: colors[index % colors.length] }}
                      aria-hidden
                    />
                    <span className="font-medium text-foreground">{item.label}</span>
                  </div>
                  <span className="text-foreground-muted">{`${formatNumber(item.value)} (${resolvedPercentage.toFixed(1)}%)`}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-6 flex h-40 items-center justify-center rounded-md bg-surface-muted text-sm text-foreground-subtle">
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
  const scrollMaxHeight = `${LIST_SCROLL_VISIBLE_ROWS * TERMINATED_DEAL_ROW_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">Terminated deals</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatCurrency(totalLostReferralFeeCents)}</p>
          <p className="text-xs text-foreground-subtle">{formatNumber(totalDeals)} lost deals</p>
        </div>
      </div>

      <div className="mt-4">
        {deals.length ? (
          <div
            className="divide-y divide-border overflow-y-auto"
            style={{ maxHeight: scrollMaxHeight }}
            aria-label="Scrollable list: terminated deals"
          >
            {deals.map((deal) => (
              <div key={deal.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{deal.mcName}, {deal.agentName}</p>
                  <p className="text-xs text-foreground-subtle">{deal.reasonLabel}</p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold text-rose-600">
                  {formatCurrency(deal.lostReferralFeeCents)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-foreground-subtle">No terminated deals this period.</p>
        )}
      </div>
    </div>
  );
}

function ConversionFunnelCard({
  stages,
  terminal,
  networkFilter
}: {
  stages: FunnelStage[];
  terminal: FunnelTerminalTotals;
  networkFilter: NetworkFilter;
}) {
  const withNetworkParam = (params: URLSearchParams) => {
    if (networkFilter === 'AHA' || networkFilter === 'AHA_OOS') {
      params.set('ahaBucket', networkFilter);
    }
    return params;
  };

  const buildStageDrillDownUrl = (status: string) => {
    const params = new URLSearchParams();
    const statusFilter =
      status === 'Active Lead' ? 'Active Lead,Showing Homes' : status;
    params.set('status', statusFilter);
    return `/referrals?${withNetworkParam(params).toString()}`;
  };

  const buildTerminalDrillDownUrl = (status: 'Lost' | 'Terminated') => {
    const params = new URLSearchParams();
    params.set('status', status);
    return `/referrals?${withNetworkParam(params).toString()}`;
  };

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">Conversion funnel</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        Cohort funnel: each stage counts referrals that ever reached that stage. Click a row to open referrals
        currently in that status (row totals can differ from the list).
      </p>
      <div className="mt-4 space-y-1.5">
        {stages.length ? (
          stages.map((stage, index) => {
            const isFirst = index === 0;
            return (
              <Link
                key={stage.status}
                href={buildStageDrillDownUrl(stage.status)}
                className="group block rounded-md border border-border px-3 py-2 transition hover:border-primary-200 hover:bg-primary-50/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground group-hover:text-sky-700">{stage.label}</span>
                  <div className="flex items-center gap-3 text-sm text-foreground-muted">
                    <span className="font-semibold text-foreground">{formatNumber(stage.count)}</span>
                    {!isFirst && stage.conversionFromPrevious != null ? (
                      <span className="text-xs text-foreground-subtle">
                        {stage.conversionFromPrevious.toFixed(0)}% conv
                      </span>
                    ) : null}
                    {stage.avgDaysInStage != null ? (
                      <span className="text-xs text-foreground-subtle">avg {stage.avgDaysInStage}d → next</span>
                    ) : null}
                    {!isFirst && stage.dropOffPercent != null && stage.dropOffPercent > 0 ? (
                      <span className="text-xs font-medium text-amber-600">↓{stage.dropOffPercent.toFixed(0)}%</span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <p className="py-4 text-center text-sm text-foreground-subtle">No referral data for this period.</p>
        )}
      </div>
      {stages.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-foreground-subtle">
          <span className="uppercase tracking-wide">Terminal outcomes:</span>
          <Link
            href={buildTerminalDrillDownUrl('Lost')}
            className="font-medium text-foreground-muted hover:text-sky-700"
          >
            Lost {formatNumber(terminal.lostTotal)}
          </Link>
          <span aria-hidden="true">•</span>
          <Link
            href={buildTerminalDrillDownUrl('Terminated')}
            className="font-medium text-foreground-muted hover:text-sky-700"
          >
            Terminated {formatNumber(terminal.terminatedTotal)}
          </Link>
        </div>
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
  const maxValue = items.length > 0 ? Math.max(...items.map((i) => i.value), 1) : 1;
  const scrollMaxHeight = `${LIST_SCROLL_VISIBLE_ROWS * RANKED_LIST_ROW_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
      <div className="mt-4">
        <div
          className={items.length ? 'overflow-y-auto' : undefined}
          style={items.length ? { maxHeight: scrollMaxHeight } : undefined}
          aria-label={items.length ? `Scrollable list: ${title}` : undefined}
        >
          <ul className="space-y-2.5">
            {items.length ? (
              items.map((item) => {
                const barPct = Math.max((item.value / maxValue) * 100, item.value > 0 ? 2 : 0);
                return (
                  <li key={item.label}>
                    <div className="flex items-center justify-between text-sm text-foreground-muted">
                      <span className="font-medium text-foreground">{item.label}</span>
                      <span className="text-foreground-muted">{formatValue(item.value)}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-subtle">
                      <div
                        className="h-full rounded-full bg-sky-400"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="text-sm text-foreground-subtle">{emptyMessage}</li>
            )}
          </ul>
        </div>
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
  const scrollMaxHeight = `${LIST_SCROLL_VISIBLE_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div
        className="mt-4 overflow-y-auto"
        style={entries.length ? { maxHeight: scrollMaxHeight } : undefined}
        aria-label={entries.length ? `Scrollable list: ${title}` : undefined}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-raised shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr className="text-left text-xs text-foreground-subtle">
              <th className="py-1 font-medium">Rank</th>
              <th className="py-1 font-medium">Name</th>
              <th className="py-1 font-medium text-right">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((entry, index) => (
                <tr key={`${entry.id}-${index}`} className="border-t border-border text-foreground-muted">
                  <td className="py-2 text-foreground-subtle">#{index + 1}</td>
                  <td className="py-2 font-medium text-foreground">{entry.name}</td>
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
                <td colSpan={3} className="py-6 text-center text-sm text-foreground-subtle">
                  Nothing to display for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function McCloseEffectivenessTable({ entries }: { entries: LeaderboardEntry[] }) {
  const scrollMaxHeight = `${LIST_SCROLL_VISIBLE_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">MC Close Effectiveness</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        Overall close rate uses cohort closes/referrals. Assigned close rate uses assigned-agent closes/total closed.
      </p>
      <div
        className="mt-4 overflow-y-auto"
        style={entries.length ? { maxHeight: scrollMaxHeight } : undefined}
        aria-label={entries.length ? 'Scrollable list: MC Close Effectiveness' : undefined}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-raised shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr className="text-left text-xs text-foreground-subtle">
              <th className="py-1 font-medium">Rank</th>
              <th className="py-1 font-medium">MC</th>
              <th className="py-1 font-medium text-right">Overall close rate</th>
              <th className="py-1 font-medium text-right">Assigned close rate</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((entry, index) => {
                const overallCloseRate = entry.closeRate ?? 0;
                const assignedCloseRate = entry.assignedAgentCloseRate ?? 0;
                return (
                  <tr key={`${entry.id}-${index}`} className="border-t border-border text-foreground-muted">
                    <td className="py-2 text-foreground-subtle">#{index + 1}</td>
                    <td className="py-2 font-medium text-foreground">{entry.name}</td>
                    <td className="py-2 text-right">
                      <p>{`${overallCloseRate.toFixed(1)}%`}</p>
                      <p className="text-xs text-foreground-subtle">
                        {`${formatNumber(entry.dealsClosed ?? 0)} / ${formatNumber(entry.totalReferrals ?? 0)}`}
                      </p>
                    </td>
                    <td className="py-2 text-right">
                      <p>{`${assignedCloseRate.toFixed(1)}%`}</p>
                      <p className="text-xs text-foreground-subtle">
                        {`${formatNumber(entry.assignedAgentCloses ?? 0)} / ${formatNumber(entry.totalClosedDeals ?? 0)}`}
                      </p>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-foreground-subtle">
                  Nothing to display for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function McOutsideLenderLossTable({ entries }: { entries: LeaderboardEntry[] }) {
  const scrollMaxHeight = `${LIST_SCROLL_VISIBLE_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">MC Outside Lender Loss Signal</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        Share of closed deals where the assigned agent was used, but AFC was not.
      </p>
      <div
        className="mt-4 overflow-y-auto"
        style={entries.length ? { maxHeight: scrollMaxHeight } : undefined}
        aria-label={entries.length ? 'Scrollable list: MC Outside Lender Loss Signal' : undefined}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-raised shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr className="text-left text-xs text-foreground-subtle">
              <th className="py-1 font-medium">Rank</th>
              <th className="py-1 font-medium">MC</th>
              <th className="py-1 font-medium text-right">Loss signal rate</th>
              <th className="py-1 font-medium text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((entry, index) => {
                const count = entry.outsideLenderLossCount ?? 0;
                const totalClosedDeals = entry.totalClosedDeals ?? 0;
                const rate = entry.outsideLenderLossRate ?? 0;
                return (
                  <tr key={`${entry.id}-${index}`} className="border-t border-border text-foreground-muted">
                    <td className="py-2 text-foreground-subtle">#{index + 1}</td>
                    <td className="py-2 font-medium text-foreground">{entry.name}</td>
                    <td className="py-2 text-right">
                      <p>{`${rate.toFixed(1)}%`}</p>
                      <p className="text-xs text-foreground-subtle">{`${formatNumber(count)} / ${formatNumber(totalClosedDeals)}`}</p>
                    </td>
                    <td className="py-2 text-right">{formatNumber(count)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-foreground-subtle">
                  Nothing to display for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TRANSFER_TIMING_MIN_GROUP_SAMPLE = 5;
const TRANSFER_TIMING_GAP_NOISE_THRESHOLD = 1;

function TransferTimingCard({
  entries,
  onSelectCategory
}: {
  entries?: DashboardResponse['mc']['stageOnTransferSummary'];
  onSelectCategory?: (category: StageOnTransferCategory) => void;
}) {
  const safeEntries = entries ?? [];
  const beforePreApproval = safeEntries.find((entry) => entry.category === 'Pre-approval TBD');
  const afterPreApproval = safeEntries.find((entry) => entry.category === 'Pre-approved');

  const beforeTotal = beforePreApproval?.totalReferrals ?? 0;
  const afterTotal = afterPreApproval?.totalReferrals ?? 0;
  const beforeClosed = beforePreApproval?.closedReferrals ?? 0;
  const afterClosed = afterPreApproval?.closedReferrals ?? 0;
  const beforeRate = beforePreApproval?.closeRate ?? 0;
  const afterRate = afterPreApproval?.closeRate ?? 0;

  const hasEnoughData =
    beforeTotal >= TRANSFER_TIMING_MIN_GROUP_SAMPLE &&
    afterTotal >= TRANSFER_TIMING_MIN_GROUP_SAMPLE;
  const gapPoints = afterRate - beforeRate;
  const absGapPoints = Math.abs(gapPoints);

  let winner: 'before' | 'after' | null = null;
  if (hasEnoughData && absGapPoints >= TRANSFER_TIMING_GAP_NOISE_THRESHOLD) {
    winner = gapPoints > 0 ? 'after' : 'before';
  }

  let conclusion: string;
  if (!hasEnoughData) {
    conclusion = `Not enough data yet — need at least ${TRANSFER_TIMING_MIN_GROUP_SAMPLE} referrals in each group.`;
  } else if (winner === 'after') {
    conclusion = `Transferring AFTER pre-approval closes ${absGapPoints.toFixed(1)} pts more often.`;
  } else if (winner === 'before') {
    conclusion = `Transferring BEFORE pre-approval closes ${absGapPoints.toFixed(1)} pts more often.`;
  } else {
    conclusion = 'Too close to call (gap < 1 pt).';
  }

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
        When to transfer to the brokerage
      </p>
      <p className="mt-1 text-xs text-foreground-subtle">
        Compares close rates for clients transferred to an agent before pre-approval vs after pre-approval.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TransferTimingPanel
          label="Transferred BEFORE pre-approval"
          rate={beforeRate}
          closed={beforeClosed}
          total={beforeTotal}
          isWinner={winner === 'before'}
          onClick={onSelectCategory ? () => onSelectCategory('Pre-approval TBD') : undefined}
        />
        <TransferTimingPanel
          label="Transferred AFTER pre-approval"
          rate={afterRate}
          closed={afterClosed}
          total={afterTotal}
          isWinner={winner === 'after'}
          onClick={onSelectCategory ? () => onSelectCategory('Pre-approved') : undefined}
        />
      </div>

      <p className="mt-3 text-sm font-medium text-foreground">{conclusion}</p>
    </div>
  );
}

function TransferTimingPanel({
  label,
  rate,
  closed,
  total,
  isWinner,
  onClick
}: {
  label: string;
  rate: number;
  closed: number;
  total: number;
  isWinner: boolean;
  onClick?: () => void;
}) {
  const containerClasses = isWinner
    ? 'rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2'
    : 'rounded-lg border border-border bg-surface-muted px-3 py-2';

  return (
    <div className={containerClasses}>
      <div className="flex items-center justify-between gap-2">
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="text-xs font-medium uppercase tracking-wide text-sky-600 underline decoration-dotted underline-offset-2 transition hover:text-sky-700"
          >
            {label}
          </button>
        ) : (
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{label}</p>
        )}
        {isWinner ? (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Recommended
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-2xl font-semibold text-foreground">{rate.toFixed(1)}%</p>
      <p className="text-xs text-foreground-subtle">
        {`${formatNumber(closed)} / ${formatNumber(total)} closed`}
      </p>
    </div>
  );
}

function TransferTimingDrilldownTable({
  rows
}: {
  rows: StageOnTransferDrilldownEntry[];
}) {
  return (
    <div className="overflow-x-auto p-4 sm:p-6">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="text-left text-xs text-foreground-subtle">
            <th className="py-1 font-medium">Borrower</th>
            <th className="py-1 font-medium">MC / Agent</th>
            <th className="py-1 font-medium">Referral status</th>
            <th className="py-1 font-medium text-right">Counted as closed deal</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((entry) => (
              <tr key={entry.referralId} className="border-t border-border text-foreground-muted">
                <td className="py-2">
                  <Link
                    href={`/referrals/${entry.referralId}`}
                    className="font-medium text-sky-600 hover:text-sky-800 hover:underline"
                  >
                    {entry.borrowerName}
                  </Link>
                </td>
                <td className="py-2">
                  <div>{entry.mcName}</div>
                  <div className="text-xs text-foreground-subtle">{entry.agentName}</div>
                </td>
                <td className="py-2">
                  <span className="capitalize">{entry.referralStatus.replace(/_/g, ' ')}</span>
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      entry.hasClosedDeal
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-surface-subtle text-foreground-muted'
                    }`}
                  >
                    {entry.hasClosedDeal ? 'Yes' : 'No'}
                  </span>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="py-8 text-center text-sm text-foreground-subtle">
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
    <div className="space-y-4 rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">Pre-approval conversion</p>
          <p className="text-xs text-foreground-subtle">
            Track how referral volume compares with AHA and AHA OOS pre-approvals issued each month.
          </p>
        </div>
        {canEdit ? (
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs font-medium text-foreground-muted">
              Month
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-foreground-muted">
              Pre-approvals (AHA)
              <input
                type="number"
                min={0}
                value={inputAhaValue}
                onChange={(event) => setInputAhaValue(event.target.value)}
                className="mt-1 w-32 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-foreground-muted">
              Pre-approvals (AHA OOS)
              <input
                type="number"
                min={0}
                value={inputAhaOosValue}
                onChange={(event) => setInputAhaOosValue(event.target.value)}
                className="mt-1 w-32 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === 'saving'}
            >
              {status === 'saving' ? 'Saving…' : 'Save entry'}
            </button>
          </form>
        ) : null}
      </div>
      {selectedEntry ? (
        <div className="rounded-md bg-surface-muted p-3 text-xs text-foreground-muted">
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
        <p className="text-sm text-foreground-muted">Pre-approvals saved.</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <MultiLineChartCard
          title="Conversion trend"
          series={conversionSeries}
          formatValue={(value) => `${value.toFixed(1)}%`}
          helper="Referrals ÷ pre-approvals across recorded months by network"
        />
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-xs text-foreground-subtle">
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
                  <tr key={entry.monthKey} className="border-t border-border text-foreground-muted">
                    <td className="px-3 py-2 font-medium text-foreground">{entry.label}</td>
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
                          className="inline-flex items-center rounded border border-transparent px-2 py-1 text-sm text-foreground-muted hover:text-red-600 disabled:opacity-50"
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
                  <td colSpan={canEdit ? 8 : 7} className="px-3 py-6 text-center text-sm text-foreground-subtle">
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

function periodOverPeriodDelta(current: number, previous: number): string | null {
  if (previous === 0) return current > 0 ? '+100%' : null;
  const pct = ((current - previous) / previous) * 100;
  if (pct === 0) return '0%';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function MainDashboard({
  data,
  canEditPreApprovals,
  onPreApprovalSaved,
  networkFilter
}: {
  data: DashboardResponse['main'];
  canEditPreApprovals: boolean;
  onPreApprovalSaved: () => void;
  networkFilter: NetworkFilter;
}) {
  const [dealsLostModal, setDealsLostModal] = useState<'afc' | 'ahaOos' | null>(null);
  const [pendingClosingsModal, setPendingClosingsModal] = useState<'all' | 'thisMonth' | 'nextMonth' | null>(null);
  const [closedDealsModal, setClosedDealsModal] = useState<
    'generated' | 'closedNotPaid' | 'dealsClosed' | 'avgDaysPaid' | null
  >(null);
  const summary = data.summary;
  const realizedRevenueCents = Math.max(summary.realizedRevenueCents ?? 0, 0);
  const expectedRevenueCents = Math.max(summary.expectedRevenueCents ?? 0, 0);
  const closedNotPaidCents = Math.max(summary.closedNotPaidCents ?? 0, 0);
  const pop = data.periodOverPeriod ?? null;

  // Prefer server-computed rates (L-3) so UI matches API/email reports; fall back for older payloads.
  const revenueRealizationRate =
    summary.revenueRealizationRatePercent ??
    (realizedRevenueCents + expectedRevenueCents > 0
      ? (realizedRevenueCents / (realizedRevenueCents + expectedRevenueCents)) * 100
      : null);

  const closedNotPaidPercentOfExpected =
    summary.closedNotPaidPercentOfExpected ??
    (expectedRevenueCents > 0 ? (closedNotPaidCents / expectedRevenueCents) * 100 : null);

  const revenueVsPrev = pop ? periodOverPeriodDelta(realizedRevenueCents, pop.previous.realizedRevenueCents) : null;
  const referralsVsPrev = pop ? periodOverPeriodDelta(summary.totalReferrals, pop.previous.totalReferrals) : null;
  const closeRateVsPrev = pop ? periodOverPeriodDelta(summary.closeRate, pop.previous.closeRate) : null;

  const highlights: {
    title: string;
    value: string;
    helper?: string;
    extraStats: { label: string; value: string; onClick?: () => void }[];
    drillDownHref?: string;
    onClick?: () => void;
  }[] = [
    {
      title: 'Revenue received',
      value: formatCurrency(summary.realizedRevenueCents),
      helper: revenueVsPrev != null ? `vs previous period: ${revenueVsPrev}` : undefined,
      extraStats: [
        {
          label: 'Generated (closed)',
          value: formatCurrency(summary.generatedRevenueCents),
          onClick:
            summary.generatedRevenueList.length > 0
              ? () => setClosedDealsModal('generated')
              : undefined
        },
        {
          label: 'Closed, not paid',
          value: formatCurrency(summary.closedNotPaidCents),
          onClick:
            summary.closedNotPaidList.length > 0
              ? () => setClosedDealsModal('closedNotPaid')
              : undefined
        }
      ]
    },
    {
      title: 'Total Future Closings',
      value: formatNumber(summary.pendingClosings),
      helper:
        summary.pendingClosings > 0
          ? `${formatCurrency(summary.expectedRevenueFromPendingClosingsCents)} expected`
          : undefined,
      onClick:
        summary.pendingClosings > 0
          ? () => setPendingClosingsModal('all')
          : undefined,
      extraStats: [
        {
          label: 'Closings this month',
          value: formatNumber(summary.pendingClosingsThisMonth),
          onClick:
            summary.pendingClosingsThisMonth > 0
              ? () => setPendingClosingsModal('thisMonth')
              : undefined
        },
        {
          label: 'Closings next month',
          value: formatNumber(summary.pendingClosingsNextMonth),
          onClick:
            summary.pendingClosingsNextMonth > 0
              ? () => setPendingClosingsModal('nextMonth')
              : undefined
        }
      ]
    },
    {
      title: 'Total referrals',
      value: formatNumber(summary.totalReferrals),
      helper: referralsVsPrev != null ? `vs previous period: ${referralsVsPrev}` : undefined,
      extraStats: [
        {
          label: 'Deals closed',
          value: formatNumber(summary.dealsClosedInTimeframe),
          onClick:
            summary.dealsClosedList.length > 0
              ? () => setClosedDealsModal('dealsClosed')
              : undefined
        }
      ],
      drillDownHref: (() => {
        const params = new URLSearchParams();
        if (networkFilter === 'AHA' || networkFilter === 'AHA_OOS') params.set('ahaBucket', networkFilter);
        return params.toString() ? `/referrals?${params.toString()}` : '/referrals';
      })()
    },
    {
      title: 'Close rate',
      value: `${summary.closeRate.toFixed(1)}%`,
      helper: closeRateVsPrev != null ? `vs previous period: ${closeRateVsPrev}` : undefined,
      extraStats: [
        {
          label: 'Avg. days closed → paid',
          value: `${summary.averageDaysClosedToPaid.toFixed(1)} days`,
          onClick:
            summary.averageDaysClosedToPaidList.length > 0
              ? () => setClosedDealsModal('avgDaysPaid')
              : undefined
        }
      ],
      drillDownHref: (() => {
        const params = new URLSearchParams();
        params.set('status', 'Closed');
        if (networkFilter === 'AHA' || networkFilter === 'AHA_OOS') params.set('ahaBucket', networkFilter);
        return `/referrals?${params.toString()}`;
      })()
    }
  ];

  const pipelineMetrics = [
    { label: 'Pipeline value', value: formatCurrency(summary.pipelineValueCents) },
    { label: 'Active pipeline', value: formatNumber(summary.activePipeline) },
    { label: 'Lost referrals', value: formatNumber(summary.lostReferrals) },
    {
      label: 'AFC attach rate (buy-side)',
      value: `${summary.afcAttachRate.toFixed(1)}%`,
      helper: `${formatNumber(summary.afcDealsLost)} buy-side deals lost`,
      onHelperClick: summary.afcDealsLost > 0 ? () => setDealsLostModal('afc') : undefined
    },
    { label: 'AHA attach rate', value: `${summary.ahaAttachRate.toFixed(1)}%` },
    {
      label: 'AHA OOS attach rate',
      value: `${summary.ahaOosAttachRate.toFixed(1)}%`,
      helper: `${formatNumber(summary.ahaOosDealsLost)} deals lost`,
      onHelperClick: summary.ahaOosDealsLost > 0 ? () => setDealsLostModal('ahaOos') : undefined
    },
    { label: 'Avg. pre-approval amount', value: formatCurrency(summary.averagePaAmountCents) }
  ];

  const revenueMetrics = [
    { label: 'Expected revenue', value: formatCurrency(summary.expectedRevenueCents) },
    { label: 'Closed, not paid', value: formatCurrency(summary.closedNotPaidCents) },
    {
      label: 'Revenue realization rate',
      value: revenueRealizationRate == null ? '—' : `${revenueRealizationRate.toFixed(1)}%`
    },
    {
      label: 'Closed-not-paid % of expected',
      value:
        closedNotPaidPercentOfExpected == null ? '—' : `${closedNotPaidPercentOfExpected.toFixed(1)}%`
    },
    { label: 'Total volume closed', value: formatCurrency(summary.totalVolumeClosedCents) },
    { label: 'Avg. referral fee paid', value: formatCurrency(summary.averageReferralFeePaidCents) },
    { label: 'Avg. days closed → paid', value: `${summary.averageDaysClosedToPaid.toFixed(1)} days` },
    { label: 'Avg. closed deal amount', value: formatCurrency(summary.averageClosedDealAmountCents) }
  ];

  const funnelStages = data.funnel?.stages ?? [];
  const funnelTerminal = data.funnel?.terminal ?? { lostTotal: 0, terminatedTotal: 0 };

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
            drillDownHref={card.drillDownHref}
            onClick={card.onClick}
          />
        ))}
      </div>

      {funnelStages.length > 0 ? (
        <ConversionFunnelCard
          stages={funnelStages}
          terminal={funnelTerminal}
          networkFilter={networkFilter}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricGroupCard title="Pipeline health" metrics={pipelineMetrics} />
        <MetricGroupCard title="Revenue performance" metrics={revenueMetrics} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MultiLineChartCard
          title="Revenue"
          series={[
            {
              label: 'Revenue received',
              color: '#10b981',
              data: data.trends.revenue
            },
            {
              label: 'Revenue generated (closed)',
              color: '#0ea5e9',
              data: data.trends.revenueGenerated ?? []
            }
          ]}
          formatValue={formatCurrency}
        />
        <LineChartCard title="Deals closed" data={data.trends.deals} formatValue={(value) => formatNumber(Math.round(value))} color="#f59e0b" />
        <LineChartCard title="Close rate" data={data.trends.closeRate} formatValue={(value) => `${value.toFixed(1)}%`} color="#8b5cf6" />
        <LineChartCard title="Referrals received" data={data.trends.referrals} formatValue={(value) => formatNumber(Math.round(value))} color="#0ea5e9" />
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

      <Modal
        isOpen={dealsLostModal !== null}
        onClose={() => setDealsLostModal(null)}
        title={dealsLostModal === 'afc' ? 'AFC Deals Lost' : 'AHA OOS Deals Lost'}
        size="lg"
      >
        <DealsLostTable
          deals={
            dealsLostModal === 'afc'
              ? summary.afcDealsLostList
              : dealsLostModal === 'ahaOos'
                ? summary.ahaOosDealsLostList
                : []
          }
        />
      </Modal>

      <Modal
        isOpen={pendingClosingsModal !== null}
        onClose={() => setPendingClosingsModal(null)}
        title={
          pendingClosingsModal === 'all'
            ? 'All Future Closings'
            : pendingClosingsModal === 'thisMonth'
              ? 'Closings This Month'
              : 'Closings Next Month'
        }
        size="lg"
      >
        <PendingClosingsTable
          deals={
            pendingClosingsModal === 'all'
              ? summary.pendingClosingsList
              : pendingClosingsModal === 'thisMonth'
                ? summary.pendingClosingsThisMonthList
                : pendingClosingsModal === 'nextMonth'
                  ? summary.pendingClosingsNextMonthList
                  : []
          }
        />
      </Modal>

      <Modal
        isOpen={closedDealsModal !== null}
        onClose={() => setClosedDealsModal(null)}
        title={
          closedDealsModal === 'generated'
            ? 'Generated Revenue (Closed Deals)'
            : closedDealsModal === 'closedNotPaid'
              ? 'Closed, Not Paid'
              : closedDealsModal === 'dealsClosed'
                ? 'Deals Closed'
                : closedDealsModal === 'avgDaysPaid'
                  ? 'Avg. Days Closed → Paid'
                  : ''
        }
        size="lg"
      >
        <ClosedDealsTable
          variant={closedDealsModal ?? 'generated'}
          deals={
            closedDealsModal === 'generated'
              ? summary.generatedRevenueList
              : closedDealsModal === 'closedNotPaid'
                ? summary.closedNotPaidList
                : closedDealsModal === 'dealsClosed'
                  ? summary.dealsClosedList
                  : closedDealsModal === 'avgDaysPaid'
                    ? summary.averageDaysClosedToPaidList
                    : []
          }
        />
      </Modal>
    </div>
  );
}

function DealsLostTable({ deals }: { deals: LostDealEntry[] }) {
  if (!deals.length) {
    return <p className="px-6 py-8 text-center text-sm text-foreground-subtle">No lost deals.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-foreground-muted">
            <th className="px-6 py-3">Borrower</th>
            <th className="px-6 py-3">Agent</th>
            <th className="px-6 py-3">MC</th>
            <th className="px-6 py-3">Status</th>
            <th className="px-6 py-3 text-right">Expected</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((deal) => (
            <tr key={deal.id} className="hover:bg-surface-muted">
              <td className="px-6 py-3 font-medium text-foreground-muted">
                <Link href={`/referrals/${deal.referralId}`} className="hover:text-sky-600 hover:underline">
                  {deal.borrowerName}
                </Link>
              </td>
              <td className="px-6 py-3 text-foreground-muted">{deal.agentName ?? '—'}</td>
              <td className="px-6 py-3 text-foreground-muted">{deal.mcName ?? '—'}</td>
              <td className="px-6 py-3 text-foreground-muted">
                {DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status}
              </td>
              <td className="px-6 py-3 text-right text-foreground-muted">{formatCurrency(deal.expectedAmountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingClosingsTable({ deals }: { deals: PendingClosingEntry[] }) {
  if (!deals.length) {
    return (
      <p className="px-6 py-8 text-center text-sm text-foreground-subtle">
        No pending closings for this period.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-foreground-muted">
            <th className="px-6 py-3">Borrower</th>
            <th className="px-6 py-3">Agent</th>
            <th className="px-6 py-3">MC</th>
            <th className="px-6 py-3">Status</th>
            <th className="px-6 py-3">Closing date</th>
            <th className="px-6 py-3 text-right">Expected fee</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((deal) => {
            const statusLabel =
              DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status;
            return (
              <tr key={deal.id} className="hover:bg-surface-muted">
                <td className="px-6 py-3 font-medium text-foreground-muted">
                  <Link
                    href={`/referrals/${deal.referralId}`}
                    className="hover:text-sky-600 hover:underline"
                  >
                    {deal.borrowerName}
                  </Link>
                </td>
                <td className="px-6 py-3 text-foreground-muted">{deal.agentName ?? '—'}</td>
                <td className="px-6 py-3 text-foreground-muted">{deal.mcName ?? '—'}</td>
                <td className="px-6 py-3 text-foreground-muted">{statusLabel}</td>
                <td className="px-6 py-3 text-foreground-muted">
                  {deal.closingDate ? formatDate(deal.closingDate) : '—'}
                </td>
                <td className="px-6 py-3 text-right text-foreground-muted">
                  {formatCurrency(deal.expectedAmountCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type ClosedDealsTableVariant = 'generated' | 'closedNotPaid' | 'dealsClosed' | 'avgDaysPaid';

function ClosedDealsTable({
  variant,
  deals
}: {
  variant: ClosedDealsTableVariant;
  deals: ClosedDealEntry[];
}) {
  if (!deals.length) {
    return (
      <p className="px-6 py-8 text-center text-sm text-foreground-subtle">
        No deals to display for this period.
      </p>
    );
  }

  const showStatus = variant !== 'avgDaysPaid';
  const trailingHeader =
    variant === 'closedNotPaid'
      ? 'Outstanding'
      : variant === 'avgDaysPaid'
        ? 'Days closed → paid'
        : 'Expected fee';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-foreground-muted">
            <th className="px-6 py-3">Borrower</th>
            <th className="px-6 py-3">Agent</th>
            <th className="px-6 py-3">MC</th>
            {showStatus ? <th className="px-6 py-3">Status</th> : null}
            <th className="px-6 py-3">Closing date</th>
            {variant === 'avgDaysPaid' ? <th className="px-6 py-3">Paid date</th> : null}
            <th className="px-6 py-3 text-right">{trailingHeader}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((deal) => {
            const statusLabel =
              DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status;
            const trailingValue =
              variant === 'closedNotPaid'
                ? formatCurrency(deal.outstandingAmountCents)
                : variant === 'avgDaysPaid'
                  ? deal.daysClosedToPaid != null
                    ? `${deal.daysClosedToPaid.toFixed(1)} days`
                    : '—'
                  : formatCurrency(deal.expectedAmountCents);
            return (
              <tr key={deal.id} className="hover:bg-surface-muted">
                <td className="px-6 py-3 font-medium text-foreground-muted">
                  <Link
                    href={`/referrals/${deal.referralId}`}
                    className="hover:text-sky-600 hover:underline"
                  >
                    {deal.borrowerName}
                  </Link>
                </td>
                <td className="px-6 py-3 text-foreground-muted">{deal.agentName ?? '—'}</td>
                <td className="px-6 py-3 text-foreground-muted">{deal.mcName ?? '—'}</td>
                {showStatus ? (
                  <td className="px-6 py-3 text-foreground-muted">{statusLabel}</td>
                ) : null}
                <td className="px-6 py-3 text-foreground-muted">
                  {deal.closingDate ? formatDate(deal.closingDate) : '—'}
                </td>
                {variant === 'avgDaysPaid' ? (
                  <td className="px-6 py-3 text-foreground-muted">
                    {deal.paidDate ? formatDate(deal.paidDate) : '—'}
                  </td>
                ) : null}
                <td className="px-6 py-3 text-right text-foreground-muted">{trailingValue}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function McRankedList({ title, entries }: { title: string; entries: McRankedEntry[] }) {
  const [selectedMc, setSelectedMc] = useState<McRankedEntry | null>(null);
  const scrollMaxHeight = `${RANKED_LIST_PREVIEW_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        Composite score blends weighted MC KPIs scored relative to peers this period. The top drivers of rank are closed
        deals using AFC (highest weight), closed deals without AFC, total revenue, and referral (transfer) volume. AFC
        capture, AHA / AHA OOS attach, close speed, pushback, and NPS act as lower-weight quality guardrails. MCs with
        fewer than 3 referrals are marked provisional and receive a reliability adjustment. KPIs with no data this period
        are excluded from that MC's weighted average rather than dragging the score toward the median.
      </p>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-subtle">No MCs with data for this period.</p>
      ) : (
        <div className="mt-4 overflow-y-auto" style={{ maxHeight: scrollMaxHeight }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-raised">
              <tr className="text-left text-xs text-foreground-subtle">
                <th className="py-1 font-medium w-10">Rank</th>
                <th className="py-1 font-medium">MC</th>
                <th className="py-1 font-medium text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border text-foreground-muted">
                  <td className="py-2 text-foreground-subtle">#{entry.rank}</td>
                  <td className="py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => setSelectedMc(entry)}
                      className="text-sky-600 hover:text-sky-800 hover:underline text-left"
                    >
                      {entry.name}
                    </button>
                    {!entry.qualified ? (
                      <span className="ml-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Provisional
                      </span>
                    ) : (
                      <span className="ml-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Qualified
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${getCompositeScoreStyle(entry.score)}`}
                    >
                      {entry.score.toFixed(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={selectedMc != null}
        onClose={() => setSelectedMc(null)}
        title={selectedMc?.name ?? ''}
        size="md"
      >
        {selectedMc && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground-subtle">Composite Score</span>
              <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold tabular-nums ${getCompositeScoreStyle(selectedMc.score)}`}>
                {selectedMc.score.toFixed(1)} / 100
              </span>
            </div>
            <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
              <p>
                Base score: <span className="font-semibold text-foreground">{selectedMc.baseScore.toFixed(1)}</span>
                {' '}· Reliability factor:{' '}
                <span className="font-semibold text-foreground">{selectedMc.reliabilityFactor.toFixed(3)}</span>
                {' '}· Referrals:{' '}
                <span className="font-semibold text-foreground">{formatNumber(selectedMc.referralCount)}</span>
              </p>
              {!selectedMc.qualified ? (
                <p className="mt-1">Provisional ranking: fewer than 3 referrals in selected timeframe.</p>
              ) : null}
            </div>
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground-subtle">KPI Breakdown</p>
              <div className="space-y-3">
                {selectedMc.kpis.map((kpi) => (
                  <div key={kpi.key}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground-muted">{kpi.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getKpiWeightBadge(kpi.weight)}`}>
                          {getKpiWeightLabel(kpi.weight)}
                        </span>
                        {kpi.neutralFilled ? (
                          <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                            Neutral
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-foreground-subtle">{kpi.displayValue}</span>
                        <span className="font-semibold text-foreground tabular-nums w-12 text-right">
                          {kpi.normalizedScore.toFixed(0)}/100
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface-subtle">
                      <div
                        className={`h-1.5 rounded-full transition-all ${kpi.normalizedScore >= 75 ? 'bg-emerald-500' : kpi.normalizedScore >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${kpi.normalizedScore}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function McAfcRiskCallListTable({ entries }: { entries: McAfcRiskCallListEntry[] }) {
  const getRiskTierBadge = (tier: McAfcRiskCallListEntry['riskTier']) => {
    if (tier === 'high') return 'bg-rose-100 text-rose-700';
    if (tier === 'medium') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };
  const shouldScroll = entries.length > RANKED_LIST_PREVIEW_ROWS;
  const scrollMaxHeight = `${RANKED_LIST_PREVIEW_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">AFC Loss Risk Call List</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        All open buy-side AFC referrals currently at risk, ranked with outside-lender notes and MC outside-lender loss priority.
        Historical (all-time) risk factors are blended with the current referral&rsquo;s signals; this table is not filtered by the selected timeframe.
      </p>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-subtle">No qualifying referrals in the active AFC pipeline.</p>
      ) : (
        <div
          className="mt-4 overflow-x-auto overflow-y-auto"
          style={shouldScroll ? { maxHeight: scrollMaxHeight } : undefined}
        >
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-3 py-2">Borrower</th>
                <th className="px-3 py-2">MC / Agent</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Closing</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Top reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.rowId} className="hover:bg-surface-muted">
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <Link href={`/referrals/${entry.referralId}`} className="font-medium text-primary-700 hover:underline">
                        {entry.borrowerName}
                      </Link>
                      <span className="text-xs text-foreground-subtle">{entry.source}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-foreground-muted">
                    <div>{entry.mcName ?? 'Unassigned MC'}</div>
                    <div className="text-xs text-foreground-subtle">{entry.agentName ?? 'Unassigned Agent'}</div>
                  </td>
                  <td className="px-3 py-2 text-foreground-muted">
                    <div className="capitalize">{entry.status}</div>
                    <div className="text-xs text-foreground-subtle">{entry.daysSinceActivity}d since activity</div>
                  </td>
                  <td className="px-3 py-2 text-foreground-muted">
                    <div>{entry.closingDate ? formatDate(entry.closingDate) : '—'}</div>
                    <div className="text-xs text-foreground-subtle">
                      {entry.daysToClose != null ? `${entry.daysToClose}d to close` : 'No closing date'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getRiskTierBadge(entry.riskTier)}`}>
                        {entry.riskTier}
                      </span>
                      <span className="font-semibold text-foreground">{entry.riskScore.toFixed(1)}</span>
                    </div>
                    <div className="text-xs text-foreground-subtle">
                      {entry.usedAfc === true
                        ? 'AFC attached'
                        : entry.usedAfc === false
                          ? 'AFC not attached on deal'
                          : 'No deal record yet'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-foreground-muted">
                    {entry.reasons.length ? entry.reasons.join(' · ') : 'No elevated signals'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function McDashboard({ data }: { data: DashboardResponse['mc'] }) {
  const [selectedTransferCategory, setSelectedTransferCategory] = useState<StageOnTransferCategory | null>(null);
  const selectedTransferRows = useMemo(
    () =>
      selectedTransferCategory
        ? (data.stageOnTransferDrilldown.find((entry) => entry.category === selectedTransferCategory)?.rows ?? [])
        : [],
    [data.stageOnTransferDrilldown, selectedTransferCategory]
  );

  return (
    <div className="space-y-6">
      <McRankedList title="MC Composite KPI Leaderboard" entries={data.kpiLeaderboard.rankedMcs} />
      <McAfcRiskCallListTable entries={data.afcRiskCallList} />
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
        <McCloseEffectivenessTable entries={data.closeRateLeaderboard} />
        <McOutsideLenderLossTable entries={data.outsideLenderLossLeaderboard} />
      </div>
      <div>
        <TransferTimingCard
          entries={data.stageOnTransferSummary}
          onSelectCategory={setSelectedTransferCategory}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PushbackSummaryCard summary={data.pushbackSummary} />
        <McPushbackLeaderboardTable entries={data.pushbackSummary.byMc} />
      </div>
      <Modal
        isOpen={selectedTransferCategory !== null}
        onClose={() => setSelectedTransferCategory(null)}
        title={
          selectedTransferCategory === 'Pre-approval TBD'
            ? 'Transferred BEFORE pre-approval'
            : selectedTransferCategory === 'Pre-approved'
              ? 'Transferred AFTER pre-approval'
              : ''
        }
        size="lg"
      >
        <TransferTimingDrilldownTable rows={selectedTransferRows} />
      </Modal>
    </div>
  );
}

function PushbackSummaryCard({
  summary
}: {
  summary: DashboardResponse['mc']['pushbackSummary'];
}) {
  const rate = summary.pushbackRatePercent.toFixed(1);
  const avgDays = summary.averageDaysPushedBackPerEvent.toFixed(1);
  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
        Deals pushed back
      </p>
      <div className="mt-2 flex items-baseline gap-3">
        <p className="text-2xl font-semibold text-foreground">
          {formatNumber(summary.distinctDealsPushedBack)}
        </p>
        <p className="text-sm font-medium text-foreground-subtle">{rate}% pushback rate</p>
      </div>
      <p className="mt-1 text-xs text-foreground-subtle">
        Any deal whose closing date was moved to a later date in this timeframe/network view.
        Rate = pushed-back deals / all active or closed deals.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-muted px-2 py-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
            Total pushback events
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {formatNumber(summary.totalPushbackEvents)}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-muted px-2 py-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
            Avg. days pushed back
          </dt>
          <dd className="text-sm font-semibold text-foreground">{avgDays} days</dd>
        </div>
      </dl>
    </div>
  );
}

function McPushbackLeaderboardTable({
  entries
}: {
  entries: DashboardResponse['mc']['pushbackSummary']['byMc'];
}) {
  const scrollMaxHeight = `${LIST_SCROLL_VISIBLE_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
        Pushbacks by MC
      </p>
      <p className="mt-1 text-xs text-foreground-subtle">
        MCs with at least one deal whose closing date was moved later in this timeframe.
      </p>
      <div
        className="mt-4 overflow-y-auto"
        style={entries.length ? { maxHeight: scrollMaxHeight } : undefined}
        aria-label={entries.length ? 'Scrollable list: Pushbacks by MC' : undefined}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-raised shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr className="text-left text-xs text-foreground-subtle">
              <th className="py-1 font-medium">Rank</th>
              <th className="py-1 font-medium">MC</th>
              <th className="py-1 font-medium text-right">Deals pushed back</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((entry, index) => (
                <tr
                  key={`${entry.id}-${index}`}
                  className="border-t border-border text-foreground-muted"
                >
                  <td className="py-2 text-foreground-subtle">#{index + 1}</td>
                  <td className="py-2 font-medium text-foreground">{entry.name}</td>
                  <td className="py-2 text-right">
                    <p>{`${formatNumber(entry.dealsPushedBack)} (${entry.pushbackRatePercent.toFixed(1)}%)`}</p>
                    <p className="text-xs text-foreground-subtle">
                      {`${formatNumber(entry.dealsPushedBack)} / ${formatNumber(entry.totalDeals)} deals`}
                    </p>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="py-6 text-center text-sm text-foreground-subtle">
                  No deals have been pushed back in this timeframe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AhaRankedList({ title, data }: { title: string; data: { rankedAgents: AhaRankedAgent[] } }) {
  const [selectedAgent, setSelectedAgent] = useState<AhaRankedAgent | null>(null);
  const scrollMaxHeight = `${RANKED_LIST_PREVIEW_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{title}</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        Composite score blends weighted KPIs. Agents with fewer than 3 referrals are marked provisional and receive a
        reliability adjustment. CRM usage is included as a low-weight tie-break style signal.
      </p>
      {data.rankedAgents.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-subtle">No agents with data for this period.</p>
      ) : (
        <>
          <div className="mt-4 overflow-y-auto" style={{ maxHeight: scrollMaxHeight }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-raised">
                <tr className="text-left text-xs text-foreground-subtle">
                  <th className="py-1 font-medium w-10">Rank</th>
                  <th className="py-1 font-medium">Agent</th>
                  <th className="py-1 font-medium text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.rankedAgents.map((agent) => (
                  <tr key={agent.id} className="border-t border-border text-foreground-muted">
                    <td className="py-2 text-foreground-subtle">#{agent.rank}</td>
                    <td className="py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => setSelectedAgent(agent)}
                        className="text-sky-600 hover:text-sky-800 hover:underline text-left"
                      >
                        {agent.name}
                      </button>
                      {!agent.qualified ? (
                        <span className="ml-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Provisional
                        </span>
                      ) : (
                        <span className="ml-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Qualified
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${getCompositeScoreStyle(agent.score)}`}>
                        {agent.score.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        isOpen={selectedAgent != null}
        onClose={() => setSelectedAgent(null)}
        title={selectedAgent?.name ?? ''}
        size="md"
      >
        {selectedAgent && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground-subtle">Composite Score</span>
              <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold tabular-nums ${getCompositeScoreStyle(selectedAgent.score)}`}>
                {selectedAgent.score.toFixed(1)} / 100
              </span>
            </div>
            <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
              <p>
                Base score: <span className="font-semibold text-foreground">{selectedAgent.baseScore.toFixed(1)}</span>
                {' '}· Reliability factor:{' '}
                <span className="font-semibold text-foreground">{selectedAgent.reliabilityFactor.toFixed(3)}</span>
                {' '}· Referrals:{' '}
                <span className="font-semibold text-foreground">{formatNumber(selectedAgent.referralCount)}</span>
              </p>
              {!selectedAgent.qualified ? (
                <p className="mt-1">
                  Provisional ranking: fewer than 3 referrals in selected timeframe.
                </p>
              ) : null}
            </div>
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground-subtle">KPI Breakdown</p>
              <div className="space-y-3">
                {selectedAgent.kpis.map((kpi) => (
                  <div key={kpi.key}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground-muted">{kpi.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getKpiWeightBadge(kpi.weight)}`}>
                          {getKpiWeightLabel(kpi.weight)}
                        </span>
                        {kpi.neutralFilled ? (
                          <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                            Neutral
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-foreground-subtle">{kpi.displayValue}</span>
                        <span className="font-semibold text-foreground tabular-nums w-12 text-right">
                          {kpi.normalizedScore.toFixed(0)}/100
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface-subtle">
                      <div
                        className={`h-1.5 rounded-full transition-all ${kpi.normalizedScore >= 75 ? 'bg-emerald-500' : kpi.normalizedScore >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${kpi.normalizedScore}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AgentDashboard({ data }: { data: DashboardResponse['agent'] }) {
  const averageCommissionDisplay =
    data.averageCommissionPercent > 0 ? `${data.averageCommissionPercent.toFixed(2)}%` : '—';
  const commissionHelper =
    data.commissionSampleSize > 0
      ? `Unweighted mean across ${formatNumber(data.commissionSampleSize)} closed/paid deals`
      : 'No closed or paid deals this period';

  const averageReferralFeeDisplay =
    data.averageReferralFeePercent > 0 ? `${data.averageReferralFeePercent.toFixed(2)}%` : '—';
  const referralFeeHelper =
    data.referralFeeSampleSize > 0
      ? `Unweighted mean across ${formatNumber(data.referralFeeSampleSize)} closed/paid deals`
      : 'No closed or paid deals this period';

  return (
    <div className="space-y-6">
      {data.ahaLeaderboards && (
        <AhaRankedList title="AHA Agent Leaderboard" data={data.ahaLeaderboards} />
      )}
      {data.ahaOosLeaderboards && (
        <AhaRankedList title="AHA OOS Agent Leaderboard" data={data.ahaOosLeaderboards} />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard title="Average agent commission" value={averageCommissionDisplay} helper={commissionHelper} />
        <SummaryCard title="Average referral fee" value={averageReferralFeeDisplay} helper={referralFeeHelper} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Referrals by agent" entries={data.referralLeaderboard} valueLabel="Referrals" />
        <LeaderboardTable title="Close rate by agent" entries={data.closeRateLeaderboard} valueLabel="Close rate" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <LeaderboardTable
          title="Avg. closed deal amount by agent"
          entries={data.averageClosedDealAmount}
          valueLabel="Avg. closed deal"
        />
        <LeaderboardTable title="Revenue paid by agent" entries={data.revenuePaid} valueLabel="Revenue" />
        <LeaderboardTable title="Revenue expected by agent" entries={data.revenueExpected} valueLabel="Expected" />
      </div>
      <div className={`grid gap-4 lg:grid-cols-2${data.agentCreatedMcAssignments.length > 0 ? ' xl:grid-cols-3' : ''}`}>
        <LeaderboardTable title="Agent net earnings" entries={data.netRevenue} valueLabel="Net revenue" />
        <LeaderboardTable title="Lost referrals by agent" entries={data.lostDeals} valueLabel="Lost referrals" />
        {data.agentCreatedMcAssignments.length > 0 ? (
          <LeaderboardTable
            title="Agent-created referrals assigned to MCs"
            entries={data.agentCreatedMcAssignments}
            valueLabel="Referrals"
          />
        ) : null}
      </div>
    </div>
  );
}

function StaleReferralsTable({ referrals }: { referrals: StaleReferralEntry[] }) {
  if (!referrals.length) {
    return <p className="px-6 py-8 text-center text-sm text-foreground-subtle">No stale referrals.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-foreground-muted">
            <th className="px-6 py-3">Borrower</th>
            <th className="px-6 py-3">Status</th>
            <th className="px-6 py-3">Agent</th>
            <th className="px-6 py-3">MC</th>
            <th className="px-6 py-3">Last Activity</th>
            <th className="px-6 py-3 text-right">Days Stale</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {referrals.map((row) => (
            <tr key={row.id} className="hover:bg-surface-muted">
              <td className="px-6 py-3 font-medium text-foreground-muted">
                <Link href={`/referrals/${row.id}`} className="hover:text-sky-600 hover:underline">
                  {row.borrowerName}
                </Link>
              </td>
              <td className="px-6 py-3 text-foreground-muted">{row.status}</td>
              <td className="px-6 py-3 text-foreground-muted">{row.agentName ?? '—'}</td>
              <td className="px-6 py-3 text-foreground-muted">{row.mcName ?? '—'}</td>
              <td className="px-6 py-3 text-foreground-muted">
                {row.lastActivityAt
                  ? new Date(row.lastActivityAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : '—'}
              </td>
              <td className="px-6 py-3 text-right font-medium text-foreground-muted">{row.daysSinceActivity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NoOpenTaskReferralsTable({ referrals }: { referrals: NoOpenTaskReferralEntry[] }) {
  const scrollMaxHeight = `${RANKED_LIST_PREVIEW_ROWS * LEADERBOARD_ROW_HEIGHT_REM + LEADERBOARD_HEADER_HEIGHT_REM}rem`;

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card">
      <div className="border-b border-border bg-surface-muted px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Referrals with no open tasks
        </h3>
        <p className="mt-1 text-xs text-foreground-subtle">
          Active pipeline referrals missing open follow-up tasks
        </p>
      </div>
      {referrals.length === 0 ? (
        <p className="px-4 py-6 text-sm text-foreground-subtle">
          No referrals currently match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: scrollMaxHeight }}>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Borrower
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Agent
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  MC
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Last Activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {referrals.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    <Link
                      prefetch={false}
                      href={`/referrals/${row.id}`}
                      className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                    >
                      {row.borrowerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{row.status}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{row.agentName ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{row.mcName ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {row.lastActivityAt ? formatDate(new Date(row.lastActivityAt)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminDashboard({ data }: { data: DashboardResponse['admin'] }) {
  const [showStaleModal, setShowStaleModal] = useState(false);
  const assignmentRate = data.totalReferrals
    ? (data.assignedReferrals / data.totalReferrals) * 100
    : 0;
  const assignmentHelper = data.totalReferrals
    ? `${formatNumber(data.assignedReferrals)} of ${formatNumber(data.totalReferrals)} referrals paired`
    : 'No referrals this period';
  const firstContactHelper = data.firstContactSampleSize
    ? `${formatNumber(data.firstContactWithin24HoursCount)} of ${formatNumber(data.firstContactSampleSize)} contacts`
    : 'No contact records available';
  const onTimeTaskCompletionRate = data.onTimeTaskCompletionSampleSize
    ? (data.onTimeTaskCompletionCount / data.onTimeTaskCompletionSampleSize) * 100
    : null;

  const cards = [
    {
      title: 'Avg. time to first agent contact',
      value: `${data.slaAverages.timeToFirstAgentContactHours.toFixed(1)} hours`,
      helper: 'Business hours · Goal ≤ 24 hours'
    },
    {
      title: 'Avg. time to assignment',
      value: `${data.slaAverages.timeToAssignmentHours.toFixed(1)} hours`,
      helper: 'Business hours'
    },
    {
      title: 'Avg. days to contract',
      value: `${data.averageDaysNewLeadToContract.toFixed(1)} days`,
      helper: 'Calendar days'
    },
    {
      title: 'Avg. days contract → close',
      value: `${data.averageDaysContractToClose.toFixed(1)} days`,
      helper: 'Calendar days'
    },
    { title: 'Assignment rate', value: `${assignmentRate.toFixed(1)}%`, helper: assignmentHelper },
    {
      title: 'First contact within 24h',
      value: `${data.firstContactWithin24HoursRate.toFixed(1)}%`,
      helper: firstContactHelper
    },
    {
      title: 'Unassigned referrals',
      value: formatNumber(data.unassignedReferrals),
      helper: data.unassignedReferrals > 0 ? 'Needs follow-up' : 'All referrals paired'
    },
    {
      title: 'Stale active pipeline',
      value: formatNumber(data.stalePipelineCount),
      helper: 'No activity in 14+ days',
      onClick: data.stalePipelineCount > 0 ? () => setShowStaleModal(true) : undefined
    },
    {
      title: 'Overdue tasks',
      value: formatNumber(data.overdueTaskCount),
      helper: 'Open tasks past due date',
      drillDownHref: '/admin/tasks'
    },
    {
      title: 'Due today',
      value: formatNumber(data.dueTodayTaskCount),
      helper: 'Tasks due today'
    },
    {
      title: 'Tasks completed',
      value: formatNumber(data.completedInTimeframeCount),
      helper: 'Tasks completed or dismissed in period'
    },
    {
      title: 'On Time Task Completion',
      value: onTimeTaskCompletionRate != null ? `${onTimeTaskCompletionRate.toFixed(1)}%` : '—',
      helper:
        data.onTimeTaskCompletionSampleSize > 0
          ? `${formatNumber(data.onTimeTaskCompletionCount)} of ${formatNumber(data.onTimeTaskCompletionSampleSize)} resolved on or before due date`
          : 'No resolved tasks with due dates in period'
    }
  ];

  const taskTrend = data.taskActivityTrend;
  const hasTaskTrendData =
    (taskTrend.outstanding?.length ?? 0) > 0 ||
    (taskTrend.completed?.length ?? 0) > 0 ||
    (taskTrend.created?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <SummaryCard
            key={card.title}
            title={card.title}
            value={card.value}
            helper={card.helper}
            drillDownHref={'drillDownHref' in card ? card.drillDownHref : undefined}
            onClick={'onClick' in card ? card.onClick : undefined}
          />
        ))}
      </div>
      <Modal
        isOpen={showStaleModal}
        onClose={() => setShowStaleModal(false)}
        title="Stale active pipeline"
        size="lg"
      >
        <StaleReferralsTable referrals={data.stalePipelineList} />
      </Modal>
      {hasTaskTrendData ? (
        <MultiLineChartCard
          title="Task activity (30 days)"
          helper="Outstanding open tasks and daily completed/created"
          formatValue={(v) => String(Math.round(v))}
          series={[
            { label: 'Outstanding', color: '#0ea5e9', data: taskTrend.outstanding ?? [] },
            { label: 'Completed', color: '#22c55e', data: taskTrend.completed ?? [] },
            { label: 'Created', color: '#f59e0b', data: taskTrend.created ?? [] }
          ]}
        />
      ) : null}
      <NoOpenTaskReferralsTable referrals={data.noOpenTaskReferrals} />
    </div>
  );
}

function AgitDashboard({ data }: { data: DashboardResponse['agit'] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="AGIT Percentage"
          value={`${data.agitPercentage.toFixed(1)}%`}
          helper={`${formatNumber(data.agitReferrals)} of referrals in timeframe have AGIT agent`}
        />
        <SummaryCard
          title="Closed Deals"
          value={formatNumber(data.dealsClosed)}
        />
        <SummaryCard
          title="Used AFC (Buy-side Attach Rate)"
          value={`${data.usedAfcRate.toFixed(1)}%`}
          helper={`${formatNumber(data.usedAfcCount)} used AFC`}
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

      {/* AGIT Referrals Table */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-foreground">AGIT Referrals</h3>
        {data.referralRows.length === 0 ? (
          <p className="text-sm text-foreground-subtle">No AGIT referrals in this timeframe.</p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Borrower</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Agent</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">MC</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.referralRows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      <div className="flex flex-col">
                        <Link
                          prefetch={false}
                          href={`/referrals/${row.id}`}
                          className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                        >
                          {row.borrowerName}
                        </Link>
                        {row.loanFileNumber && (
                          <span className="text-xs text-foreground-subtle">Loan # {row.loanFileNumber}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{row.status}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {row.agentId ? (
                        <div className="flex flex-col">
                          <Link
                            prefetch={false}
                            href={`/agents/${row.agentId}`}
                            className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                          >
                            {row.agentName || 'Agent'}
                          </Link>
                          {row.agentEmail && (
                            <a
                              href={buildGmailComposeUrl(row.agentEmail)}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-xs text-primary-700 hover:underline"
                            >
                              {row.agentEmail}
                            </a>
                          )}
                          {row.agentPhone && (
                            <a
                              href={`tel:${row.agentPhone.replace(/[^0-9+]/g, '')}`}
                              className="block text-xs text-primary-700 hover:underline"
                            >
                              {row.agentPhone}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-foreground-subtle">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {row.mcId ? (
                        <div className="flex flex-col">
                          <Link
                            prefetch={false}
                            href={`/lenders/${row.mcId}`}
                            className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                          >
                            {row.mcName || 'MC'}
                          </Link>
                          {row.mcEmail && (
                            <a
                              href={buildGmailComposeUrl(row.mcEmail)}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-xs text-primary-700 hover:underline"
                            >
                              {row.mcEmail}
                            </a>
                          )}
                          {row.mcPhone && (
                            <a
                              href={`tel:${row.mcPhone.replace(/[^0-9+]/g, '')}`}
                              className="block text-xs text-primary-700 hover:underline"
                            >
                              {row.mcPhone}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-foreground-subtle">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {formatDate(row.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AGIT Deals Table */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-foreground">AGIT Deals</h3>
        {data.dealRows.length === 0 ? (
          <p className="text-sm text-foreground-subtle">No deals for AGIT referrals in this timeframe.</p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Referral</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Expected</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Received</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Agent</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">MC</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Closing Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Used AFC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.dealRows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      <Link
                        prefetch={false}
                        href={`/referrals/${row.referralId}`}
                        className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                      >
                        {row.borrowerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted capitalize">{row.status.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{formatCurrency(row.expectedAmountCents)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{formatCurrency(row.receivedAmountCents)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {row.agentId ? (
                        <Link
                          prefetch={false}
                          href={`/agents/${row.agentId}`}
                          className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                        >
                          {row.agentName || 'Agent'}
                        </Link>
                      ) : (
                        <span className="text-foreground-subtle">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {row.mcId ? (
                        <div className="flex flex-col">
                          <Link
                            prefetch={false}
                            href={`/lenders/${row.mcId}`}
                            className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
                          >
                            {row.mcName || 'MC'}
                          </Link>
                          {row.mcEmail && (
                            <a
                              href={buildGmailComposeUrl(row.mcEmail)}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-xs text-primary-700 hover:underline"
                            >
                              {row.mcEmail}
                            </a>
                          )}
                          {row.mcPhone && (
                            <a
                              href={`tel:${row.mcPhone.replace(/[^0-9+]/g, '')}`}
                              className="block text-xs text-primary-700 hover:underline"
                            >
                              {row.mcPhone}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-foreground-subtle">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {row.closingDate ? formatDate(row.closingDate) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {row.usedAfc === null ? '—' : row.usedAfc ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
          <h1 className="text-2xl font-semibold text-foreground">Performance dashboards</h1>
          <p className="text-sm text-foreground-subtle">{timeframeLabel}</p>
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
            <span className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">Network</span>
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
                  ? 'border-transparent bg-primary-600 text-white shadow-sm'
                  : 'border-border bg-surface text-foreground-muted hover:border-border-strong hover:bg-surface-muted'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {showSkeleton ? (
        <div className="space-y-4">
          <div
            className={`grid gap-4 md:grid-cols-2 ${activeTab === 'agit' ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
          >
            {Array.from({ length: activeTab === 'agit' ? 5 : 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-card border border-border bg-surface-muted" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-card border border-border bg-surface-muted" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-52 animate-pulse rounded-card border border-border bg-surface-muted" />
            <div className="h-52 animate-pulse rounded-card border border-border bg-surface-muted" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-48 animate-pulse rounded-card border border-border bg-surface-muted" />
            <div className="h-48 animate-pulse rounded-card border border-border bg-surface-muted" />
          </div>
        </div>
      ) : null}

      {!swrKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Select a start and end date to load dashboard metrics.
        </div>
      ) : data ? (
        <div>
          {activeTab === 'main' ? (
            <MainDashboard
              data={data.main}
              canEditPreApprovals={canViewGlobal}
              onPreApprovalSaved={handlePreApprovalSaved}
              networkFilter={activeNetworkFilter}
            />
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
