'use client';

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

export function Leaderboards() {
  const { data } = useSWR<LeaderboardsResponse>('/api/referrals?leaderboard=true', fetcher, {
    suspense: true
  });

  if (!data) return null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Leaderboard title="By MC" entries={data.mc} />
      <Leaderboard title="By Agent" entries={data.agents} />
      <Leaderboard title="By Market" entries={data.markets} />
    </div>
  );
}
