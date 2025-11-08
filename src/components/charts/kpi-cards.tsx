'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';

type Role = 'admin' | 'manager' | 'mc' | 'agent' | 'viewer' | undefined;

type MetricKey =
  | 'revenueReceivedCents'
  | 'dealsClosed'
  | 'closeRate'
  | 'mcTransfers';

interface MonthlyPoint {
  monthKey: string;
  label: string;
  revenueReceivedCents: number;
  dealsClosed: number;
  closeRate: number;
  mcTransfers: number;
}

interface KPIResponse {
  role?: Role;
  totalReferrals: number;
  closedReferrals: number;
  closeRate: number;
  expectedRevenueCents: number;
  revenueReceivedCents: number;
  earnedCommissionCents: number;
  monthly: MonthlyPoint[];
}

const METRIC_CONFIG: Record<MetricKey, {
  label: string;
  color: string;
  accessor: (point: MonthlyPoint) => number;
  tooltip: (point: MonthlyPoint) => string;
}> = {
  revenueReceivedCents: {
    label: 'Revenue Received',
    color: '#0ea5e9',
    accessor: (point) => (point.revenueReceivedCents || 0) / 100,
    tooltip: (point) => formatCurrency(point.revenueReceivedCents)
  },
  dealsClosed: {
    label: 'Deals Closed',
    color: '#10b981',
    accessor: (point) => point.dealsClosed || 0,
    tooltip: (point) => formatNumber(point.dealsClosed)
  },
  closeRate: {
    label: 'Close Rate',
    color: '#6366f1',
    accessor: (point) => point.closeRate || 0,
    tooltip: (point) => `${(point.closeRate || 0).toFixed(1)}%`
  },
  mcTransfers: {
    label: 'MC Transfers',
    color: '#f97316',
    accessor: (point) => point.mcTransfers || 0,
    tooltip: (point) => formatNumber(point.mcTransfers)
  }
};

const METRIC_KEYS = Object.keys(METRIC_CONFIG) as MetricKey[];

const CHART_WIDTH = 840;
const CHART_HEIGHT = 280;
const CHART_PADDING_X = 56;
const CHART_PADDING_Y = 40;

function LoadingCard() {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm animate-pulse">
      <div className="h-4 w-24 rounded bg-slate-200" />
      <div className="mt-2 h-8 w-32 rounded bg-slate-200" />
    </div>
  );
}

