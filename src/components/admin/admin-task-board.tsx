'use client';

import { useCallback, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { AlarmClockOff, CalendarClock, CalendarDays, ClipboardList, Inbox, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { parseTaskNetwork, taskNetworkLabel, type TaskNetworkParam } from '@/lib/task-network';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Toolbar, ToolbarGroup, ToolbarSpacer } from '@/components/ui/toolbar';
import { ReferralTaskCard } from './referral-task-card';
import { NoOpenTaskReferrals } from './no-open-task-referrals';
import type { ReferralTaskCard as ReferralTaskCardData } from '@/app/api/admin/tasks/board/route';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AgentGroup {
  groupKey: string;
  groupLabel: string;
  referralCards: ReferralTaskCardData[];
}

type GroupByMode = 'due' | 'agent' | 'similar' | 'stage';
type ViewMode = 'urgent' | 'upcoming' | 'no-tasks';
type NoOpenTaskGroupBy = 'agent' | 'similar' | 'stage';

interface TaskSummaryCounts {
  overdueCount: number;
  dueTodayCount: number;
  noOpenTaskCount: number;
}

const NETWORK_FILTERS: { id: TaskNetworkParam; label: string; ariaLabel?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'aha', label: 'AHA' },
  { id: 'oos', label: 'OOS', ariaLabel: 'AHA OOS' },
  { id: 'agit', label: 'AGIT' },
];

const DEFAULT_VIEW: ViewMode = 'urgent';
const DEFAULT_GROUP_BY: GroupByMode = 'due';

function parseView(value: string | null): ViewMode {
  return value === 'upcoming' || value === 'no-tasks' ? value : DEFAULT_VIEW;
}

function parseGroupBy(value: string | null): GroupByMode {
  return value === 'agent' || value === 'similar' || value === 'stage' ? value : DEFAULT_GROUP_BY;
}

interface AdminTaskBoardProps {
  overdueCount: number;
  dueTodayCount: number;
  noOpenTaskCount: number;
}

