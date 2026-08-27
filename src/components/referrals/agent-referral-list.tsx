'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { getReferralStatusLabel, type ReferralStatus } from '@/constants/referrals';
import { groupReferralsForAgent } from '@/lib/referral-groups';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/tables/pagination';
import type { ReferralRow } from '@/components/tables/referral-table';
import { AgentReferralRow } from '@/components/referrals/agent-referral-row';
import { AgentReferralCard } from '@/components/referrals/agent-referral-card';
import { IntroduceClientCta } from '@/components/layout/introduce-client-cta';
import { confirmLostReason } from '@/components/referrals/lost-reason-confirmation-toast';
import { confirmReferralTermination } from '@/components/referrals/terminate-confirmation-toast';
import { confirmCloseStatusDate } from '@/components/referrals/status-date-confirmation-toast';
import {
  collectUnderContractDeal,
  submitUnderContractDeal
} from '@/components/referrals/deal-details-toast';
import {
  AGENT_REFERRAL_FILTERS,
  AGENT_ROW_GRID,
  AGENT_STATUSES_NEEDING_INPUT,
  getAgentStatusChoices,
  matchesAgentSearch,
  type AgentReferralFilterId
} from '@/components/referrals/agent-referral-shared';

interface AgentReferralListProps {
  rows: ReferralRow[];
  page: number;
  pageSize: number;
  total: number;
}

const EYEBROW = 'font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle';
const GROUP_LABEL = 'font-mono text-[11px] font-semibold uppercase tracking-[0.18em]';

