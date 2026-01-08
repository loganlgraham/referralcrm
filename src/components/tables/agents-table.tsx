'use client';

import Link from 'next/link';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';

import { Pagination } from '@/components/tables/pagination';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatDecimal, formatPhoneNumber } from '@/utils/formatters';

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
  const sortBy = searchParams.get('sortBy') || null;
  const sortDirection = (searchParams.get('sortDirection') as 'asc' | 'desc') || null;
  
  // Build API URL with filters
  const apiParams = new URLSearchParams();
  apiParams.set('page', page.toString());
  apiParams.set('pageSize', pageSize.toString());
  if (search) apiParams.set('search', search);
  if (ahaFilter !== 'all') apiParams.set('ahaFilter', ahaFilter);
  if (sortBy) apiParams.set('sortBy', sortBy);
  if (sortDirection) apiParams.set('sortDirection', sortDirection);
  
  const apiUrl = `/api/agents?${apiParams.toString()}`;
  const { data, mutate } = useSWR<AgentsResponse>(apiUrl, fetcher);
  const [searchQuery, setSearchQuery] = useState(search);
  
  const updateParams = useCallback(
    (updates: { search?: string; ahaFilter?: string; page?: number; sortBy?: string; sortDirection?: 'asc' | 'desc' }) => {
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
  
  // Debounce search input
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery !== search) {
        updateParams({ search: searchQuery });
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery, search, updateParams]);

  // Sync searchQuery with URL param
  useEffect(() => {
    setSearchQuery(search);
  }, [search]);

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
        <span className="text-[10px] text-slate-400">{icon}</span>
      </button>
    );
  };

  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading agents…</div>;
  }

  const normalizeZipCode = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 5) {
      return null;
    }
    return digits.slice(0, 5);
  };

  const deriveZipCodes = (locations: CoverageLocation[]): string[] =>
    Array.from(
      new Set(
        locations.flatMap((location) =>
          (Array.isArray(location.zipCodes) ? location.zipCodes : [])
            .map((zip) => normalizeZipCode(zip))
            .filter((zip: string | null): zip is string => Boolean(zip))
        )
      )
    );

  const mergeCoverageLocations = (
    existing: CoverageLocation[],
    incoming: CoverageLocation[]
  ): CoverageLocation[] => {
    const merged = new Map<string, CoverageLocation>();

    existing.forEach((location) => {
      merged.set(location.label.toLowerCase(), {
        label: location.label,
        zipCodes: Array.from(new Set(location.zipCodes)),
      });
    });

    incoming.forEach((location) => {
      const label = location.label?.trim();
      if (!label) {
        return;
      }

      const normalizedZipCodes = Array.from(
        new Set(
          (Array.isArray(location.zipCodes) ? location.zipCodes : [])
            .map((zip) => normalizeZipCode(zip))
            .filter((zip: string | null): zip is string => Boolean(zip))
        )
      );

      if (normalizedZipCodes.length === 0) {
        return;
      }

      const key = label.toLowerCase();
      const existingLocation = merged.get(key);
      if (existingLocation) {
        merged.set(key, {
          label: existingLocation.label,
          zipCodes: Array.from(new Set([...existingLocation.zipCodes, ...normalizedZipCodes])),
        });
      } else {
        merged.set(key, { label, zipCodes: normalizedZipCodes });
      }
    });

    return Array.from(merged.values());
  };

  const updateCoverageLocations = (updater: (current: CoverageLocation[]) => CoverageLocation[]) => {
    setForm((previous) => ({
      ...previous,
      coverageLocations: updater(previous.coverageLocations),
    }));
  };

  const removeCoverageLocation = (label: string) => {
    const normalized = label.toLowerCase();
    updateCoverageLocations((current) =>
      current.filter((location) => location.label.toLowerCase() !== normalized)
    );
  };

  const addCoverageLocations = (locations: CoverageLocation[]) => {
    updateCoverageLocations((current) => mergeCoverageLocations(current, locations));
  };

  const generateCoverageLocations = async () => {
    const description = form.coverageDescription.trim();
    if (!description) {
      toast.error('Describe the agent’s coverage areas first.');
      return;
    }

    setIsGeneratingCoverage(true);
    setCoverageProgress(12);
    try {
      const response = await fetch('/api/coverage/zip-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Unable to generate ZIP codes');
      }

      const payload = await response.json();
      const receivedLocations = Array.isArray(payload?.locations) ? payload.locations : [];
      const normalizedLocations = receivedLocations
        .map((location: CoverageLocation | null | undefined) => {
          const label = location?.label?.trim() ?? '';
          const zipCodes = Array.from(
            new Set(
              (Array.isArray(location?.zipCodes) ? location.zipCodes : [])
                .map((zip) => normalizeZipCode(zip))
                .filter((zip: string | null): zip is string => Boolean(zip))
            )
          );

          return { label, zipCodes };
        })
        .filter(
          (location: { label: string; zipCodes: string[] }): location is CoverageLocation =>
            Boolean(location.label) && location.zipCodes.length > 0
        );

      if (normalizedLocations.length === 0) {
        const fallbackZipCodes = Array.isArray(payload?.zipCodes) ? payload.zipCodes : [];
        const fallbackLocations = fallbackZipCodes
          .map((zip: string) => normalizeZipCode(zip))
          .filter((zip: string | null): zip is string => Boolean(zip))
          .map((zip: string) => ({ label: zip, zipCodes: [zip] }));

        if (fallbackLocations.length === 0) {
          toast.info('No coverage locations were identified. Try adding more detail.');
          return;
        }

        addCoverageLocations(fallbackLocations);
        toast.success('ZIP codes added as coverage placeholders.');
        return;
      }

      addCoverageLocations(normalizedLocations);

      toast.success('Coverage locations added to the agent.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to generate coverage locations');
    } finally {
      setCoverageProgress(100);
      setIsGeneratingCoverage(false);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    try {
      const statesLicensed = form.states
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const normalizedCoverageLocations = mergeCoverageLocations([], form.coverageLocations);
      const coverageZipCodes = deriveZipCodes(normalizedCoverageLocations);
      const officeAddress = {
        street: form.officeAddress.street.trim() || undefined,
        city: form.officeAddress.city.trim() || undefined,
        state: form.officeAddress.state.trim() || undefined,
        zipCode: form.officeAddress.zipCode.trim() || undefined,
      };
      const hasOfficeAddress = Object.values(officeAddress).some((value) => value !== undefined);

      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          licenseNumber: form.licenseNumber,
          brokerage: form.brokerage,
          officeAddress: hasOfficeAddress ? officeAddress : undefined,
          statesLicensed,
          coverageAreas: coverageZipCodes,
          coverageLocations: normalizedCoverageLocations,
          specialties: form.specialties,
          languages: form.languages,
          ahaDesignation: form.ahaDesignation || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Unable to create agent');
      }

      const createdId = typeof payload?.id === 'string' ? payload.id : null;

      toast.success('Agent added');
      setLastCreatedAgent(
        createdId
          ? {
              id: createdId,
              name: form.name,
              email: form.email,
            }
          : null
      );
      setForm(createEmptyForm());
      setShowForm(false);
      await mutate();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save agent');
    } finally {
      setSaving(false);
    }
  };

  const handleSendWelcomeEmail = async () => {
    if (!lastCreatedAgent) {
      return;
    }

    setSendingWelcome(true);

    try {
      const response = await fetch(`/api/agents/${lastCreatedAgent.id}/welcome-email`, {
        method: 'POST',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? payload?.message ?? 'Unable to send welcome email');
      }

      toast.success(`Welcome email sent to ${lastCreatedAgent.name}`);
      setLastCreatedAgent(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to send welcome email');
    } finally {
      setSendingWelcome(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        {isAdmin && (
          <label className="text-xs font-semibold text-slate-600">
            Search
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              disabled={isPending}
              className="mt-2 w-full max-w-2xl rounded-lg border border-slate-200 px-4 py-3 text-base shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Name, email, phone, brokerage"
            />
          </label>
        )}
        <label className="text-xs font-semibold text-slate-600">
          Agent Designation
          <select
            value={ahaFilter}
            onChange={(event) => updateParams({ ahaFilter: event.target.value })}
            disabled={isPending}
            className="mt-1 rounded border border-slate-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="all">All agents</option>
            <option value="AHA">AHA</option>
            <option value="AHA_OOS">AHA OOS</option>
            <option value="AGIT">AGIT</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="Agent" sortKey="name" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="Closings (12mo)" sortKey="closings" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="Closing %" sortKey="closingRate" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="NPS" sortKey="nps" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="Avg response" sortKey="avgResponse" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="Referral fees paid" sortKey="referralFees" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortableHeader label="Net income" sortKey="netIncome" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={7}>
                  No agents match the selected filter.
                </td>
              </tr>
            ) : (
              agents.map((agent) => (
                <tr key={agent._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">
                      <Link href={`/agents/${agent._id}`} className="text-brand hover:underline">
                        {agent.name}
                      </Link>
                    </div>
                    <div className="text-xs text-slate-500">
                      <a href={`mailto:${agent.email}`} className="text-brand hover:underline">
                        {agent.email}
                      </a>
                    </div>
                    <div className="text-xs text-slate-500">{formatPhoneNumber(agent.phone) || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{agent.metrics.closingsLast12Months}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {(() => {
                      const closingRate = formatDecimal(agent.metrics.closingRate);
                      return closingRate === '—' ? '—' : `${closingRate}%`;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{agent.metrics.npsScore ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {agent.metrics.avgResponseHours == null
                      ? '—'
                      : `${formatDecimal(agent.metrics.avgResponseHours)} hrs`}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatCurrency(agent.metrics.totalReferralFeesPaidCents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
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
