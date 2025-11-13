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
import { Trash2 } from 'lucide-react';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format as formatDate,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subYears
} from 'date-fns';

type TimeframePreset = 'day' | 'week' | 'month' | 'year' | 'ytd';
type TimeframeKey = TimeframePreset | 'custom';
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

interface DashboardSummary {
  totalReferrals: number;
  dealsClosed: number;
  dealsUnderContract: number;
  closeRate: number;
  afcDealsLost: number;
  afcAttachRate: number;
  ahaAttachRate: number;
  ahaOosAttachRate: number;
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
      mcTransfers: TrendPoint[];
    };
    revenueBySource: { label: string; value: number }[];
    revenueByEndorser: { label: string; value: number }[];
    revenueByState: { label: string; value: number }[];
    referralRequestsByZip: { label: string; value: number }[];
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
    commissionSampleSize: number;
    referralLeaderboard: LeaderboardEntry[];
    closeRateLeaderboard: LeaderboardEntry[];
    revenuePaid: LeaderboardEntry[];
    revenueExpected: LeaderboardEntry[];
    netRevenue: LeaderboardEntry[];
    lostDeals: LeaderboardEntry[];
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
}

const TIMEFRAME_PRESETS: { label: string; value: TimeframePreset }[] = [
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
  admin: 'AHA_OOS'
};

type DateRange = { start: string; end: string };

const DATE_INPUT_FORMAT = 'yyyy-MM-dd';
const DISPLAY_RANGE_FORMAT = 'MMM d, yyyy';

function formatDateInput(date: Date): string {
  return formatDate(date, DATE_INPUT_FORMAT);
}

type RangeDraft = { start: string | null; end: string | null };

function normalizeRange(start: string | null, end: string | null): RangeDraft {
  if (!start || !end) {
    return { start, end };
  }
  return start <= end ? { start, end } : { start: end, end: start };
}

function formatDisplayRange(range: DateRange): string {
  if (!range.start || !range.end) {
    return 'Select timeframe';
  }
  const start = parseISO(range.start);
  const end = parseISO(range.end);
  const startLabel = formatDate(start, DISPLAY_RANGE_FORMAT);
  const endLabel = formatDate(end, DISPLAY_RANGE_FORMAT);
  if (range.start === range.end) {
    return startLabel;
  }
  return `${startLabel} – ${endLabel}`;
}

function getPresetRange(preset: TimeframePreset): DateRange {
  const now = new Date();
  const end = formatDateInput(now);

  switch (preset) {
    case 'day': {
      const dayStart = startOfDay(now);
      const formatted = formatDateInput(dayStart);
      return { start: formatted, end: formatted };
    }
    case 'week': {
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      return { start: formatDateInput(weekStart), end };
    }
    case 'year': {
      const yearStart = startOfDay(subYears(now, 1));
      return { start: formatDateInput(yearStart), end };
    }
    case 'ytd': {
      const start = startOfYear(now);
      return { start: formatDateInput(start), end };
    }
    case 'month':
    default: {
      const start = startOfMonth(now);
      return { start: formatDateInput(start), end };
    }
  }
}

function isDateRangeValid(range: DateRange): boolean {
  return Boolean(range.start && range.end && range.start <= range.end);
}

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

