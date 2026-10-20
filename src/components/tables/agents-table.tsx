'use client';

import Link from 'next/link';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';

import { Pagination } from '@/components/tables/pagination';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatDecimal, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { selectFieldClasses } from '@/components/ui/field-group';
import { TBody, THead, Table, TableScroll, TableShell, Td, Th, Tr } from '@/components/ui/table-shell';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

interface AgentRow {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  brokerage?: string;
  officeAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  statesLicensed: string[];
  coverageAreas?: string[];
  coverageLocations?: CoverageLocation[];
  specialties?: string[];
  languages?: string[];
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  active?: boolean;
  metrics: {
    closingsLast12Months: number;
    closingRate: number;
    avgResponseHours: number | null;
    npsScore: number | null;
    totalReferralFeesPaidCents: number;
    totalNetIncomeCents: number;
    totalReferrals: number;
    activePipeline: number;
    averageReferralFeePaidCents: number | null;
    averageCommissionPercent: number | null;
  };
  npsScore?: number | null;
}

interface AgentsTableProps {
  // Legacy props kept for backward compatibility but no longer used
  showForm?: boolean;
  setShowForm?: Dispatch<SetStateAction<boolean>>;
  /** Set when a parent already renders the page header for this table. */
  hideHeading?: boolean;
}

interface AgentsResponse {
  items: AgentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function AgentsTable({
  showForm: externalShowForm,
  setShowForm: externalSetShowForm,
  hideHeading = false,
}: AgentsTableProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);
  
  const page = Number(searchParams.get('page') || 1);
  const pageSizeParam = searchParams.get('pageSize');
  const validPageSizes = [20, 25, 50, 100];
  const pageSize = pageSizeParam && validPageSizes.includes(Number(pageSizeParam)) 
    ? Number(pageSizeParam) 
    : 25;
  const search = searchParams.get('search') || '';
  const ahaFilter = (searchParams.get('ahaFilter') || 'all') as 'all' | 'AHA' | 'AHA_OOS' | 'AGIT';
  const activeFilter = (searchParams.get('activeFilter') || 'all') as 'all' | 'active' | 'inactive';
  const sortBy = searchParams.get('sortBy') || null;
  const sortDirection = (searchParams.get('sortDirection') as 'asc' | 'desc') || null;
  
  // Build API URL with filters
  const apiParams = new URLSearchParams();
  apiParams.set('page', page.toString());
  apiParams.set('pageSize', pageSize.toString());
  if (search) apiParams.set('search', search);
  if (ahaFilter !== 'all') apiParams.set('ahaFilter', ahaFilter);
  if (activeFilter !== 'all') apiParams.set('activeFilter', activeFilter);
  if (sortBy) apiParams.set('sortBy', sortBy);
  if (sortDirection) apiParams.set('sortDirection', sortDirection);
  
  const apiUrl = `/api/agents?${apiParams.toString()}`;
  const { data, mutate } = useSWR<AgentsResponse>(apiUrl, fetcher);
  const searchValue = search;
  const [searchTerm, setSearchTerm] = useState(searchValue);
  const [debouncedSearch, setDebouncedSearch] = useState(searchValue);
  const isTypingRef = useRef(false);