function MetricTrendChart({ data }: { data: MonthlyPoint[] }) {
  const [highlighted, setHighlighted] = useState<MetricKey[]>(METRIC_KEYS);
  const [hoverIndex, setHoverIndex] = useState<number | null>(data.length > 0 ? data.length - 1 : null);

  const activeHighlights = highlighted.length > 0 ? highlighted : METRIC_KEYS;
  const highlightSet = new Set(activeHighlights);

  useEffect(() => {
    if (data.length > 0) {
      setHoverIndex(data.length - 1);
    } else {
      setHoverIndex(null);
    }
  }, [data]);

  const stepX = data.length > 1
    ? (CHART_WIDTH - CHART_PADDING_X * 2) / (data.length - 1)
    : 0;
  const fallbackHoverWidth = stepX || 48;

  const activeScaleKeys = highlighted.length > 0 ? highlighted : METRIC_KEYS;

  const maxValue = useMemo(() => {
    return activeScaleKeys.reduce((max, key) => {
      const seriesMax = Math.max(
        0,
        ...data.map((point) => METRIC_CONFIG[key].accessor(point))
      );
      return Math.max(max, seriesMax);
    }, 0);
  }, [activeScaleKeys, data]);

  const safeMax = maxValue === 0 ? 1 : maxValue;

  const getPoint = (index: number, key: MetricKey) => {
    const value = METRIC_CONFIG[key].accessor(data[index]);
    const ratio = Math.min(value / safeMax, 1);
    const x = CHART_PADDING_X + stepX * index;
    const y = CHART_PADDING_Y + (CHART_HEIGHT - CHART_PADDING_Y * 2) * (1 - ratio);
    return { x, y };
  };

  const paths = useMemo(() => {
    const result: Record<MetricKey, string> = {
      revenueReceivedCents: '',
      dealsClosed: '',
      closeRate: '',
      mcTransfers: ''
    };

    METRIC_KEYS.forEach((key) => {
      if (data.length === 0) {
        result[key] = '';
        return;
      }

      const segments = data.map((_, index) => {
        const { x, y } = getPoint(index, key);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      });

      result[key] = segments.join(' ');
    });

    return result;
  }, [data, safeMax, stepX]);

  const labelInterval = data.length > 6 ? Math.ceil(data.length / 6) : 1;

  const toggleMetric = (key: MetricKey) => {
    setHighlighted((current) => {
      const exists = current.includes(key);
      if (exists) {
        return current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  };

  const hoveredPoint = hoverIndex != null ? data[hoverIndex] : null;

  const getXPosition = (index: number) => CHART_PADDING_X + stepX * index;

  const tooltipStyle = hoveredPoint && hoverIndex != null
    ? {
        left: `${Math.min(
          Math.max(getXPosition(hoverIndex) - 90, chartDimensions.paddingX),
          chartDimensions.width - chartDimensions.paddingX - 180
        )}px`
      }
    : undefined;

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-600">Performance trends</h3>
          <p className="text-xs text-slate-500">Trailing 12 months</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {METRIC_KEYS.map((key) => {
            const isActive = highlightSet.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleMetric(key)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? 'border-transparent bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: METRIC_CONFIG[key].color }}
                />
                {METRIC_CONFIG[key].label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative mt-6">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label="Performance trends over the last 12 months"
          className="w-full"
        >
          <line
            x1={CHART_PADDING_X}
            x2={CHART_WIDTH - CHART_PADDING_X}
            y1={CHART_HEIGHT - CHART_PADDING_Y}
            y2={CHART_HEIGHT - CHART_PADDING_Y}
            className="stroke-slate-200"
          />
          {data.map((point, index) => {
            const x = getXPosition(index);
            const showLabel = index % labelInterval === 0 || index === data.length - 1;
            return (
              <g key={point.monthKey}>
                <line
                  x1={x}
                  x2={x}
                  y1={CHART_PADDING_Y}
                  y2={CHART_HEIGHT - CHART_PADDING_Y}
                  className="stroke-slate-100"
                />
                {showLabel && (
                  <text
                    x={x}
                    y={CHART_HEIGHT - CHART_PADDING_Y + 20}
                    className="fill-slate-500 text-[10px]"
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
          {METRIC_KEYS.map((key) => (
            <path
              key={key}
              d={paths[key]}
              fill="none"
              stroke={METRIC_CONFIG[key].color}
              strokeWidth={highlightSet.has(key) ? 2.5 : 1.5}
              opacity={highlightSet.has(key) ? 1 : 0.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {data.map((point, index) => {
            const isHovered = hoverIndex === index;
            const x = getXPosition(index);
            return (
              <g key={`${point.monthKey}-hit`}>
                <rect
                  x={x - (data.length === 1 ? fallbackHoverWidth / 2 : stepX / 2)}
                  y={CHART_PADDING_Y}
                  width={data.length === 1 ? fallbackHoverWidth : index === 0 ? stepX / 2 : stepX}
                  height={CHART_HEIGHT - CHART_PADDING_Y * 2}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
                {isHovered && (
                  <line
                    x1={x}
                    x2={x}
                    y1={CHART_PADDING_Y - 6}
                    y2={CHART_HEIGHT - CHART_PADDING_Y + 6}
                    className="stroke-slate-300"
                    strokeDasharray="4 2"
                  />
                )}
                {METRIC_KEYS.map((key) => {
                  if (!paths[key]) return null;
                  const { x: pointX, y: pointY } = getPoint(index, key);
                  return (
                    <circle
                      key={`${key}-${point.monthKey}`}
                      cx={pointX}
                      cy={pointY}
                      r={highlightSet.has(key) && hoverIndex === index ? 4 : 3}
                      fill={METRIC_CONFIG[key].color}
                      opacity={highlightSet.has(key) ? (hoverIndex === index ? 1 : 0.8) : 0.2}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        {hoveredPoint && hoverIndex != null && (
          <div
            className="pointer-events-none absolute top-6 w-48 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg"
            style={tooltipStyle}
          >
            <p className="text-[11px] font-semibold text-slate-600">{hoveredPoint.label}</p>
            <ul className="mt-2 space-y-1">
              {METRIC_KEYS.map((key) => (
                <li key={`tooltip-${key}`} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-slate-500">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: METRIC_CONFIG[key].color, opacity: highlightSet.has(key) ? 1 : 0.3 }}
                    />
                    {METRIC_CONFIG[key].label}
                  </span>
                  <span className="font-semibold text-slate-900">{METRIC_CONFIG[key].tooltip(hoveredPoint)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function KPICards() {
  const [isMounted, setIsMounted] = useState(false);
  const { data, error } = useSWR<KPIResponse>('/api/referrals?summary=true', fetcher, {
    refreshInterval: 60_000
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-800">
        Failed to load KPI data. Please try again later.
      </div>
    );
  }

  if (!isMounted || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <LoadingCard key={index} />
        ))}
      </div>
    );
  }

  const role = data.role;

  const baseCards = [
    { title: 'Total Referrals', value: formatNumber(data.totalReferrals) },
    { title: 'Deals Closed', value: formatNumber(data.closedReferrals) },
    { title: 'Close Rate', value: `${data.closeRate.toFixed(1)}%` }
  ];

  const roleSpecificCards = (() => {
    switch (role) {
      case 'agent':
        return [
          { title: 'Revenue Received', value: formatCurrency(data.revenueReceivedCents) },
          { title: 'Commission Earned', value: formatCurrency(data.earnedCommissionCents) }
        ];
      case 'mc':
        return [
          { title: 'Expected Revenue', value: formatCurrency(data.expectedRevenueCents) },
          { title: 'Revenue Received', value: formatCurrency(data.revenueReceivedCents) }
        ];
      default:
        return [
          { title: 'Expected Revenue', value: formatCurrency(data.expectedRevenueCents) },
          { title: 'Revenue Received', value: formatCurrency(data.revenueReceivedCents) }
        ];
    }
  })();

  const cards = [...baseCards, ...roleSpecificCards];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-500">{card.title}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>
      {data.monthly?.length ? <MetricTrendChart data={data.monthly} /> : null}
    </div>
  );
}