export function AgentReferralList({ rows: initialRows, page, pageSize, total }: AgentReferralListProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [filterId, setFilterId] = useState<AgentReferralFilterId>('needs-update');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const counts = useMemo(() => {
    const result: Record<AgentReferralFilterId, number> = {
      'needs-update': 0,
      all: rows.length,
      'under-contract': 0,
      closed: 0
    };
    for (const row of rows) {
      if (row.needsUpdate) result['needs-update'] += 1;
      if (row.status === 'Under Contract') result['under-contract'] += 1;
      if (row.status === 'Closed') result.closed += 1;
    }
    return result;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filter = AGENT_REFERRAL_FILTERS.find((entry) => entry.id === filterId);
    return rows.filter((row) => (filter ? filter.matches(row) : true) && matchesAgentSearch(row, search));
  }, [rows, filterId, search]);

  const groups = useMemo(
    () => groupReferralsForAgent(visibleRows).filter((group) => group.items.length > 0),
    [visibleRows]
  );

  const selectedRows = useMemo(
    () => visibleRows.filter((row) => selectedIds.includes(row._id)),
    [visibleRows, selectedIds]
  );

  /** Optimistically move the row out of "Waiting on you" and reconcile from the server. */
  const markRowUpdated = useCallback((id: string, patch: Partial<ReferralRow>) => {
    setRows((current) =>
      current.map((row) => (row._id === id ? { ...row, ...patch, needsUpdate: false } : row))
    );
  }, []);

  /** `status` is the value that actually lands in the DB, which Terminated rewrites. */
  const writeStatus = useCallback(
    async (
      row: ReferralRow,
      status: ReferralStatus,
      extraBody: Record<string, unknown> = {}
    ): Promise<boolean> => {
      const previous = row.status;
      markRowUpdated(row._id, { status, statusChangedAt: new Date().toISOString(), daysInStatus: 0 });

      try {
        const response = await fetch(`/api/referrals/${row._id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            source: 'referral_table',
            side: row.viewerAssignedSide ?? undefined,
            ...extraBody
          })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const message =
            payload?.error?.message ??
            payload?.error?.status?.[0] ??
            payload?.error?.side?.[0] ??
            'Could not update the status.';
          throw new Error(message);
        }

        toast.success(`${row.borrowerName} moved to ${getReferralStatusLabel(status)}.`);
        return true;
      } catch (error) {
        setRows((current) =>
          current.map((entry) =>
            entry._id === row._id ? { ...entry, status: previous, needsUpdate: row.needsUpdate } : entry
          )
        );
        toast.error(error instanceof Error ? error.message : 'Could not update the status.');
        return false;
      }
    },
    [markRowUpdated]
  );

  /** Outcomes that need more than a status collect it in a toast before anything is written. */
  const postStatus = useCallback(
    async (row: ReferralRow, status: ReferralStatus): Promise<boolean> => {
      const side = row.viewerAssignedSide ?? undefined;
      const isAgentOrigin = row.origin === 'agent';

      if (status === 'Under Contract') {
        const saved = await collectUnderContractDeal({
          defaultSide: side === 'sell' ? 'sell' : 'buy',
          isAgentOrigin,
          onSubmit: (result) => submitUnderContractDeal(row._id, result, 'referral_table')
        });
        if (!saved) {
          return false;
        }
        markRowUpdated(row._id, {
          status: 'Under Contract',
          statusChangedAt: new Date().toISOString(),
          daysInStatus: 0
        });
        toast.success(`${row.borrowerName} moved to Under Contract.`);
        return true;
      }

      if (status === 'Terminated') {
        const confirmation = await confirmReferralTermination({
          borrowerName: row.borrowerName,
          isAgentOrigin
        });
        if (!confirmation.confirmed || !confirmation.resolvedStatus || !confirmation.terminatedReason) {
          return false;
        }
        return writeStatus(row, confirmation.resolvedStatus, {
          terminatedReason: confirmation.terminatedReason,
          lostReason: confirmation.lostReason ?? null,
          terminateDeal: true
        });
      }

      if (status === 'Lost') {
        const confirmation = await confirmLostReason({
          borrowerName: row.borrowerName,
          isAgentOrigin
        });
        if (!confirmation.confirmed || !confirmation.lostReason) {
          return false;
        }
        return writeStatus(row, 'Lost', { lostReason: confirmation.lostReason });
      }

      if (status === 'Closed') {
        const askUsedAfc = side !== 'sell';
        const confirmation = await confirmCloseStatusDate({
          initialDateIso: null,
          canSendClosedEmails: false,
          defaultSendClosedEmails: false,
          canSendAgentNpsEmail: false,
          defaultSendAgentNpsEmail: false,
          showEmailPreference: false,
          askUsedAfc,
          defaultUsedAfc: true
        });
        if (!confirmation.confirmed) {
          return false;
        }
        return writeStatus(row, 'Closed', {
          closingDate: confirmation.closingDateIso,
          sendClosedEmails: true,
          sendAgentNpsEmail: true,
          ...(askUsedAfc && typeof confirmation.usedAfc === 'boolean'
            ? { usedAfc: confirmation.usedAfc }
            : {})
        });
      }

      return writeStatus(row, status);
    },
    [markRowUpdated, writeStatus]
  );

  const handleApplyStatus = useCallback(
    async (row: ReferralRow, status: ReferralStatus) => {
      setPendingId(row._id);
      const ok = await postStatus(row, status);
      setPendingId(null);
      if (ok) {
        setExpandedId(null);
        router.refresh();
      }
    },
    [postStatus, router]
  );

  const handleSaveNote = useCallback(
    async (row: ReferralRow, note: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/referrals/${row._id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: note })
        });

        if (!response.ok) {
          throw new Error('Could not save the note.');
        }

        const saved = await response.json().catch(() => null);
        markRowUpdated(row._id, {
          lastActivity: {
            text: note,
            authorName: saved?.authorName ?? 'You',
            at: saved?.createdAt ?? new Date().toISOString()
          }
        });
        toast.success('Note saved.');
        setExpandedId(null);
        router.refresh();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not save the note.');
        return false;
      }
    },
    [markRowUpdated, router]
  );

  const handleBulkStatus = useCallback(
    async (status: ReferralStatus) => {
      setBulkStatusOpen(false);
      const targets = [...selectedRows];
      let applied = 0;

      for (const row of targets) {
        setPendingId(row._id);
        const ok = await postStatus(row, status);
        if (ok) {
          applied += 1;
        }
      }

      setPendingId(null);
      setSelectedIds([]);
      setSelectMode(false);

      if (applied > 0) {
        router.refresh();
      }
    },
    [postStatus, router, selectedRows]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  }, []);

  const needsUpdateCount = counts['needs-update'];
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const bulkStatusChoices = selectedRows[0]
    ? getAgentStatusChoices(selectedRows[0].status).filter(
        (status) => !AGENT_STATUSES_NEEDING_INPUT.includes(status)
      )
    : [];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold tracking-[-0.035em] text-foreground lg:text-[30px]">
            My referrals
          </h1>
          <p className="mt-1.5 text-[15px] leading-[1.45] text-foreground-muted">
            {needsUpdateCount > 0 ? (
              <>
                <span className="font-bold text-foreground">
                  {needsUpdateCount} need{needsUpdateCount === 1 ? 's' : ''} an update
                </span>{' '}
                from you. Everything else is moving.
              </>
            ) : (
              <>
                <span className="font-bold text-foreground">Nothing needs an update</span> from you.
                Everything is moving.
              </>
            )}
          </p>
        </div>
      </header>

      <div className="border-b border-border pb-3.5">
        <div className="scrollbar-thin flex items-center gap-2 overflow-x-auto">
          {AGENT_REFERRAL_FILTERS.map((filter) => {
            const count = counts[filter.id];
            const active = filter.id === filterId;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilterId(filter.id)}
                className={cn(
                  'h-[34px] shrink-0 rounded-pill px-3.5 text-[13px] transition lg:h-9',
                  // The phone toolbar holds three pills plus the search pill.
                  filter.id === 'under-contract' && 'hidden lg:inline-flex lg:items-center',
                  active
                    ? 'bg-primary font-semibold text-white'
                    : 'border border-border bg-surface font-medium text-foreground-muted hover:bg-surface-muted'
                )}
              >
                {filter.label}
                {count > 0 ? <span className="font-mono tabular-nums"> · {count}</span> : null}
              </button>
            );
          })}

          <span className="hidden flex-1 lg:block" />

          <label className="relative hidden w-[280px] items-center lg:inline-flex">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-foreground-subtle" aria-hidden />
            <span className="sr-only">Search referrals</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, loan #"
              className="h-9 w-full rounded-pill border border-border bg-surface pl-[34px] pr-3.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <button
            type="button"
            aria-label="Search referrals"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((current) => !current)}
            className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-foreground-muted transition hover:bg-surface-muted lg:hidden"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>

          <button
            type="button"
            aria-pressed={selectMode}
            onClick={() => {
              setSelectMode((current) => !current);
              setSelectedIds([]);
              setBulkStatusOpen(false);
            }}
            className={cn(
              'h-[34px] shrink-0 rounded-pill px-3.5 text-[13px] font-semibold transition lg:h-9',
              selectMode
                ? 'bg-primary text-white'
                : 'border border-border bg-surface text-foreground hover:bg-surface-muted'
            )}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
        </div>

        {searchOpen ? (
          <label className="relative mt-2 flex items-center lg:hidden">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-foreground-subtle" aria-hidden />
            <span className="sr-only">Search referrals</span>
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, loan #"
              className="h-10 w-full rounded-pill border border-border bg-surface pl-[34px] pr-3.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        ) : null}
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState
          icon={<Send className="h-4 w-4" aria-hidden />}
          title={filterId === 'needs-update' ? 'Nothing needs you right now' : 'Nothing here yet'}
          description={
            filterId === 'needs-update'
              ? 'Every referral is moving. We will flag one here as soon as it goes quiet.'
              : 'No referrals match this filter.'
          }
        />
      ) : (
        <>
          <div className={cn(AGENT_ROW_GRID, 'hidden px-5 pb-0.5 lg:grid')}>
            <span className={EYEBROW}>Client</span>
            <span className={EYEBROW}>Status</span>
            <span className={EYEBROW}>Last activity</span>
            <span />
          </div>

          <div className="space-y-2.5">
            {groups.map((group) => (
              <section key={group.id} className="space-y-2">
                <div
                  className={cn(
                    'flex items-center gap-2.5 border-l-2 pl-2.5',
                    group.id === 'waiting-on-you' ? 'border-signal' : 'border-border-strong'
                  )}
                >
                  <span
                    className={cn(
                      GROUP_LABEL,
                      group.id === 'waiting-on-you' ? 'text-foreground-muted' : 'text-foreground-subtle'
                    )}
                  >
                    {group.label}
                  </span>
                  <span className={cn(GROUP_LABEL, 'tabular-nums text-foreground-subtle')}>
                    {group.items.length}
                  </span>
                </div>

                <div className="hidden space-y-2 lg:block">
                  {group.items.map((row) => (
                    <AgentReferralRow
                      key={row._id}
                      row={row}
                      expanded={expandedId === row._id}
                      pending={pendingId === row._id}
                      selectMode={selectMode}
                      selected={selectedIds.includes(row._id)}
                      onToggleSelected={toggleSelected}
                      onToggleExpanded={toggleExpanded}
                      onApplyStatus={handleApplyStatus}
                      onSaveNote={handleSaveNote}
                    />
                  ))}
                </div>

                <div className="space-y-2 lg:hidden">
                  {group.items.map((row) => (
                    <AgentReferralCard
                      key={row._id}
                      row={row}
                      expanded={expandedId === row._id}
                      pending={pendingId === row._id}
                      selectMode={selectMode}
                      selected={selectedIds.includes(row._id)}
                      onToggleSelected={toggleSelected}
                      onToggleExpanded={toggleExpanded}
                      onApplyStatus={handleApplyStatus}
                      onSaveNote={handleSaveNote}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {totalPages > 1 ? (
            <Pagination
              currentPage={page}
              totalItems={total}
              pageSize={pageSize}
              totalPages={totalPages}
              itemLabel="referrals"
            />
          ) : (
            <p className="pt-1.5 text-[13px] text-foreground-subtle">
              Showing all {total} referral{total === 1 ? '' : 's'}.
            </p>
          )}
        </>
      )}

      {selectMode && selectedIds.length > 0 ? (
        <div className="sticky bottom-4 z-30 rounded-card border border-border-strong bg-surface-raised p-3 shadow-raised">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-foreground">
              {selectedIds.length} selected
            </span>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkStatusOpen((current) => !current)}>
              Update {selectedIds.length} referral{selectedIds.length === 1 ? '' : 's'}
            </Button>
          </div>
          {bulkStatusOpen ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className={cn(EYEBROW, 'mb-2')}>Move all to</p>
              <div className="flex flex-wrap gap-1.5">
                {bulkStatusChoices.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => handleBulkStatus(status)}
                    className="inline-flex h-[34px] items-center rounded-pill border border-border-strong bg-surface px-[13px] text-[13px] font-medium text-foreground transition hover:bg-surface-subtle disabled:opacity-60"
                  >
                    {getReferralStatusLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface px-4 pb-4 pt-3 lg:hidden">
        <IntroduceClientCta />
      </div>
    </div>
  );
}
