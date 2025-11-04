'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency } from '@/utils/formatters';

interface LeaderboardEntry {
  name: string;
  totalReferrals: number;
  closings: number;
  expectedRevenueCents: number;
}

interface LeaderboardsResponse {
  mc: LeaderboardEntry[];
  agents: LeaderboardEntry[];
  markets: LeaderboardEntry[];
}

function Leaderboard({ title, entries }: { title: string; entries: LeaderboardEntry[] }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
      <ul className="mt-4 space-y-3">
        {entries.map((entry) => (
          <li key={entry.name} className="flex items-center justify-between text-sm">
            <div>
              <p className="font-medium text-slate-900">{entry.name}</p>
              <p className="text-xs text-slate-500">
                {entry.totalReferrals} requests • {entry.closings} closings
              </p>
            </div>
            <span className="text-xs font-semibold text-brand">
              {formatCurrency(entry.expectedRevenueCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoadingLeaderboard() {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm animate-pulse">
      <div className="h-4 bg-slate-200 rounded w-32" />
      <ul className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 bg-slate-200 rounded w-24" />
              <div className="h-3 bg-slate-200 rounded w-36" />
            </div>
            <div className="h-3 bg-slate-200 rounded w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Leaderboards() {
  const [isMounted, setIsMounted] = useState(false);
  const { data, error } = useSWR<LeaderboardsResponse>('/api/referrals?leaderboard=true', fetcher);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <LoadingLeaderboard />
        <LoadingLeaderboard />
        <LoadingLeaderboard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-800">
        Failed to load leaderboard data. Please try again later.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Leaderboard title="Top Mortgage Companies" entries={data.mc} />
      <Leaderboard title="Top Agents" entries={data.agents} />
      <Leaderboard title="Top Markets" entries={data.markets} />
    </div>
  );
}
