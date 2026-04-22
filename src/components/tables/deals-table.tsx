'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  TimeframeDropdown,
  type TimeframeKey,
  type TimeframePreset,
  type DateRange,
  getPresetRange,
  formatDisplayRange,
  formatDateInput,
  isDateRangeValid,
  TIMEFRAME_PRESETS
} from '@/components/dashboard/timeframe-controls';
import { DEAL_STATUS_LABELS, DEAL_STATUS_VALUES, type DealStatus } from '@/constants/deals';
import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { Pagination } from '@/components/tables/pagination';
import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { fetcher } from '@/utils/fetcher';
import { addYears } from 'date-fns';
import { formatCurrency, formatDate } from '@/utils/formatters';

type TerminatedReason = 'inspection' | 'appraisal' | 'financing' | 'changed_mind';
type AgentAttribution = 'AHA' | 'AHA_OOS' | 'OUTSIDE_AGENT' | null;
const STATUS_FILTER_OPTIONS: { value: DealStatus; label: string }[] =
  DEAL_STATUS_VALUES.map((status) => ({ value: status, label: DEAL_STATUS_LABELS[status] }));

const TERMINATED_REASON_OPTIONS: { value: TerminatedReason; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'financing', label: 'Financing' },
  { value: 'changed_mind', label: 'Changed Mind' },
];

type AgentDesignationFilter = 'AHA' | 'AHA_OOS' | 'AGIT';
const DESIGNATION_FILTER_OPTIONS: { value: AgentDesignationFilter; label: string }[] = [
  { value: 'AHA', label: 'AHA' },
  { value: 'AHA_OOS', label: 'AHA OOS' },
  { value: 'AGIT', label: 'AGIT' },
];
type TriStateFilterValue = 'all' | 'true' | 'false';

