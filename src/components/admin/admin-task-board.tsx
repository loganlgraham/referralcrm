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

type GroupByMode = 'due' | 'agent' | 'similar';
type ViewMode = 'urgent' | 'upcoming';

export function AdminTaskBoard() {
  const [groupBy, setGroupBy] = useState<GroupByMode>('due');
  const [view, setView] = useState<ViewMode>('urgent');

  const boardUrl = `/api/admin/tasks/board?groupBy=${groupBy}&view=${view}`;
  const { data, mutate } = useSWR<ReferralTaskCardData[] | AgentGroup[]>(boardUrl, fetcher);

  const isGroupedMode = groupBy === 'agent' || groupBy === 'similar';
  const referralCards: ReferralTaskCardData[] =
    isGroupedMode
      ? (data as AgentGroup[] | undefined)?.flatMap((g) => g.referralCards ?? []) ?? []
      : (data as ReferralTaskCardData[] | undefined) ?? [];

  const groupedSections = isGroupedMode ? (data as AgentGroup[] | undefined) ?? [] : [];

  const emptyLabel = view === 'upcoming'
    ? 'No referrals with upcoming tasks'
    : 'No referrals with urgent tasks';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('urgent')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              view === 'urgent'
                ? 'bg-brand text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            Urgent
          </button>
          <button
            type="button"
            onClick={() => setView('upcoming')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              view === 'upcoming'
                ? 'bg-brand text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            Upcoming
          </button>
        </div>

        <div className="h-6 w-px bg-slate-200" />

        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => setGroupBy('similar')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              groupBy === 'similar'
                ? 'bg-brand text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            Group by similar task
          </button>
        </div>
      </div>

      {groupBy === 'due' ? (
        referralCards.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {emptyLabel}
          </div>
        ) : (
          <div className="space-y-4">
            {referralCards.map((card) => (
              <ReferralTaskCard key={card.referralId} card={card} view={view} onMutate={() => void mutate()} />
            ))}
          </div>
        )
      ) : groupedSections.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-6">
          {groupedSections.map((group) => (
            <section
              key={group.groupKey}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
                {group.groupLabel}
              </h2>
              <div className="space-y-4">
                {group.referralCards.map((card) => (
                  <ReferralTaskCard key={card.referralId} card={card} view={view} onMutate={() => void mutate()} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