function TimeframeDropdown({
  timeframe,
  rangeLabel,
  customRange,
  onPresetSelect,
  onCustomRangeSelect,
  maxDate
}: {
  timeframe: TimeframeKey;
  rangeLabel: string;
  customRange: DateRange;
  onPresetSelect: (preset: TimeframePreset) => void;
  onCustomRangeSelect: (range: DateRange) => void;
  maxDate: string;
}) {
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectionPhase, setSelectionPhase] = useState<'start' | 'end'>('start');
  const [rangeDraft, setRangeDraft] = useState<RangeDraft>({ start: null, end: null });

  const closePicker = useCallback(() => {
    setIsOpen(false);
    setSelectionPhase('start');
    setRangeDraft({ start: null, end: null });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const defaultMonth = customRange.start ? parseISO(customRange.start) : new Date();
    setVisibleMonth(startOfMonth(defaultMonth));
    setSelectionPhase('start');
    setRangeDraft({ start: null, end: null });

    const handleClickOutside = (event: MouseEvent) => {
      if (!dropdownRef.current) {
        return;
      }
      if (!dropdownRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePicker();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, customRange.start, closePicker]);

  const handlePresetClick = (preset: TimeframePreset) => {
    onPresetSelect(preset);
    closePicker();
  };

  const handleDayClick = (dateString: string) => {
    if (dateString > maxDate) {
      return;
    }

    if (selectionPhase === 'start') {
      setRangeDraft({ start: dateString, end: dateString });
      setSelectionPhase('end');
      return;
    }

    const startValue = rangeDraft.start ?? dateString;
    const sorted = normalizeRange(startValue, dateString);
    onCustomRangeSelect({ start: sorted.start ?? dateString, end: sorted.end ?? dateString });
    closePicker();
  };

  const handleDayHover = (dateString: string) => {
    if (selectionPhase === 'end' && rangeDraft.start && dateString <= maxDate) {
      setRangeDraft((prev) => ({ ...prev, end: dateString }));
    }
  };

  const displayedRange = useMemo(() => {
    if (selectionPhase === 'end' && rangeDraft.start) {
      const endValue = rangeDraft.end ?? rangeDraft.start;
      return normalizeRange(rangeDraft.start, endValue);
    }
    return normalizeRange(customRange.start, customRange.end);
  }, [selectionPhase, rangeDraft, customRange.start, customRange.end]);

  const calendarStart = useMemo(() => {
    return startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 });
  }, [visibleMonth]);

  const calendarEnd = useMemo(() => {
    return endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 });
  }, [visibleMonth]);

  const days: Date[] = [];
  for (let day = calendarStart; day <= calendarEnd; day = addDays(day, 1)) {
    days.push(day);
  }

  const maxDateLabel = formatDate(parseISO(maxDate), DISPLAY_RANGE_FORMAT);
  const selectionPrompt =
    selectionPhase === 'start'
      ? 'Choose a start date'
      : rangeDraft.start
      ? `Choose an end date (starting ${formatDate(parseISO(rangeDraft.start), DISPLAY_RANGE_FORMAT)})`
      : 'Choose an end date';

  const canGoNextMonth = formatDateInput(addMonths(visibleMonth, 1)) <= maxDate;

  return (
    <div ref={dropdownRef} className="relative flex flex-col items-end gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Timeframe</span>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
      >
        <span>{rangeLabel}</span>
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              ‹
            </button>
            <div className="text-sm font-semibold text-slate-700">{formatDate(visibleMonth, 'MMMM yyyy')}</div>
            <button
              type="button"
              onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
              disabled={!canGoNextMonth}
              className={`rounded border px-2 py-1 text-xs transition ${
                canGoNextMonth
                  ? 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                  : 'cursor-not-allowed border-slate-100 text-slate-300'
              }`}
            >
              ›
            </button>
          </div>

          <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">{selectionPrompt}</div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {days.map((day) => {
              const dateKey = formatDateInput(day);
              const isCurrentMonth = day.getMonth() === visibleMonth.getMonth();
              const isDisabled = dateKey > maxDate;
              const inRange =
                displayedRange.start && displayedRange.end
                  ? dateKey >= displayedRange.start && dateKey <= displayedRange.end
                  : false;
              const isStart = displayedRange.start ? dateKey === displayedRange.start : false;
              const isEnd = displayedRange.end ? dateKey === displayedRange.end : false;

              const baseClasses = 'flex h-9 w-9 items-center justify-center rounded-full text-sm transition';
              let className = `${baseClasses} `;

              if (isDisabled) {
                className += 'cursor-not-allowed text-slate-300';
              } else if (!isCurrentMonth) {
                className += 'text-slate-300 hover:bg-slate-100 hover:text-slate-600';
              } else if (isStart || isEnd) {
                className += 'bg-slate-900 text-white';
              } else if (inRange) {
                className += 'bg-slate-200 text-slate-700';
              } else {
                className += 'text-slate-700 hover:bg-slate-100 hover:text-slate-900';
              }

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => handleDayClick(dateKey)}
                  onMouseEnter={() => handleDayHover(dateKey)}
                  disabled={isDisabled}
                  className={className}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>Latest selectable date: {maxDateLabel}</span>
            <button
              type="button"
              onClick={() => {
                setSelectionPhase('start');
                setRangeDraft({ start: null, end: null });
              }}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              Reset selection
            </button>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Quick links</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIMEFRAME_PRESETS.map((option) => {
                const isActive = timeframe === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handlePresetClick(option.value)}
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
        </div>
      ) : null}
    </div>
  );
}

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
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-4 space-y-3">
        {items.length ? (
          items.slice(0, 8).map((item) => (
            <li key={item.label} className="flex items-center justify-between text-sm text-slate-700">
              <span className="font-medium text-slate-900">{item.label}</span>
              <span>{formatValue(item.value)}</span>
            </li>
          ))
        ) : (
          <li className="text-sm text-slate-500">{emptyMessage}</li>
        )}
      </ul>
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
  const [deletingMonth, setDeletingMonth] = useState<string | null>(null);

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

  const handleDelete = async (monthKey: string) => {
    if (!canEdit) return;
    setDeletingMonth(monthKey);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/dashboard/pre-approvals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: monthKey })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Unable to delete pre-approval entry.');
      }

      setStatus('idle');
      setSelectedMonth('');
      setInputValue('');
      onSaved();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to delete pre-approval entry.');
      setStatus('error');
    } finally {
      setDeletingMonth(null);
    }
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
                {canEdit ? <th className="px-3 py-2 font-medium text-right">Actions</th> : null}
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
                    {canEdit ? (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.monthKey)}
                          className="inline-flex items-center justify-center rounded p-1 text-slate-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={deletingMonth === entry.monthKey}
                          aria-label={`Delete ${entry.label} pre-approval entry`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-3 py-6 text-center text-sm text-slate-500">
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
    { label: 'AHA attach rate', value: `${summary.ahaAttachRate.toFixed(1)}%` },
    { label: 'AHA OOS attach rate', value: `${summary.ahaOosAttachRate.toFixed(1)}%` },
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

      <div className="grid gap-4 lg:grid-cols-4">
        <RankedList title="Revenue by source" items={data.revenueBySource} />
        <RankedList title="Revenue by endorser" items={data.revenueByEndorser} />
        <RankedList title="Revenue by state" items={data.revenueByState} />
        <RankedList
          title="Referral requests by ZIP"
          items={data.referralRequestsByZip}
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
    </div>
  );
}

