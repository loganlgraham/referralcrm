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
}

interface AgentsResponse {
  items: AgentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function AgentsTable({ showForm: externalShowForm, setShowForm: externalSetShowForm }: AgentsTableProps) {
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
        className="flex items-center gap-1 text-left"
      >
        <span>{label}</span>
        <span className="text-[10px] text-foreground-subtle">{icon}</span>
      </button>
    );
  };

  if (!data) {
    return <div className="rounded-md bg-surface-raised p-4 shadow-sm">Loading agents…</div>;
  }






  return (
    <div className="space-y-4">
      {!isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
            <p className="text-sm text-foreground-subtle">Browse real estate agent partners.</p>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          {isAdmin && (
            <label className="flex-1 text-xs font-semibold text-foreground-muted">
              Search
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => handleSearchInput(event.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-surface-raised px-4 py-3 text-base shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Name, email, phone, brokerage"
              />
            </label>
          )}
          <label className="text-xs font-semibold text-foreground-muted">
            Agent Designation
            <select
              value={ahaFilter}
              onChange={(event) => updateParams({ ahaFilter: event.target.value })}
              disabled={isPending}
              className="mt-1 rounded border border-border bg-surface-raised px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="all">All agents</option>
              <option value="AHA">AHA</option>
              <option value="AHA_OOS">AHA OOS</option>
              <option value="AGIT">AGIT</option>
            </select>
          </label>
          {isAdmin && (
            <label className="text-xs font-semibold text-foreground-muted">
              Status
              <select
                value={activeFilter}
                onChange={(event) => updateParams({ activeFilter: event.target.value })}
                disabled={isPending}
                className="mt-1 rounded border border-border bg-surface-raised px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-sm">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Agent" sortKey="name" />
              </th>
              {isAdmin && (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Status
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Closings (12mo)" sortKey="closings" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Closing %" sortKey="closingRate" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="NPS" sortKey="nps" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Avg response" sortKey="avgResponse" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Referral fees paid" sortKey="referralFees" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Net income" sortKey="netIncome" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-foreground-subtle" colSpan={isAdmin ? 8 : 7}>
                  No agents match the selected filter.
                </td>
              </tr>
            ) : (
              agents.map((agent) => (
                <tr key={agent._id} className="hover:bg-surface-muted">
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    <div className="font-medium text-foreground">
                      <Link href={`/agents/${agent._id}`} className="text-primary-700 hover:underline">
                        {agent.name}
                      </Link>
                    </div>
                    <div className="text-xs text-foreground-subtle">
                      <a
                      href={buildGmailComposeUrl(agent.email)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-700 hover:underline"
                    >
                      {agent.email}
                    </a>
                    </div>
                    <div className="text-xs text-foreground-subtle">
                      {agent.phone ? (
                        <a
                          href={`tel:${agent.phone.replace(/[^0-9+]/g, '')}`}
                          className="text-primary-700 hover:underline"
                        >
                          {formatPhoneNumber(agent.phone)}
                        </a>
                      ) : '—'}
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          agent.active === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {agent.active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm text-foreground-muted">{agent.metrics.closingsLast12Months}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {(() => {
                      const closingRate = formatDecimal(agent.metrics.closingRate);
                      return closingRate === '—' ? '—' : `${closingRate}%`;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{agent.metrics.npsScore ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {agent.metrics.avgResponseHours == null
                      ? '—'
                      : `${formatDecimal(agent.metrics.avgResponseHours)} hrs`}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {formatCurrency(agent.metrics.totalReferralFeesPaidCents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {formatCurrency(agent.metrics.totalNetIncomeCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
