'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Calendar, X } from 'lucide-react';

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
  const [selectedDate, setSelectedDate] = useState('');

  const params = new URLSearchParams({ groupBy, view });
  if (selectedDate) {
    params.set('dueDate', selectedDate);
  }

  const boardUrl = `/api/admin/tasks/board?${params.toString()}`;
  const { data, mutate } = useSWR<ReferralTaskCardData[] | AgentGroup[]>(boardUrl, fetcher);

  const isGroupedMode = groupBy === 'agent' || groupBy === 'similar';
  const referralCards: ReferralTaskCardData[] =
    isGroupedMode
      ? (data as AgentGroup[] | undefined)?.flatMap((g) => g.referralCards ?? []) ?? []
      : (data as ReferralTaskCardData[] | undefined) ?? [];

  const groupedSections = isGroupedMode ? (data as AgentGroup[] | undefined) ?? [] : [];

  const formattedSelectedDate = selectedDate
    ? new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(`${selectedDate}T00:00:00`))
    : null;
  const emptyLabel = selectedDate
    ? `No tasks due on ${formattedSelectedDate}`
    : view === 'upcoming'
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
                ? 'bg-primary-600 text-white'
                : 'border border-border text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Urgent
          </button>
          <button
            type="button"
            onClick={() => setView('upcoming')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              view === 'upcoming'
                ? 'bg-primary-600 text-white'
                : 'border border-border text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Upcoming
          </button>
        </div>

        <div className="h-6 w-px bg-surface-subtle" />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGroupBy('due')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              groupBy === 'due'
                ? 'bg-primary-600 text-white'
                : 'border border-border text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Group by due date
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('agent')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              groupBy === 'agent'
                ? 'bg-primary-600 text-white'
                : 'border border-border text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Group by agent
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('similar')}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              groupBy === 'similar'
                ? 'bg-primary-600 text-white'
                : 'border border-border text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Group by similar task
          </button>
        </div>

        <div className="h-6 w-px bg-surface-subtle" />

        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground-muted">
            <Calendar className="h-4 w-4" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm text-foreground-muted outline-none"
              aria-label="Filter tasks by due date"
            />
          </label>
          {selectedDate && (
            <button
              type="button"
              onClick={() => setSelectedDate('')}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground-muted transition hover:bg-surface-subtle"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {groupBy === 'due' ? (
        referralCards.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-raised p-8 text-center text-sm text-foreground-subtle">
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
        <div className="rounded-lg border border-border bg-surface-raised p-8 text-center text-sm text-foreground-subtle">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-6">
          {groupedSections.map((group) => (
            <section
              key={group.groupKey}
              className="rounded-card border border-border bg-surface-raised p-4 shadow-card"
            >
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
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