  const updateParams = useCallback(
    (updates: {
      search?: string;
      ahaFilter?: string;
      activeFilter?: string;
      page?: number;
      sortBy?: string;
      sortDirection?: 'asc' | 'desc';
    }) => {
      const params = new URLSearchParams(searchParamsString);
      
      if (updates.search !== undefined) {
        if (!updates.search.trim()) {
          params.delete('search');
        } else {
          params.set('search', updates.search.trim());
        }
        params.delete('page');
      }
      
      if (updates.ahaFilter !== undefined) {
        if (updates.ahaFilter === 'all') {
          params.delete('ahaFilter');
        } else {
          params.set('ahaFilter', updates.ahaFilter);
        }
        params.delete('page');
      }

      if (updates.activeFilter !== undefined) {
        const nextActiveFilter = updates.activeFilter;
        if (!nextActiveFilter || nextActiveFilter === 'all') {
          params.delete('activeFilter');
        } else {
          params.set('activeFilter', nextActiveFilter);
        }
        params.delete('page');
      }
      
      if (updates.sortBy !== undefined) {
        if (!updates.sortBy) {
          params.delete('sortBy');
        } else {
          params.set('sortBy', updates.sortBy);
        }
        params.delete('page');
      }
      
      if (updates.sortDirection !== undefined) {
        if (!updates.sortDirection) {
          params.delete('sortDirection');
        } else {
          params.set('sortDirection', updates.sortDirection);
        }
        params.delete('page');
      }
      
      if (updates.page !== undefined) {
        if (updates.page <= 1) {
          params.delete('page');
        } else {
          params.set('page', updates.page.toString());
        }
      }
      
      startTransition(() => {
        const queryString = params.toString();
        router.replace(queryString ? `/agents?${queryString}` : '/agents');
      });
    },
    [router, searchParamsString, startTransition]
  );
  
  // Sync from URL to local state (only when not typing)
  useEffect(() => {
    if (isTypingRef.current) return;
    setSearchTerm(searchValue);
    setDebouncedSearch(searchValue);
  }, [searchValue]);