function McDashboard({ data }: { data: DashboardResponse['mc'] }) {
  const [requestFilter, setRequestFilter] = useState<'all' | 'AHA' | 'AHA_OOS'>('all');

  const filterOptions: { label: string; value: 'all' | 'AHA' | 'AHA_OOS' }[] = [
    { label: 'All', value: 'all' },
    { label: 'AHA', value: 'AHA' },
    { label: 'AHA OOS', value: 'AHA_OOS' }
  ];

  const selectedTrend = useMemo(() => {
    if (requestFilter === 'AHA') return data.requestTrend.aha;
    if (requestFilter === 'AHA_OOS') return data.requestTrend.ahaOos;
    return data.requestTrend.all;
  }, [data.requestTrend, requestFilter]);

  const selectedLeaderboard = useMemo(() => {
    if (requestFilter === 'AHA') return data.requestLeaderboard.aha;
    if (requestFilter === 'AHA_OOS') return data.requestLeaderboard.ahaOos;
    return data.requestLeaderboard.all;
  }, [data.requestLeaderboard, requestFilter]);

  const filterLabel = filterOptions.find((option) => option.value === requestFilter)?.label ?? 'All';

  const renderFilterButtons = () => (
    <div className="flex gap-1">
      {filterOptions.map((option) => {
        const isActive = requestFilter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setRequestFilter(option.value)}
            className={`rounded border px-2 py-1 text-xs font-medium transition ${
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

  return (
    <div className="space-y-6">
      <LineChartCard
        title="Requests received"
        data={selectedTrend}
        formatValue={(value) => formatNumber(Math.round(value))}
        helper={`Trend of referral requests routed to MCs (${filterLabel})`}
        actions={renderFilterButtons()}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable
          title="Referral requests by MC"
          entries={selectedLeaderboard}
          valueLabel="Requests"
          actions={renderFilterButtons()}
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

  return (
    <div className="space-y-6">
      <SummaryCard title="Average agent commission" value={averageCommissionDisplay} helper={commissionHelper} />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Referrals by agent" entries={data.referralLeaderboard} valueLabel="Referrals" />
        <LeaderboardTable title="Close rate by agent" entries={data.closeRateLeaderboard} valueLabel="Close rate" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Revenue paid by agent" entries={data.revenuePaid} valueLabel="Revenue" />
        <LeaderboardTable title="Revenue expected by agent" entries={data.revenueExpected} valueLabel="Expected" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable title="Agent net earnings" entries={data.netRevenue} valueLabel="Net revenue" />
        <LeaderboardTable title="Deals lost to outside agents" entries={data.lostDeals} valueLabel="Lost deals" />
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
        </div>
      ) : null}
    </div>
  );
}
