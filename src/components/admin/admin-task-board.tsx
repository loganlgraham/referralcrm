'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { ReferralTaskCard } from './referral-task-card';
import type { ReferralTaskCard as ReferralTaskCardData } from '@/app/api/admin/tasks/board/route';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AgentGroup {
  groupKey: string;
  groupLabel: string;
  referralCards: ReferralTaskCardData[];
}

export function AdminTaskBoard() {
  const [groupBy, setGroupBy] = useState<'due' | 'agent'>('due');

  const boardUrl = `/api/admin/tasks/board?groupBy=${groupBy}`;
  const { data, mutate } = useSWR<ReferralTaskCardData[] | AgentGroup[]>(boardUrl, fetcher);

  const referralCards: ReferralTaskCardData[] =
    groupBy === 'agent'
      ? (data as AgentGroup[] | undefined)?.flatMap((g) => g.referralCards ?? []) ?? []
      : (data as ReferralTaskCardData[] | undefined) ?? [];

  const agentGroups = groupBy === 'agent' ? (data as AgentGroup[] | undefined) ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setGroupBy('due')}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
            groupBy === 'due'
              ? 'bg-brand text-white'
              : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Group by due date
        </button>
        <button
          type="button"
          onClick={() => setGroupBy('agent')}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
            groupBy === 'agent'
              ? 'bg-brand text-white'
              : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Group by agent
        </button>
      </div>

      {groupBy === 'due' ? (
        referralCards.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No referrals with urgent tasks
          </div>
        ) : (
          <div className="space-y-4">
            {referralCards.map((card) => (
              <ReferralTaskCard key={card.referralId} card={card} onMutate={() => void mutate()} />
            ))}
          </div>
        )
      ) : agentGroups.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No referrals with urgent tasks
        </div>
      ) : (
        <div className="space-y-6">
          {agentGroups.map((group) => (
            <section
              key={group.groupKey}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
                {group.groupLabel}
              </h2>
              <div className="space-y-4">
                {group.referralCards.map((card) => (
                  <ReferralTaskCard key={card.referralId} card={card} onMutate={() => void mutate()} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