  // Push debouncedSearch to URL (with deduplication)
  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);
    const existing = params.get('search') ?? '';
    const trimmed = debouncedSearch.trim();
    if (trimmed === existing.trim()) return;
    if (!trimmed) {
      params.delete('search');
    } else {
      params.set('search', trimmed);
    }
    params.delete('page');
    startTransition(() => {
      const queryString = params.toString();
      router.replace(queryString ? `/agents?${queryString}` : '/agents');
    });
  }, [debouncedSearch, router, searchParamsString, startTransition]);

  const handleSearchInput = useCallback((value: string) => {
    isTypingRef.current = true;
    setSearchTerm(value);
  }, []);

  // Debounce: update debouncedSearch from searchTerm (400ms for smoother typing)
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchTerm);
      isTypingRef.current = false;
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  // Refresh data when agents are added (via SWR mutate)
  useEffect(() => {
    mutate();
  }, [mutate]);

  const agents = Array.isArray(data?.items) ? data.items : [];

  type SortKey =
    | 'name'
    | 'closings'
    | 'closingRate'
    | 'nps'
    | 'avgResponse'
    | 'referralFees'
    | 'netIncome';

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      // Toggle direction if same key
      const nextDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      updateParams({ sortBy: key, sortDirection: nextDirection });
    } else {
      // New key, default to desc
      updateParams({ sortBy: key, sortDirection: 'desc' });
    }
  };

  const SortableHeader = ({ label, sortKey }: { label: string; sortKey: SortKey }) => {
    const direction = sortBy === sortKey ? sortDirection : null;
    const icon = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕';

    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        // Buttons don't inherit text-transform, so the header's eyebrow casing
        // has to be restated or sortable columns read title case.
        className="flex items-center gap-1 text-left uppercase"
      >
        <span>{label}</span>
        <span className="text-[10px] text-foreground-subtle">{icon}</span>
      </button>
    );
  };

  if (!data) {
    return (
      <div className="rounded-card border border-border bg-surface-raised p-4 text-sm text-foreground-muted shadow-card">
        Loading agents…
      </div>
    );
  }



  return (
    <div className="space-y-4">
      {!isAdmin && !hideHeading && (
        <PageHeader
          eyebrow="Partner network"
          title="Agents"
          description="Browse real estate agent partners."
        />
      )}
      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          {isAdmin && (
            <label className="flex-1 space-y-1.5">
              <span className="text-eyebrow block text-foreground-subtle">Search</span>
              <Input
                type="text"
                value={searchTerm}
                onChange={(event) => handleSearchInput(event.target.value)}
                placeholder="Name, email, phone, brokerage"
              />
            </label>
          )}
          <label className="space-y-1.5">
            <span className="text-eyebrow block text-foreground-subtle">Agent Designation</span>
            <select
              value={ahaFilter}
              onChange={(event) => updateParams({ ahaFilter: event.target.value })}
              disabled={isPending}
              className={selectFieldClasses}
            >
              <option value="all">All agents</option>
              <option value="AHA">AHA</option>
              <option value="AHA_OOS">AHA OOS</option>
              <option value="AGIT">AGIT</option>
            </select>
          </label>
          {isAdmin && (
            <label className="space-y-1.5">
              <span className="text-eyebrow block text-foreground-subtle">Status</span>
              <select
                value={activeFilter}
                onChange={(event) => updateParams({ activeFilter: event.target.value })}
                disabled={isPending}
                className={selectFieldClasses}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          )}
        </div>
      </div>

      <TableShell>
        <TableScroll>
          <Table className="min-w-full">
            <THead>
              <tr>
                <Th dense={isAdmin}>
                  <SortableHeader label="Agent" sortKey="name" />
                </Th>
                {isAdmin && <Th dense>Status</Th>}
                <Th dense={isAdmin}>
                  <SortableHeader label="Closings (12mo)" sortKey="closings" />
                </Th>
                <Th dense={isAdmin}>
                  <SortableHeader label="Closing %" sortKey="closingRate" />
                </Th>
                <Th dense={isAdmin}>
                  <SortableHeader label="NPS" sortKey="nps" />
                </Th>
                <Th dense={isAdmin}>
                  <SortableHeader label="Avg response" sortKey="avgResponse" />
                </Th>
                <Th dense={isAdmin}>
                  <SortableHeader label="Referral fees paid" sortKey="referralFees" />
                </Th>
                <Th dense={isAdmin}>
                  <SortableHeader label="Net income" sortKey="netIncome" />
                </Th>
              </tr>
            </THead>
            <TBody>
              {agents.length === 0 ? (
                <tr>
                  <td className="px-4 py-6" colSpan={isAdmin ? 8 : 7}>
                    <EmptyState
                      compact
                      title="No agents found"
                      description="No agents match the selected filter."
                    />
                  </td>
                </tr>
              ) : (
                agents.map((agent) => (
                  <Tr key={agent._id}>
                    <Td dense={isAdmin} className="text-foreground-muted">
                      <div className="font-medium text-foreground">
                        <Link href={`/agents/${agent._id}`} className="text-primary hover:underline">
                          {agent.name}
                        </Link>
                      </div>
                      <div className="text-xs text-foreground-subtle">
                        <a
                          href={buildGmailComposeUrl(agent.email)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {agent.email}
                        </a>
                      </div>
                      <div className="text-numeric text-xs text-foreground-subtle">
                        {agent.phone ? (
                          <a
                            href={`tel:${agent.phone.replace(/[^0-9+]/g, '')}`}
                            className="text-primary hover:underline"
                          >
                            {formatPhoneNumber(agent.phone)}
                          </a>
                        ) : '—'}
                      </div>
                    </Td>
                    {isAdmin && (
                      <Td dense className="text-foreground-muted">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            agent.active === false
                              ? 'bg-danger-soft text-danger'
                              : 'bg-success-soft text-success'
                          )}
                        >
                          {agent.active === false ? 'Inactive' : 'Active'}
                        </span>
                      </Td>
                    )}
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">
                      {agent.metrics.closingsLast12Months}
                    </Td>
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">
                      {(() => {
                        const closingRate = formatDecimal(agent.metrics.closingRate);
                        return closingRate === '—' ? '—' : `${closingRate}%`;
                      })()}
                    </Td>
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">{agent.metrics.npsScore ?? '—'}</Td>
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">
                      {agent.metrics.avgResponseHours == null
                        ? '—'
                        : `${formatDecimal(agent.metrics.avgResponseHours)} hrs`}
                    </Td>
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">
                      {formatCurrency(agent.metrics.totalReferralFeesPaidCents)}
                    </Td>
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">
                      {formatCurrency(agent.metrics.totalNetIncomeCents)}
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableShell>
      {data && (
        <Pagination
          currentPage={data.page}
          totalItems={data.total}
          pageSize={data.pageSize}
          totalPages={Math.ceil(data.total / data.pageSize)}
          itemLabel="agents"
        />
      )}
    </div>
  );
}