interface DealRow {
  _id: string;
  referralId: string;
  side?: 'buy' | 'sell' | null;
  status: DealStatus;
  expectedAmountCents: number;
  receivedAmountCents: number;
  propertyAddress?: string | null;
  terminatedReason?: TerminatedReason | null;
  closingDate?: string | null;
  invoiceDate?: string | null;
  paidDate?: string | null;
  usedAfc?: boolean | null;
  usedAssignedAgent?: boolean | null;
  agentAttribution?: AgentAttribution;
  agent?: {
    id: string;
    name: string | null;
  } | null;
  agentDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  referral?: {
    borrowerName?: string | null;
    propertyAddress?: string | null;
    lookingInZip?: string | null;
    lookingInZips?: string[] | null;
    commissionBasisPoints?: number | null;
    referralFeeBasisPoints?: number | null;
    estPurchasePriceCents?: number | null;
    preApprovalAmountCents?: number | null;
    referralFeeDueCents?: number | null;
    loanFileNumber?: string | null;
    ahaBucket?: AgentAttribution;
    dealSide?: 'buy' | 'sell' | null;
    endorser?: string | null;
  } | null;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  onChange: (nextValue: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        checked ? 'bg-primary-600' : 'bg-surface-subtle'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-surface-raised shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

interface PaymentsResponse {
  items: DealRow[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    receivedRevenueCents?: number;
  };
}

export function DealsTable() {
  const { data: session } = useSession();
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
  const statusParam = searchParams.get('status') || '';
  const statusFilters = statusParam ? statusParam.split(',').filter(Boolean) as DealStatus[] : [];
  const designationParam = searchParams.get('designation') || '';
  const designationFilters = designationParam
    ? (designationParam.split(',').filter(Boolean) as AgentDesignationFilter[])
    : [];
  const sortBy = searchParams.get('sortBy') || null;
  const sortDirection = (searchParams.get('sortDirection') as 'asc' | 'desc') || null;
  const usedAgentParam = searchParams.get('usedAgent');
  const usedAfcParam = searchParams.get('usedAfc');
  const usedAgentFilter: TriStateFilterValue =
    usedAgentParam === 'true' || usedAgentParam === 'false' ? usedAgentParam : 'all';
  const usedAfcFilter: TriStateFilterValue =
    usedAfcParam === 'true' || usedAfcParam === 'false' ? usedAfcParam : 'all';
  const [timeframe, setTimeframe] = useState<TimeframeKey>('all');
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('month'));
  
  // Build API URL with filters
  const apiParams = new URLSearchParams();
  apiParams.set('page', page.toString());
  apiParams.set('pageSize', pageSize.toString());
  apiParams.set('timeframe', timeframe);
  if (timeframe === 'custom') {
    if (customRange.start) apiParams.set('start', customRange.start);
    if (customRange.end) apiParams.set('end', customRange.end);
  }
  if (search) apiParams.set('search', search);
  // When a closing-date timeframe is active, do not send status so the API returns all deals by closing date.
  if (timeframe === 'all' && statusFilters.length > 0) apiParams.set('status', statusFilters.join(','));
  if (designationFilters.length > 0) apiParams.set('designation', designationFilters.join(','));
  if (usedAgentFilter !== 'all') apiParams.set('usedAgent', usedAgentFilter);
  if (usedAfcFilter !== 'all') apiParams.set('usedAfc', usedAfcFilter);
  if (sortBy) apiParams.set('sortBy', sortBy);
  if (sortDirection) apiParams.set('sortDirection', sortDirection);
  
  const apiUrl = `/api/payments?${apiParams.toString()}`;
  const { data, mutate } = useSWR<PaymentsResponse>(apiUrl, fetcher);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const searchValue = search;
  const [searchTerm, setSearchTerm] = useState(searchValue);
  const [debouncedSearch, setDebouncedSearch] = useState(searchValue);
  const isTypingRef = useRef(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [isDesignationMenuOpen, setIsDesignationMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const designationMenuRef = useRef<HTMLDivElement | null>(null);

  const deals = Array.isArray(data?.items) ? data.items : [];
  const isLoading = !data;
  
  const updateParams = useCallback(
    (updates: {
      search?: string;
      status?: string;
      designation?: string;
      usedAgent?: TriStateFilterValue;
      usedAfc?: TriStateFilterValue;
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
        // Reset to page 1 when search changes
        params.delete('page');
      }
      
      if (updates.status !== undefined) {
        if (!updates.status) {
          params.delete('status');
        } else {
          params.set('status', updates.status);
        }
        // Reset to page 1 when status changes
        params.delete('page');
      }
      
      if (updates.designation !== undefined) {
        if (!updates.designation) {
          params.delete('designation');
        } else {
          params.set('designation', updates.designation);
        }
        params.delete('page');
      }

      if (updates.usedAgent !== undefined) {
        if (updates.usedAgent === 'all') {
          params.delete('usedAgent');
        } else {
          params.set('usedAgent', updates.usedAgent);
        }
        params.delete('page');
      }

      if (updates.usedAfc !== undefined) {
        if (updates.usedAfc === 'all') {
          params.delete('usedAfc');
        } else {
          params.set('usedAfc', updates.usedAfc);
        }
        params.delete('page');
      }
      
      if (updates.sortBy !== undefined) {
        if (!updates.sortBy) {
          params.delete('sortBy');
        } else {
          params.set('sortBy', updates.sortBy);
        }
        // Reset to page 1 when sort changes
        params.delete('page');
      }
      
      if (updates.sortDirection !== undefined) {
        if (!updates.sortDirection) {
          params.delete('sortDirection');
        } else {
          params.set('sortDirection', updates.sortDirection);
        }
        // Reset to page 1 when sort changes
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
        router.replace(queryString ? `/deals?${queryString}` : '/deals');
      });
    },
    [router, searchParamsString, startTransition]
  );

  const handlePresetSelect = useCallback(
    (preset: TimeframePreset) => {
      setTimeframe(preset);
      setCustomRange(getPresetRange(preset === 'all' ? 'month' : preset));
      if (preset !== 'all') {
        updateParams({ status: '' });
      }
    },
    [updateParams]
  );

  const handleCustomRangeSelect = useCallback(
    (range: DateRange) => {
      if (!isDateRangeValid(range)) return;
      setCustomRange(range);
      setTimeframe('custom');
      updateParams({ status: '' });
    },
    [updateParams]
  );

  useEffect(() => {
    if (timeframe === 'custom') return;
    setCustomRange(getPresetRange(timeframe === 'all' ? 'month' : timeframe));
  }, [timeframe]);

  const maxSelectableDate = formatDateInput(addYears(new Date(), 1));
  const timeframeLabel =
    timeframe === 'custom'
      ? formatDisplayRange(customRange)
      : TIMEFRAME_PRESETS.find((o) => o.value === timeframe)?.label ?? 'Select timeframe';
  const hasActiveFilters =
    Boolean(search.trim()) ||
    statusFilters.length > 0 ||
    designationFilters.length > 0 ||
    usedAgentFilter !== 'all' ||
    usedAfcFilter !== 'all' ||
    timeframe !== 'all';

  const getDealAddress = (deal: DealRow) => {
    const address = (deal.propertyAddress ?? deal.referral?.propertyAddress ?? '').trim();
    return address || null;
  };

  const role = session?.user?.role;
  const isAgentView = role === 'agent';
  const isMcView = role === 'mc';
  const isAdminView = role === 'admin' || role === 'manager';

  // Sync from URL to local state (only when not typing) — match referrals
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
      router.replace(queryString ? `/deals?${queryString}` : '/deals');
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

  const calculateCommission = (row: DealRow) => {
    if (row.status === 'terminated') {
      return 0;
    }

    const commissionBps = row.referral?.commissionBasisPoints ?? DEFAULT_AGENT_COMMISSION_BPS;
    const baseAmountCents =
      row.referral?.estPurchasePriceCents && row.referral.estPurchasePriceCents > 0
        ? row.referral.estPurchasePriceCents
        : row.referral?.preApprovalAmountCents ?? 0;

    if (!baseAmountCents || !commissionBps) {
      return 0;
    }

    return Math.round((baseAmountCents * commissionBps) / 10000);
  };


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) {
        setIsStatusMenuOpen(false);
      }
      if (designationMenuRef.current && !designationMenuRef.current.contains(target)) {
        setIsDesignationMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  type SortKey =
    | 'referral'
    | 'agent'
    | 'dealSide'
    | 'status'
    | 'closingDate'
    | 'address'
    | 'referralFee'
    | 'receivedAmount'
    | 'usedAfc'
    | 'usedAgent'
    | 'paid'
    | 'outcome'
    | 'commission'
    | 'netCommission';

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

  const normalizeStatusLabel = (status?: DealStatus | null) => {
    if (!status) {
      return '';
    }

    return (DEAL_STATUS_LABELS[status] ?? status).toString();
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

  // Define expected revenue statuses to match dashboard calculation
  const EXPECTED_REVENUE_STATUSES = new Set<DealStatus>([
    'under_contract',
    'past_inspection',
    'past_appraisal',
    'clear_to_close',
    'closed',
    'payment_sent'
  ]);

  const aggregates = deals.reduce(
    (acc, row) => {
      const isTerminated = row.status === 'terminated';
      const isOutsideAgent = row.agentAttribution === 'OUTSIDE_AGENT';
      const isGlennBeck = row.referral?.endorser?.trim().toLowerCase() === 'glenn beck';

      if (
        row.status === 'under_contract' ||
        row.status === 'past_inspection' ||
        row.status === 'past_appraisal' ||
        row.status === 'clear_to_close'
      ) {
        acc.totalUnderContract += 1;
      }
      if (isTerminated) {
        acc.totalTerminated += 1;
      }

      const expectedBase = row.expectedAmountCents ?? row.referral?.referralFeeDueCents ?? 0;
      const paidAmount = row.receivedAmountCents || 0;
      const outstanding = isTerminated ? 0 : Math.max(expectedBase - paidAmount, 0);
      const effectivePaid = isTerminated
        ? 0
        : row.status === 'paid'
          ? paidAmount || expectedBase
          : 0;
      const commission = calculateCommission(row);

      // Calculate expected revenue matching dashboard logic:
      // - Only count deals with statuses in EXPECTED_REVENUE_STATUSES
      // - Or paid deals with outstanding > 0
      // - Exclude OUTSIDE_AGENT deals
      // - Exclude Glenn Beck referrals
      if (!isOutsideAgent && !isGlennBeck) {
        if (EXPECTED_REVENUE_STATUSES.has(row.status)) {
          acc.expectedRevenue += outstanding;
        } else if (row.status === 'paid' && outstanding > 0) {
          acc.expectedRevenue += outstanding;
        }
      }

      acc.receivedRevenue += effectivePaid;
      acc.referralFeesPaid += effectivePaid;
      acc.commissionEarned += commission;

      return acc;
    },
    {
      expectedRevenue: 0,
      receivedRevenue: 0,
      referralFeesPaid: 0,
      commissionEarned: 0,
      totalUnderContract: 0,
      totalTerminated: 0,
    }
  );
  const adminReceivedRevenue = data?.summary?.receivedRevenueCents ?? aggregates.receivedRevenue;

  const totalCommission = aggregates.commissionEarned - aggregates.referralFeesPaid;

  const summarySection = (() => {
    if (isAdminView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Expected Revenue" value={formatCurrency(aggregates.expectedRevenue)} />
          <SummaryCard label="Received Revenue" value={formatCurrency(adminReceivedRevenue)} />
        </div>
      );
    }

    if (isMcView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Total Deals Under Contract" value={aggregates.totalUnderContract.toLocaleString()} />
          <SummaryCard label="Total Deals Terminated" value={aggregates.totalTerminated.toLocaleString()} />
        </div>
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Referral Fees Paid" value={formatCurrency(aggregates.referralFeesPaid)} />
        <SummaryCard label="Commission Earned" value={formatCurrency(aggregates.commissionEarned)} />
        <SummaryCard label="Total Commission" value={formatCurrency(totalCommission)} />
      </div>
    );
  })();

  const updateDeal = async (
    deal: DealRow,
    updates: Partial<
      Pick<
        DealRow,
        | 'status'
        | 'expectedAmountCents'
        | 'receivedAmountCents'
        | 'terminatedReason'
        | 'usedAfc'
        | 'usedAssignedAgent'
        | 'agentAttribution'
      >
    >,
    successMessage: string
  ) => {
    const previousSnapshot = data;
    const optimisticRow: DealRow = { ...deal, ...updates };
    if ('expectedAmountCents' in updates && optimisticRow.referral) {
      const nextReferralFee = updates.expectedAmountCents ?? optimisticRow.referral.referralFeeDueCents ?? 0;
      optimisticRow.referral = {
        ...optimisticRow.referral,
        referralFeeDueCents: nextReferralFee,
      };
    }
    const optimistic = deals.map((row) => (row._id === deal._id ? optimisticRow : row));

    setUpdatingId(deal._id);
    await mutate(
      {
        items: optimistic,
        total: data?.total ?? optimistic.length,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 25,
      },
      false
    );

    try {
      const payload: Record<string, unknown> = { id: deal._id };
      if ('status' in updates && updates.status) {
        payload.status = updates.status;
      }
      if ('expectedAmountCents' in updates) {
        payload.expectedAmountCents = updates.expectedAmountCents ?? 0;
      }
      if ('receivedAmountCents' in updates) {
        payload.receivedAmountCents = updates.receivedAmountCents ?? 0;
      }
      if ('terminatedReason' in updates) {
        payload.terminatedReason = updates.terminatedReason ?? null;
      }
      if ('usedAfc' in updates) {
        payload.usedAfc = updates.usedAfc ?? false;
      }
      if ('usedAssignedAgent' in updates) {
        payload.usedAssignedAgent = updates.usedAssignedAgent ?? false;
      }
      if ('agentAttribution' in updates) {
        payload.agentAttribution = updates.agentAttribution ?? null;
      }

      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Unable to update deal');
      }

      toast.success(successMessage);
      await mutate();
    } catch (error) {
      console.error(error);
      await mutate(previousSnapshot, false);
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
      await mutate();
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAfcUsageChange = async (deal: DealRow, checked: boolean) => {
    if (Boolean(deal.usedAfc) === checked) {
      return;
    }

    await updateDeal(deal, { usedAfc: checked }, 'AFC usage updated');
  };

  const handleUsedAgentToggle = async (deal: DealRow, checked: boolean) => {
    if (Boolean(deal.usedAssignedAgent) === checked) {
      return;
    }

    const updates: Partial<
      Pick<
        DealRow,
        'usedAssignedAgent' | 'expectedAmountCents' | 'receivedAmountCents' | 'agentAttribution'
      >
    > = { usedAssignedAgent: checked };
    const agentAttribution: AgentAttribution = checked
      ? (deal.referral?.ahaBucket === 'AHA' || deal.referral?.ahaBucket === 'AHA_OOS'
          ? deal.referral.ahaBucket
          : null)
      : 'OUTSIDE_AGENT';
    updates.agentAttribution = agentAttribution;

    if (!checked) {
      updates.expectedAmountCents = 0;
      updates.receivedAmountCents = 0;
    } else {
      const fallbackAmount = deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
      if (fallbackAmount > 0) {
        updates.expectedAmountCents = fallbackAmount;
      }
    }

    await updateDeal(deal, updates, 'Assigned agent usage updated');
  };

  const handlePaidToggle = async (deal: DealRow, checked: boolean) => {
    if (deal.status === 'terminated') {
      return;
    }

    if (!checked) {
      return;
    }

    if (deal.status === 'paid') {
      return;
    }

    const updates: Partial<Pick<DealRow, 'status' | 'expectedAmountCents'>> = {
      status: 'paid',
    };

    const fallbackExpected = deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
    if (fallbackExpected > 0) {
      updates.expectedAmountCents = fallbackExpected;
    }

    await updateDeal(deal, updates, 'Deal status updated');
  };

  const handleAmountChange = (dealId: string, value: string) => {
    setAmountDrafts((prev) => ({ ...prev, [dealId]: value }));
  };

  const handleAmountBlur = async (deal: DealRow) => {
    const draft = amountDrafts[deal._id];
    if (draft === undefined) {
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed) {
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
      return;
    }

    const parsed = Number(trimmed.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid received amount');
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
      return;
    }

    const cents = Math.round(parsed * 100);
    if (cents === (deal.receivedAmountCents ?? 0)) {
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
      return;
    }

    await updateDeal(deal, { receivedAmountCents: cents }, 'Received amount updated');
    setAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[deal._id];
      return next;
    });
  };

  const renderReferralLink = (deal: DealRow) => {
    const label = deal.referral?.borrowerName || 'Referral';
    const href = deal.referralId ? `/referrals/${deal.referralId}` : '#';

    if (!deal.referralId) {
      return <span className="font-medium text-foreground">{label}</span>;
    }

    return (
      <Link
        prefetch={false}
        href={href}
        className="font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
      >
        {label}
      </Link>
    );
  };

  const renderAgentLink = (deal: DealRow) => {
    if (!deal.agent?.id) {
      return <span className="text-sm text-foreground-subtle">Unassigned</span>;
    }

    return (
      <Link
        prefetch={false}
        href={`/agents/${deal.agent.id}`}
        className="text-sm font-medium text-primary-700 transition hover:text-primary-800 hover:underline"
      >
        {deal.agent.name || 'Agent'}
      </Link>
    );
  };

  const renderStatusControl = (deal: DealRow) => {
    const isTerminated = deal.status === 'terminated';
    const statusLabel = normalizeStatusLabel(deal.status) || '—';
    const terminatedLabel = deal.terminatedReason
      ? TERMINATED_REASON_OPTIONS.find((option) => option.value === deal.terminatedReason)?.label ??
        deal.terminatedReason
      : null;

    return (
      <div className="space-y-1">
        <StatusPill kind="deal" status={deal.status} label={statusLabel} />
        {isTerminated && terminatedLabel && (
          <p className="text-xs text-foreground-subtle">Reason: {terminatedLabel}</p>
        )}
      </div>
    );
  };

  const renderClosingDate = (value?: string | null) => {
    return value ? formatDate(value) : '—';
  };

  const formatCentsForInput = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return '';
    }
    return (value / 100).toFixed(2);
  };

  const formatCentsForDisplay = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return '';
    }

    const dollars = value / 100;
    if (Number.isInteger(dollars)) {
      return Number(dollars).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    return Number(dollars).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const renderDealSide = (deal: DealRow) => {
    return deal.side === 'sell' || deal.referral?.dealSide === 'sell' ? 'Seller' : 'Buyer';
  };

  const renderAdminTable = () => (
    <div className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-sm">
      <table className="min-w-full divide-y divide-border">
        <thead className="sticky top-0 z-10 bg-surface-muted">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Referral" sortKey="referral" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Agent" sortKey="agent" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Deal Side" sortKey="dealSide" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Status" sortKey="status" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Closing date" sortKey="closingDate" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Address" sortKey="address" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Referral Fee" sortKey="referralFee" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Amount Received" sortKey="receivedAmount" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Used AFC" sortKey="usedAfc" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Used Agent" sortKey="usedAgent" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              <SortableHeader label="Paid" sortKey="paid" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((deal) => {
            const isTerminated = deal.status === 'terminated';
            const isSellSideDeal = deal.side === 'sell' || deal.referral?.dealSide === 'sell';
            const referralFee = isTerminated
              ? 0
              : deal.expectedAmountCents ?? deal.referral?.referralFeeDueCents ?? 0;
            const receivedDraft = amountDrafts[deal._id];
            const receivedInputValue =
              receivedDraft !== undefined
                ? receivedDraft
                : formatCentsForDisplay(deal.receivedAmountCents ?? 0);
            const usedAfc = Boolean(deal.usedAfc);
            const usedAssignedAgent = Boolean(deal.usedAssignedAgent);
            const isPaid = deal.status === 'paid';
            const isUpdating = updatingId === deal._id;

            return (
              <tr key={deal._id} className="even:bg-surface-muted/50 hover:bg-surface-subtle">
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  <div className="flex flex-col">
                    {renderReferralLink(deal)}
                    <span className="text-xs text-foreground-subtle">
                      Loan # {deal.referral?.loanFileNumber || '—'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{renderAgentLink(deal)}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{renderDealSide(deal)}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{renderStatusControl(deal)}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{renderClosingDate(deal.closingDate)}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {getDealAddress(deal) || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{isTerminated ? '—' : formatCurrency(referralFee)}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-foreground-subtle">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={receivedInputValue}
                        onChange={(event) => handleAmountChange(deal._id, event.target.value)}
                        onBlur={() => handleAmountBlur(deal)}
                        onFocus={() => {
                          setAmountDrafts((prev) => {
                            if (prev[deal._id] !== undefined) {
                              return prev;
                            }
                            return {
                              ...prev,
                              [deal._id]: formatCentsForInput(deal.receivedAmountCents ?? 0),
                            };
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                          if (event.key === 'Escape') {
                            setAmountDrafts((prev) => {
                              const next = { ...prev };
                              delete next[deal._id];
                              return next;
                            });
                            event.currentTarget.blur();
                          }
                        }}
                        className="w-28 rounded border border-border px-2 py-1 text-sm text-foreground-muted focus:border-primary-500 focus:outline-none"
                        disabled={isUpdating}
                      />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {isTerminated ? (
                    '—'
                  ) : isSellSideDeal ? (
                    'N/A'
                  ) : (
                    <div className="flex items-center gap-2">
                      <ToggleSwitch
                        label="Mark referral as using AFC"
                        checked={usedAfc}
                        onChange={(nextValue) => handleAfcUsageChange(deal, nextValue)}
                        disabled={isUpdating || isSellSideDeal}
                      />
                      <span className="text-sm text-foreground-muted">{usedAfc ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-2">
                      <ToggleSwitch
                        label="Mark referral as using the assigned agent"
                        checked={usedAssignedAgent}
                        onChange={(nextValue) => handleUsedAgentToggle(deal, nextValue)}
                        disabled={isUpdating}
                      />
                      <span className="text-sm text-foreground-muted">{usedAssignedAgent ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-2">
                      <ToggleSwitch
                        label="Mark deal as paid"
                        checked={isPaid}
                        onChange={(nextValue) => handlePaidToggle(deal, nextValue)}
                        disabled={isUpdating || isPaid}
                      />
                      <span className="text-sm text-foreground-muted">{isPaid ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const defaultDealRowModels = isAdminView
    ? []
    : deals.map((deal) => {
        const commission = calculateCommission(deal);
        const isTerminated = deal.status === 'terminated';
        const isSellSideDeal = deal.side === 'sell' || deal.referral?.dealSide === 'sell';
        const paidAmount = isTerminated
          ? 0
          : deal.status === 'paid'
            ? deal.receivedAmountCents || deal.expectedAmountCents || 0
            : deal.receivedAmountCents || 0;
        const referralFee = isTerminated
          ? 0
          : deal.expectedAmountCents ?? deal.referral?.referralFeeDueCents ?? 0;
        const netCommission = isTerminated ? 0 : commission - referralFee;
        const outcome = (() => {
          if (isTerminated) {
            return 'Lost';
          }
          if (isMcView && isSellSideDeal) {
            return 'N/A';
          }
          const basis = isMcView ? deal.usedAfc : deal.usedAssignedAgent;
          if (basis === null || basis === undefined) {
            return 'Pending';
          }
          return basis ? 'Won' : 'Lost';
        })();
        const outcomeColor =
          outcome === 'Won'
            ? 'text-foreground'
            : outcome === 'Lost'
              ? 'text-rose-600'
              : outcome === 'N/A'
                ? 'text-foreground-subtle'
                : 'text-foreground-subtle';

        return {
          deal,
          commission,
          isTerminated,
          paidAmount,
          referralFee,
          netCommission,
          outcome,
          outcomeColor,
        };
      });

  const renderDefaultTable = () => (
    <>
      <div className="space-y-3 md:hidden">
        {defaultDealRowModels.map(
          ({ deal, commission, isTerminated, paidAmount, referralFee, netCommission, outcome, outcomeColor }) =>
            isAgentView ? (
              <div
                key={deal._id}
                className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
              >
                {/* Header zone */}
                <div className="flex items-start justify-between gap-3 bg-surface-muted px-4 pt-4 pb-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-foreground break-words">
                      {renderReferralLink(deal)}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground-subtle">
                      {getDealAddress(deal) || `Loan # ${deal.referral?.loanFileNumber || '—'}`}
                    </p>
                  </div>
                  <Badge
                    variant={outcome === 'Won' ? 'success' : outcome === 'Lost' ? 'danger' : 'neutral'}
                    className="shrink-0"
                  >
                    {outcome}
                  </Badge>
                </div>

                {/* Status + closing date row */}
                <div className="px-4 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Status</p>
                      <div className="text-sm text-foreground">{renderStatusControl(deal)}</div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Closing date</p>
                      <p className="text-sm text-foreground">{renderClosingDate(deal.closingDate)}</p>
                    </div>
                  </div>

                  {/* Financial section */}
                  <div className="rounded-md bg-surface-muted p-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Referral fee</p>
                        <p className="text-sm font-semibold text-foreground">{isTerminated ? '—' : formatCurrency(referralFee || 0)}</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Fee paid</p>
                        <p className="text-sm font-semibold text-foreground">{isTerminated ? '—' : formatCurrency(paidAmount)}</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Commission</p>
                        <p className="text-sm text-foreground-muted">{isTerminated ? '—' : formatCurrency(commission)}</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Net commission</p>
                        <p className="text-sm font-semibold text-foreground">{isTerminated ? '—' : formatCurrency(netCommission)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={deal._id}
                className="space-y-3 rounded-card border border-border bg-surface-raised p-4 shadow-card"
              >
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Referral</p>
                  <div className="text-sm text-foreground">
                    <div className="flex flex-col gap-0.5 break-words">
                      {renderReferralLink(deal)}
                      <span className="text-xs text-foreground-subtle">
                        {getDealAddress(deal) || `Loan # ${deal.referral?.loanFileNumber || '—'}`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Status</p>
                  <div className="text-sm text-foreground">{renderStatusControl(deal)}</div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Closing date</p>
                  <p className="text-sm text-foreground">{renderClosingDate(deal.closingDate)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Outcome</p>
                  <p className={`text-sm font-medium ${outcomeColor}`}>{outcome}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Referral fee</p>
                  <p className="text-sm text-foreground">{isTerminated ? '—' : formatCurrency(referralFee || 0)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Paid</p>
                  <p className="text-sm text-foreground">{isTerminated ? '—' : formatCurrency(paidAmount)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Commission</p>
                  <p className="text-sm text-foreground">{isTerminated ? '—' : formatCurrency(commission)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Net commission</p>
                  <p className="text-sm text-foreground">{isTerminated ? '—' : formatCurrency(netCommission)}</p>
                </div>
              </div>
            )
        )}
      </div>
      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface-raised shadow-sm md:block">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Referral" sortKey="referral" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Status" sortKey="status" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Closing date" sortKey="closingDate" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Outcome" sortKey="outcome" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Referral Fee" sortKey="referralFee" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label={isAgentView ? 'Referral Fee Paid' : 'Paid'} sortKey="receivedAmount" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Commission" sortKey="commission" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Net Commission" sortKey="netCommission" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {defaultDealRowModels.map(
              ({ deal, commission, isTerminated, paidAmount, referralFee, netCommission, outcome, outcomeColor }) => (
                <tr key={deal._id} className="even:bg-surface-muted/50 hover:bg-surface-subtle">
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    <div className="flex flex-col">
                      {renderReferralLink(deal)}
                      <span className="text-xs text-foreground-subtle">
                        {getDealAddress(deal) || `Loan # ${deal.referral?.loanFileNumber || '—'}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{renderStatusControl(deal)}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{renderClosingDate(deal.closingDate)}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${outcomeColor}`}>{outcome}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{isTerminated ? '—' : formatCurrency(referralFee || 0)}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{isTerminated ? '—' : formatCurrency(paidAmount)}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{isTerminated ? '—' : formatCurrency(commission)}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{isTerminated ? '—' : formatCurrency(netCommission)}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-subtle" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-xl bg-surface-subtle" />
          <div className="h-20 animate-pulse rounded-xl bg-surface-subtle" />
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-surface-subtle" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Deals</h1>
          <p className="text-sm text-foreground-subtle">
            {data
              ? `${data.total} ${hasActiveFilters ? 'filtered ' : ''}deal${data.total !== 1 ? 's' : ''}`
              : 'Loading...'}
            {timeframe !== 'all' && isAdminView ? ` · ${timeframeLabel}` : ''}
          </p>
        </div>
        {isAdminView && (
          <div className="flex flex-col items-end gap-2">
            <TimeframeDropdown
              timeframe={timeframe}
              rangeLabel={timeframeLabel}
              customRange={customRange}
              onPresetSelect={handlePresetSelect}
              onCustomRangeSelect={handleCustomRangeSelect}
              maxDate={maxSelectableDate}
            />
          </div>
        )}
      </div>
      <div className="space-y-4 rounded-xl border border-border bg-surface-muted/50 p-4">
        <label className="flex flex-col text-xs font-semibold text-foreground-muted">
          Search
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => handleSearchInput(event.target.value)}
            className="mt-2 w-full rounded-lg border border-border bg-surface-raised px-4 py-3 text-base shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Borrower, address, loan #, agent"
          />
        </label>
        {isAdminView && (
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div ref={statusMenuRef} className="relative min-w-0 flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
              Status
              <div className="relative mt-1">
                <button
                  type="button"
                  onClick={() => setIsStatusMenuOpen((open) => !open)}
                  disabled={isPending}
                  className="flex w-full items-center justify-between gap-2 rounded border border-border bg-surface-raised px-3 py-2 text-left text-sm normal-case text-foreground-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="truncate">
                    {statusFilters.length > 0
                      ? `${statusFilters.length} status${statusFilters.length > 1 ? 'es' : ''} selected`
                      : 'All statuses'}
                  </span>
                  <span className="text-foreground-subtle">&#9662;</span>
                </button>
                {isStatusMenuOpen && (
                  <div className="absolute left-0 right-0 z-30 mt-1 max-h-60 w-full overflow-y-auto rounded border border-border bg-surface-raised py-1 shadow-lg">
                    <div className="mb-2 flex items-center justify-between px-3 pt-1 text-xs font-semibold text-foreground-muted">
                      <span>Filter statuses</span>
                      <button
                        type="button"
                        className="text-primary-700 hover:text-primary-700/80"
                        onClick={() => updateParams({ status: '' })}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-60 space-y-2 overflow-auto px-2 pb-2">
                      {STATUS_FILTER_OPTIONS.map(({ value, label }) => (
                        <label
                          key={value}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
                        >
                          <span className="text-foreground-muted">{label}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border-strong text-primary-700 focus:ring-primary-500"
                            checked={statusFilters.includes(value as DealStatus)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              const newFilters = checked
                                ? [...statusFilters, value as DealStatus]
                                : statusFilters.filter((status) => status !== value);
                              updateParams({ status: newFilters.length > 0 ? newFilters.join(',') : '' });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div ref={designationMenuRef} className="relative min-w-0 flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
              Agent Designation
              <div className="relative mt-1">
                <button
                  type="button"
                  onClick={() => setIsDesignationMenuOpen((open) => !open)}
                  disabled={isPending}
                  className="flex w-full items-center justify-between gap-2 rounded border border-border bg-surface-raised px-3 py-2 text-left text-sm normal-case text-foreground-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="truncate">
                    {designationFilters.length > 0
                      ? `${designationFilters.length} designation${designationFilters.length > 1 ? 's' : ''} selected`
                      : 'All designations'}
                  </span>
                  <span className="text-foreground-subtle">&#9662;</span>
                </button>
                {isDesignationMenuOpen && (
                  <div className="absolute left-0 right-0 z-30 mt-1 max-h-60 w-full overflow-y-auto rounded border border-border bg-surface-raised py-1 shadow-lg">
                    <div className="mb-2 flex items-center justify-between px-3 pt-1 text-xs font-semibold text-foreground-muted">
                      <span>Filter by designation</span>
                      <button
                        type="button"
                        className="text-primary-700 hover:text-primary-700/80"
                        onClick={() => updateParams({ designation: '' })}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-60 space-y-2 overflow-auto px-2 pb-2">
                      {DESIGNATION_FILTER_OPTIONS.map(({ value, label }) => (
                        <label
                          key={value}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
                        >
                          <span className="text-foreground-muted">{label}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border-strong text-primary-700 focus:ring-primary-500"
                            checked={designationFilters.includes(value)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              const newFilters = checked
                                ? [...designationFilters, value]
                                : designationFilters.filter((d) => d !== value);
                              updateParams({ designation: newFilters.length > 0 ? newFilters.join(',') : '' });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <label className="flex min-w-0 flex-col text-xs font-semibold uppercase text-foreground-subtle">
              Used Agent
              <select
                value={usedAgentFilter}
                onChange={(event) =>
                  updateParams({ usedAgent: event.target.value as TriStateFilterValue })
                }
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isPending}
              >
                <option value="all">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="flex min-w-0 flex-col text-xs font-semibold uppercase text-foreground-subtle">
              Used AFC
              <select
                value={usedAfcFilter}
                onChange={(event) =>
                  updateParams({ usedAfc: event.target.value as TriStateFilterValue })
                }
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isPending}
              >
                <option value="all">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>
        )}
      </div>
      {summarySection}
      {deals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface-raised py-16">
          <p className="text-lg font-medium text-foreground-subtle">No deals found</p>
          <p className="mt-1 text-sm text-foreground-subtle">Try adjusting your filters or timeframe</p>
        </div>
      ) : (
        isAdminView ? renderAdminTable() : renderDefaultTable()
      )}
      {data && (
        <Pagination
          currentPage={data.page}
          totalItems={data.total}
          pageSize={data.pageSize}
          totalPages={Math.ceil(data.total / data.pageSize)}
          itemLabel="deals"
        />
      )}
    </div>
  );
}
