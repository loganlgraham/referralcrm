'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';

type Timeframe = 'day' | 'week' | 'month' | 'ytd';

interface TransferEntry {
  id: string;
  name: string;
  transfers: number;
}

interface AgentClosingEntry {
  id: string;
  name: string;
  closings: number;
  expectedRevenueCents: number;
  paidRevenueCents: number;
}

interface AgentRateEntry {
  id: string;
  name: string;
  closeRate: number;
  closings: number;
  totalReferrals: number;
}

interface LeaderboardsResponse {
  mcTransfers: Record<Timeframe, TransferEntry[]>;
  agentClosings: Record<Timeframe, AgentClosingEntry[]>;
  agentCloseRate: Record<Timeframe, AgentRateEntry[]>;
}

const TIMEFRAME_OPTIONS: { label: string; value: Timeframe }[] = [
  { label: 'Today', value: 'day' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'Year to Date', value: 'ytd' }
];

function LoadingLeaderboard() {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm animate-pulse">
      <div className="h-4 w-32 rounded bg-slate-200" />
      <ul className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-24 rounded bg-slate-200" />
              <div className="h-3 w-32 rounded bg-slate-200" />
            </div>
            <div className="h-3 w-16 rounded bg-slate-200" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LeaderboardCard({
  title,
  subtitle,
  emptyText,
  children
}: {
  title: string;
  subtitle?: string;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-4">
        {children || (
          <p className="text-xs text-slate-500">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

export function Leaderboards() {
  const [isMounted, setIsMounted] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('month');
  const { data, error } = useSWR<LeaderboardsResponse>('/api/referrals?leaderboard=true', fetcher, {
    refreshInterval: 60_000
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-800">
        Failed to load leaderboard data. Please try again later.
      </div>
    );
  }

  if (!isMounted || !data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Team leaderboards</h2>
            <p className="text-sm text-slate-500">Comparisons update automatically as deals close.</p>
          </div>
          <div className="flex gap-2">
            {TIMEFRAME_OPTIONS.map((option) => (
              <span key={option.value} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-400">
                {option.label}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <LoadingLeaderboard />
          <LoadingLeaderboard />
          <LoadingLeaderboard />
        </div>
      </div>
    );
  }

  const mcEntries = data.mcTransfers[timeframe] ?? [];
  const closingEntries = data.agentClosings[timeframe] ?? [];
  const rateEntries = data.agentCloseRate[timeframe] ?? [];

  const timeframeLabel = useMemo(
    () => TIMEFRAME_OPTIONS.find((option) => option.value === timeframe)?.label ?? 'This Month',
    [timeframe]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Team leaderboards</h2>
          <p className="text-sm text-slate-500">{timeframeLabel} snapshot</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TIMEFRAME_OPTIONS.map((option) => {
            const isActive = option.value === timeframe;
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

      <div className="grid gap-4 lg:grid-cols-3">
        <LeaderboardCard
          title="Top transferring MCs"
          subtitle={`${mcEntries.length} leaders`}
          emptyText="No mortgage consultant transfers in this timeframe yet."
        >
          {mcEntries.length ? (
            <ul className="space-y-3">
              {mcEntries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{entry.name}</p>
                    <p className="text-xs text-slate-500">{formatNumber(entry.transfers)} transfers</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </LeaderboardCard>

        <LeaderboardCard
          title="Top agents by closings"
          subtitle={`${closingEntries.length} leaders`}
          emptyText="No agent closings recorded in this timeframe."
        >
          {closingEntries.length ? (
            <ul className="space-y-3">
              {closingEntries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{entry.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatNumber(entry.closings)} closings · {formatCurrency(entry.expectedRevenueCents)} expected
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-brand">
                    {formatCurrency(entry.paidRevenueCents)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </LeaderboardCard>

        <LeaderboardCard
          title="Top agents by close rate"
          subtitle={`${rateEntries.length} leaders`}
          emptyText="No referral activity in this timeframe to calculate close rates."
        >
          {rateEntries.length ? (
            <ul className="space-y-3">
              {rateEntries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{entry.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatNumber(entry.closings)} closings · {formatNumber(entry.totalReferrals)} referrals
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600">{entry.closeRate.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          ) : null}
        </LeaderboardCard>
      </div>
    </div>
  );
}
