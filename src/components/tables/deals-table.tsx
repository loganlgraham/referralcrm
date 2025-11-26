'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { toast } from 'sonner';

import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatDate } from '@/utils/formatters';

type DealStatus =
  | 'under_contract'
  | 'past_inspection'
  | 'past_appraisal'
  | 'clear_to_close'
  | 'closed'
  | 'payment_sent'
  | 'paid'
  | 'terminated';
type TerminatedReason = 'inspection' | 'appraisal' | 'financing' | 'changed_mind';
type AgentAttribution = 'AHA' | 'AHA_OOS' | 'OUTSIDE_AGENT' | null;
const STATUS_LABELS: Record<DealStatus, string> = {
  under_contract: 'Under Contract',
  past_inspection: 'Past Inspection',
  past_appraisal: 'Past Appraisal',
  clear_to_close: 'Clear to Close',
  closed: 'Closed',
  payment_sent: 'Payment Sent',
  paid: 'Paid',
  terminated: 'Terminated',
};

const TERMINATED_REASON_OPTIONS: { value: TerminatedReason; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'financing', label: 'Financing' },
  { value: 'changed_mind', label: 'Changed Mind' },
];

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
  agentDesignation?: 'AHA' | 'AHA_OOS' | null;
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
  } | null;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
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
        checked ? 'bg-brand' : 'bg-slate-200'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function DealsTable() {
  const { data: session } = useSession();
  const { data, mutate } = useSWR<DealRow[]>('/api/payments', fetcher);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [classificationFilter, setClassificationFilter] = useState<'all' | 'AHA' | 'AHA_OOS'>(
    'all'
  );
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(
    null
  );

  const getDealAddress = (deal: DealRow) => {
    const address = (deal.propertyAddress ?? deal.referral?.propertyAddress ?? '').trim();
    return address || null;
  };
  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading deals…</div>;
  }

  const role = session?.user?.role;
  const isAgentView = role === 'agent';
  const isMcView = role === 'mc';
  const isAdminView = role === 'admin' || role === 'manager';

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

  const filteredDeals = data.filter((deal) => {
    if (classificationFilter === 'all') {
      return true;
    }

    return deal.agentDesignation === classificationFilter;
  });

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
    setSortConfig((previous) => {
      if (previous?.key === key) {
        return { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const sortedDeals = useMemo(() => {
    const rows = [...filteredDeals];
    if (!sortConfig) {
      return rows;
    }

    const getSortValue = (deal: DealRow, key: SortKey): string | number => {
      const isTerminated = deal.status === 'terminated';
      const referralFee = isTerminated
        ? 0
        : deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
      const paidAmount = isTerminated
        ? 0
        : deal.status === 'paid'
          ? deal.receivedAmountCents || deal.expectedAmountCents || 0
          : deal.receivedAmountCents || 0;
      const commission = calculateCommission(deal);
      const netCommission = isTerminated ? 0 : commission - paidAmount;
      const outcome = (() => {
        if (isTerminated) {
          return 'Lost';
        }
        const basis = isMcView ? deal.usedAfc : deal.usedAssignedAgent;
        if (basis === null || basis === undefined) {
          return 'Pending';
        }
        return basis ? 'Won' : 'Lost';
      })();

      switch (key) {
        case 'referral':
          return (deal.referral?.borrowerName || '').toLowerCase();
        case 'agent':
          return (deal.agent?.name || '').toLowerCase();
        case 'dealSide':
          return deal.side === 'sell' || deal.referral?.dealSide === 'sell' ? 'sell' : 'buy';
        case 'status':
          return (STATUS_LABELS[deal.status] ?? deal.status).toLowerCase();
        case 'closingDate':
          return deal.closingDate ? new Date(deal.closingDate).getTime() : 0;
        case 'address':
          return (getDealAddress(deal) || '').toLowerCase();
        case 'referralFee':
          return referralFee;
        case 'receivedAmount':
          return paidAmount;
        case 'usedAfc':
          return Number(Boolean(deal.usedAfc));
        case 'usedAgent':
          return Number(Boolean(deal.usedAssignedAgent));
        case 'paid':
          return Number(deal.status === 'paid');
        case 'outcome':
          return outcome.toLowerCase();
        case 'commission':
          return commission;
        case 'netCommission':
          return netCommission;
        default:
          return 0;
      }
    };

    return rows.sort((a, b) => {
      const aValue = getSortValue(a, sortConfig.key);
      const bValue = getSortValue(b, sortConfig.key);

      const direction = sortConfig.direction === 'asc' ? 1 : -1;

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction;
      }

      return (
        String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' }) * direction
      );
    });
  }, [filteredDeals, sortConfig, isMcView]);

  const SortableHeader = ({ label, sortKey }: { label: string; sortKey: SortKey }) => {
    const direction = sortConfig?.key === sortKey ? sortConfig.direction : null;
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

  const aggregates = filteredDeals.reduce(
    (acc, row) => {
      const isTerminated = row.status === 'terminated';

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
      const expected = isTerminated ? 0 : expectedBase;
      const paidAmount =
        row.status === 'paid'
          ? row.receivedAmountCents || row.expectedAmountCents || 0
          : 0;
      const effectivePaid = isTerminated ? 0 : paidAmount;
      const commission = calculateCommission(row);

      acc.expectedRevenue += expected;
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

  const totalCommission = aggregates.commissionEarned - aggregates.referralFeesPaid;

  const summarySection = (() => {
    if (isAdminView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Expected Revenue" value={formatCurrency(aggregates.expectedRevenue)} />
          <SummaryCard label="Received Revenue" value={formatCurrency(aggregates.receivedRevenue)} />
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
    const optimistic = data.map((row) => (row._id === deal._id ? optimisticRow : row));

    setUpdatingId(deal._id);
    await mutate(optimistic, false);

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
      return <span className="font-medium text-slate-900">{label}</span>;
    }

    return (
      <Link
        prefetch={false}
        href={href}
        className="font-medium text-brand transition hover:text-brand-dark hover:underline"
      >
        {label}
      </Link>
    );
  };

  const renderAgentLink = (deal: DealRow) => {
    if (!deal.agent?.id) {
      return <span className="text-sm text-slate-500">Unassigned</span>;
    }

    return (
      <Link
        prefetch={false}
        href={`/agents/${deal.agent.id}`}
        className="text-sm font-medium text-brand transition hover:text-brand-dark hover:underline"
      >
        {deal.agent.name || 'Agent'}
      </Link>
    );
  };

  const renderStatusControl = (deal: DealRow) => {
    const isTerminated = deal.status === 'terminated';
    const statusLabel = STATUS_LABELS[deal.status] ?? deal.status;
    const terminatedLabel = deal.terminatedReason
      ? TERMINATED_REASON_OPTIONS.find((option) => option.value === deal.terminatedReason)?.label ??
        deal.terminatedReason
      : null;

    return (
      <div className="space-y-1">
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          {statusLabel}
        </span>
        {isTerminated && terminatedLabel && (
          <p className="text-xs text-slate-500">Reason: {terminatedLabel}</p>
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Referral" sortKey="referral" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Agent" sortKey="agent" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Deal Side" sortKey="dealSide" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Status" sortKey="status" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Closing date" sortKey="closingDate" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Address" sortKey="address" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Referral Fee" sortKey="referralFee" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Amount Received" sortKey="receivedAmount" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Used AFC" sortKey="usedAfc" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Used Agent" sortKey="usedAgent" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Paid" sortKey="paid" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedDeals.map((deal) => {
            const isTerminated = deal.status === 'terminated';
            const referralFee = isTerminated
              ? 0
              : deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
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
              <tr key={deal._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="flex flex-col">
                    {renderReferralLink(deal)}
                    <span className="text-xs text-slate-500">
                      Loan # {deal.referral?.loanFileNumber || '—'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderAgentLink(deal)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderDealSide(deal)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderStatusControl(deal)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderClosingDate(deal.closingDate)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {getDealAddress(deal) || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(referralFee)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">$</span>
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
                        className="w-28 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 focus:border-brand focus:outline-none"
                        disabled={isUpdating}
                      />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-2">
                      <ToggleSwitch
                        label="Mark referral as using AFC"
                        checked={usedAfc}
                        onChange={(nextValue) => handleAfcUsageChange(deal, nextValue)}
                        disabled={isUpdating}
                      />
                      <span className="text-sm text-slate-700">{usedAfc ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
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
                      <span className="text-sm text-slate-700">{usedAssignedAgent ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
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
                      <span className="text-sm text-slate-700">{isPaid ? 'Yes' : 'No'}</span>
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

  const renderDefaultTable = () => (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Referral" sortKey="referral" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Status" sortKey="status" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Closing date" sortKey="closingDate" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Outcome" sortKey="outcome" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Referral Fee" sortKey="referralFee" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label={isAgentView ? 'Referral Fee Paid' : 'Paid'} sortKey="receivedAmount" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Commission" sortKey="commission" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SortableHeader label="Net Commission" sortKey="netCommission" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedDeals.map((deal) => {
            const commission = calculateCommission(deal);
            const isTerminated = deal.status === 'terminated';
            const paidAmount = isTerminated
              ? 0
              : deal.status === 'paid'
                ? deal.receivedAmountCents || deal.expectedAmountCents || 0
                : deal.receivedAmountCents || 0;
            const referralFee = isTerminated
              ? 0
              : deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents;
            const netCommission = isTerminated ? 0 : commission - paidAmount;
            const outcome = (() => {
              if (isTerminated) {
                return 'Lost';
              }
              const basis = isMcView ? deal.usedAfc : deal.usedAssignedAgent;
              if (basis === null || basis === undefined) {
                return 'Pending';
              }
              return basis ? 'Won' : 'Lost';
            })();
            const outcomeColor =
              outcome === 'Won'
                ? 'text-emerald-600'
                : outcome === 'Lost'
                  ? 'text-rose-600'
                  : 'text-slate-500';

            return (
              <tr key={deal._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="flex flex-col">
                    {renderReferralLink(deal)}
                    <span className="text-xs text-slate-500">
                      {getDealAddress(deal) || `Loan # ${deal.referral?.loanFileNumber || '—'}`}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderStatusControl(deal)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderClosingDate(deal.closingDate)}</td>
                <td className={`px-4 py-3 text-sm font-medium ${outcomeColor}`}>{outcome}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(referralFee || 0)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(paidAmount)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(commission)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(netCommission)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">Filter:</span>
        {[
          { label: 'All Deals', value: 'all' as const },
          { label: 'AHA', value: 'AHA' as const },
          { label: 'AHA OOS', value: 'AHA_OOS' as const },
        ].map((option) => {
          const isActive = classificationFilter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setClassificationFilter(option.value)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                isActive
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-brand hover:text-brand'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {summarySection}
      {isAdminView ? renderAdminTable() : renderDefaultTable()}
    </div>
  );
}