export function AdminTaskBoard({ overdueCount, dueTodayCount, noOpenTaskCount }: AdminTaskBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = parseView(searchParams.get('view'));
  const groupBy = parseGroupBy(searchParams.get('groupBy'));
  const network = parseTaskNetwork(searchParams.get('network'));
  const selectedDate = searchParams.get('dueDate') ?? '';

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router]
  );

  const setView = (next: ViewMode) =>
    updateParams({
      view: next === DEFAULT_VIEW ? null : next,
      // Task-board-only filters don't apply to the no-open-tasks list.
      ...(next === 'no-tasks' ? { dueDate: null } : {}),
    });
  const setGroupBy = (next: GroupByMode) => {
    if (view === 'no-tasks' && next !== 'due' && groupBy === next) {
      updateParams({ groupBy: null });
      return;
    }
    updateParams({ groupBy: next === DEFAULT_GROUP_BY ? null : next });
  };
  const setNetwork = (next: TaskNetworkParam) =>
    updateParams({ network: next === 'all' ? null : next });
  const setSelectedDate = (next: string) => updateParams({ dueDate: next || null });

  const isBoardView = view === 'urgent' || view === 'upcoming';

  const params = new URLSearchParams({ groupBy, view });
  if (selectedDate) {
    params.set('dueDate', selectedDate);
  }
  if (network !== 'all') {
    params.set('network', network);
  }
  const boardUrl = isBoardView ? `/api/admin/tasks/board?${params.toString()}` : null;
  const { data, mutate } = useSWR<ReferralTaskCardData[] | AgentGroup[]>(boardUrl, fetcher);

  const summaryUrl = network === 'all' ? '/api/admin/tasks/summary' : `/api/admin/tasks/summary?network=${network}`;
  const initialCounts: TaskSummaryCounts = { overdueCount, dueTodayCount, noOpenTaskCount };
  const { data: summary, mutate: mutateSummary } = useSWR<TaskSummaryCounts>(summaryUrl, fetcher, {
    fallbackData: network === 'all' ? initialCounts : undefined,
    keepPreviousData: true,
  });
  const liveOverdueCount = summary?.overdueCount ?? null;
  const liveDueTodayCount = summary?.dueTodayCount ?? null;
  const liveNoOpenTaskCount = summary?.noOpenTaskCount ?? null;

  const isGroupedMode = groupBy === 'agent' || groupBy === 'similar' || groupBy === 'stage';
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
  const networkName = network === 'all' ? null : taskNetworkLabel(network);
  const emptyDescription = networkName
    ? 'Switch network to All, or clear the date filter, to see more tasks.'
    : 'Adjust the view or clear the date filter to see more tasks.';
  const emptyLabel = selectedDate
    ? networkName
      ? `No tasks due on ${formattedSelectedDate} for ${networkName}`
      : `No tasks due on ${formattedSelectedDate}`
    : view === 'upcoming'
      ? networkName
        ? `No upcoming tasks for ${networkName}`
        : 'No referrals with upcoming tasks'
      : networkName
        ? `No urgent tasks for ${networkName}`
        : 'No referrals with urgent tasks';

  const urgentTotal = liveOverdueCount === null || liveDueTodayCount === null
    ? null
    : liveOverdueCount + liveDueTodayCount;
  const noOpenGroupBy: NoOpenTaskGroupBy | null =
    groupBy === 'agent' || groupBy === 'similar' || groupBy === 'stage' ? groupBy : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatButton
          label="Overdue"
          value={liveOverdueCount}
          hint="Open tasks past their due date"
          icon={<AlarmClockOff className="h-4 w-4" />}
          tone={liveOverdueCount !== null && liveOverdueCount > 0 ? 'danger' : 'default'}
          active={view === 'urgent'}
          onClick={() => setView('urgent')}
        />
        <StatButton
          label="Due today"
          value={liveDueTodayCount}
          hint="Open tasks due before end of day"
          icon={<CalendarClock className="h-4 w-4" />}
          tone={liveDueTodayCount !== null && liveDueTodayCount > 0 ? 'warning' : 'default'}
          active={view === 'urgent'}
          onClick={() => setView('urgent')}
        />
        <StatButton
          label="No open tasks"
          value={liveNoOpenTaskCount}
          hint="Active referrals without a follow-up"
          icon={<ClipboardList className="h-4 w-4" />}
          tone="default"
          active={view === 'no-tasks'}
          onClick={() => setView('no-tasks')}
        />
      </div>

      <Toolbar aria-label="Task filters">
        <ToolbarGroup
          role="group"
          aria-label="View"
          className="gap-0.5 rounded-lg bg-surface-muted p-0.5"
        >
          <SegmentedButton active={view === 'urgent'} onClick={() => setView('urgent')}>
            Urgent
            {urgentTotal !== null && urgentTotal > 0 && (
              <Badge size="sm" variant={liveOverdueCount !== null && liveOverdueCount > 0 ? 'danger' : 'warning'}>
                {urgentTotal}
              </Badge>
            )}
          </SegmentedButton>
          <SegmentedButton active={view === 'upcoming'} onClick={() => setView('upcoming')}>
            Upcoming
          </SegmentedButton>
          <SegmentedButton active={view === 'no-tasks'} onClick={() => setView('no-tasks')}>
            No open tasks
            {liveNoOpenTaskCount !== null && liveNoOpenTaskCount > 0 && (
              <Badge size="sm" variant="neutral">
                {liveNoOpenTaskCount}
              </Badge>
            )}
          </SegmentedButton>
        </ToolbarGroup>

        <Separator orientation="vertical" className="h-6" />

        <ToolbarGroup role="group" aria-label="Network">
          <span className="text-eyebrow text-foreground-subtle">Network</span>
          <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
            {NETWORK_FILTERS.map((option) => (
              <SegmentedButton
                key={option.id}
                active={network === option.id}
                ariaLabel={option.ariaLabel}
                onClick={() => setNetwork(option.id)}
              >
                {option.label}
              </SegmentedButton>
            ))}
          </div>
        </ToolbarGroup>

        <Separator orientation="vertical" className="h-6" />

        <ToolbarGroup role="group" aria-label="Group by">
          <span className="text-eyebrow text-foreground-subtle">Group by</span>
          <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
            {isBoardView && (
              <SegmentedButton active={groupBy === 'due'} onClick={() => setGroupBy('due')}>
                Due date
              </SegmentedButton>
            )}
            <SegmentedButton active={groupBy === 'agent'} onClick={() => setGroupBy('agent')}>
              Agent
            </SegmentedButton>
            <SegmentedButton active={groupBy === 'similar'} onClick={() => setGroupBy('similar')}>
              Similar task
            </SegmentedButton>
            <SegmentedButton active={groupBy === 'stage'} onClick={() => setGroupBy('stage')}>
              Stage
            </SegmentedButton>
          </div>
        </ToolbarGroup>

        {isBoardView && (
          <>
            <ToolbarSpacer />

            <ToolbarGroup aria-label="Due date filter">
              <label
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground-muted transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
                  selectedDate && 'border-primary/20 bg-primary-soft/40 text-primary'
                )}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent text-xs outline-none"
                  aria-label="Filter tasks by due date"
                />
              </label>
              {selectedDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<X className="h-3.5 w-3.5" />}
                  onClick={() => setSelectedDate('')}
                >
                  Clear
                </Button>
              )}
            </ToolbarGroup>
          </>
        )}
      </Toolbar>

      {view === 'no-tasks' ? (
        <NoOpenTaskReferrals
          groupBy={noOpenGroupBy}
          network={network}
          onTaskCreated={() => {
            router.refresh();
            void mutateSummary();
          }}
        />
      ) : data === undefined ? (
        <BoardSkeleton />
      ) : groupBy === 'due' ? (
        referralCards.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title={emptyLabel}
            description={emptyDescription}
          />
        ) : (
          <div className="space-y-4">
            {referralCards.map((card) => (
              <ReferralTaskCard
                key={card.referralId}
                card={card}
                view={view}
                selectedDate={selectedDate || undefined}
                onMutate={() => void mutate()}
              />
            ))}
          </div>
        )
      ) : groupedSections.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={emptyLabel}
          description={emptyDescription}
        />
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
                  <ReferralTaskCard
                    key={card.referralId}
                    card={card}
                    view={view}
                    selectedDate={selectedDate || undefined}
                    onMutate={() => void mutate()}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentedButton({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-surface-raised text-foreground shadow-sm ring-1 ring-border'
          : 'text-foreground-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function StatButton({
  label,
  value,
  hint,
  icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | null;
  hint: string;
  icon: ReactNode;
  tone: 'default' | 'warning' | 'danger';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-card border px-4 py-3.5 text-left shadow-card transition hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone === 'danger' && value !== null && value > 0
          ? 'border-[hsl(var(--signal)/0.3)] bg-signal-soft'
          : tone === 'warning' && value !== null && value > 0
            ? 'border-[hsl(var(--warning)/0.25)] bg-warning-soft/60'
            : 'border-border bg-surface-raised',
        active && 'ring-2 ring-primary/60 ring-offset-1 ring-offset-surface'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-eyebrow flex items-center gap-1.5 text-foreground-subtle">
          {tone === 'danger' && value !== null && value > 0 ? (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal" />
          ) : null}
          {label}
        </span>
        <span className="shrink-0 text-foreground-subtle">{icon}</span>
      </div>
      <span className="text-numeric text-2xl font-semibold leading-none tracking-[-0.02em] text-foreground">
        {value === null ? <Skeleton className="h-7 w-10" /> : value}
      </span>
      <span className="text-xs text-foreground-muted">{hint}</span>
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="space-y-3 rounded-card border border-border bg-surface-raised p-4 shadow-card"
        >
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-20" />
          </div>
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
