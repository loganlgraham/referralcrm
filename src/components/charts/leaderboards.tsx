'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency } from '@/utils/formatters';
import {
  SAMPLE_LEADERBOARDS,
  SampleLeaderboardEntry,
  SampleLeaderboards
} from '@/data/dashboard-sample';

function Leaderboard({ title, entries }: { title: string; entries: SampleLeaderboardEntry[] }) {
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

function hasLeaderboardEntries(data: SampleLeaderboards | undefined) {
  if (!data) {
    return false;
  }

  return ['mc', 'agents', 'markets'].some((key) => data[key as keyof SampleLeaderboards]?.length);
}

export function Leaderboards() {
  const [displayData, setDisplayData] = useState<SampleLeaderboards>(SAMPLE_LEADERBOARDS);
  const [usingSample, setUsingSample] = useState(true);
  const { data, error } = useSWR<SampleLeaderboards>('/api/referrals?leaderboard=true', fetcher);

  useEffect(() => {
    if (hasLeaderboardEntries(data)) {
      setDisplayData(data as SampleLeaderboards);
      setUsingSample(false);
    } else {
      setUsingSample(true);
    }
  }, [data]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Leaderboard title="Top Mortgage Companies" entries={displayData.mc} />
      <Leaderboard title="Top Agents" entries={displayData.agents} />
      <Leaderboard title="Top Markets" entries={displayData.markets} />
      {(error || usingSample) && (
        <div className="md:col-span-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
          Showing sample leaderboards because live data is {error ? 'unavailable' : 'not ready yet'}.
        </div>
      )}
    </div>
  );
}
