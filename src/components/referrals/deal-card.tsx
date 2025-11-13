'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { formatCurrency } from '@/utils/formatters';

export type DealStatus =
  | 'under_contract'
  | 'past_inspection'
  | 'past_appraisal'
  | 'clear_to_close'
  | 'closed'
  | 'payment_sent'
  | 'paid'
  | 'terminated';
export type TerminatedReason = 'inspection' | 'appraisal' | 'financing' | 'changed_mind';
export type AgentSelectValue = '' | 'AHA' | 'AHA_OOS' | 'OUTSIDE_AGENT';

const TERMINATED_REASON_OPTIONS: { value: TerminatedReason; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'financing', label: 'Financing' },
  { value: 'changed_mind', label: 'Changed Mind' },
];

export interface DealRecord {
  _id: string;
  status?: DealStatus | null;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  paidDate?: string | null;
  terminatedReason?: TerminatedReason | null;
  agentAttribution?: AgentSelectValue;
  usedAfc?: boolean | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
}

export interface DealOverrides {
  referralFeeDueCents?: number;
  propertyAddress?: string;
  contractPriceCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  dealSide?: 'buy' | 'sell';
  hasUnsavedContractChanges?: boolean;
}

export interface DealSummaryInfo {
  borrowerName?: string | null;
  statusLabel?: string | null;
  propertyAddress?: string | null;
  contractPriceCents?: number | null;
  referralFeeDueCents?: number | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  dealSide?: 'buy' | 'sell' | null;
}

export interface ReferralDealProps {
  referral: {
    _id: string;
    propertyAddress?: string;
    lookingInZip?: string | null;
    referralFeeDueCents?: number | null;
    payments?: DealRecord[] | null;
    ahaBucket?: AgentSelectValue | null;
    dealSide?: 'buy' | 'sell' | null;
  };
  overrides?: DealOverrides;
  summary?: DealSummaryInfo;
}

const STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'past_inspection', label: 'Past Inspection' },
  { value: 'past_appraisal', label: 'Past Appraisal' },
  { value: 'clear_to_close', label: 'Clear to Close' },
  { value: 'closed', label: 'Closed' },
  { value: 'payment_sent', label: 'Payment Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'terminated', label: 'Terminated' }
];

const normalizeDeals = (deals: DealRecord[] | null | undefined): DealRecord[] => {
  if (!Array.isArray(deals)) {
    return [];
  }

  return deals
    .map((deal) => ({
      _id: deal._id,
      status: (deal.status as DealStatus | undefined) ?? 'under_contract',
      expectedAmountCents: deal.expectedAmountCents ?? 0,
      receivedAmountCents: deal.receivedAmountCents ?? 0,
      createdAt: deal.createdAt ?? null,
      updatedAt: deal.updatedAt ?? null,
      paidDate: deal.paidDate ?? null,
      terminatedReason: (deal.terminatedReason as TerminatedReason | undefined) ?? null,
      agentAttribution: (deal.agentAttribution as AgentSelectValue | undefined) ?? '',
      usedAfc: deal.usedAfc ?? false,
      commissionBasisPoints: deal.commissionBasisPoints ?? null,
      referralFeeBasisPoints: deal.referralFeeBasisPoints ?? null,
      side: deal.side ?? null,
    }))
    .sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
};

export function DealCard({ referral, overrides, summary }: ReferralDealProps) {
  const router = useRouter();
  const [deals, setDeals] = useState<DealRecord[]>(() => normalizeDeals(referral.payments));

  useEffect(() => {
    setDeals(normalizeDeals(referral.payments));
  }, [referral.payments]);

  const initialStatusMap = useMemo(() => {
    const snapshot: Record<string, DealStatus> = {};
    deals.forEach((deal) => {
      snapshot[deal._id] = (deal.status as DealStatus | undefined) ?? 'under_contract';
    });
    return snapshot;
  }, [deals]);

  const initialReasonMap = useMemo(() => {
    const snapshot: Record<string, TerminatedReason> = {};
    deals.forEach((deal) => {
      if (deal.terminatedReason) {
        snapshot[deal._id] = deal.terminatedReason;
      }
    });
    return snapshot;
  }, [deals]);

  const [statusMap, setStatusMap] = useState<Record<string, DealStatus>>(initialStatusMap);
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [reasonMap, setReasonMap] = useState<Record<string, TerminatedReason>>(initialReasonMap);
  const initialAgentMap = useMemo(() => {
    const snapshot: Record<string, AgentSelectValue> = {};
    deals.forEach((deal) => {
      snapshot[deal._id] = (deal.agentAttribution as AgentSelectValue | undefined) ?? '';
    });
    return snapshot;
  }, [deals]);
  const [agentMap, setAgentMap] = useState<Record<string, AgentSelectValue>>(initialAgentMap);
  const initialAfcMap = useMemo(() => {
    const snapshot: Record<string, boolean> = {};
    deals.forEach((deal) => {
      snapshot[deal._id] = Boolean(deal.usedAfc);
    });
    return snapshot;
  }, [deals]);
  const [afcMap, setAfcMap] = useState<Record<string, boolean>>(initialAfcMap);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setStatusMap(initialStatusMap);
  }, [initialStatusMap]);

  useEffect(() => {
    setReasonMap(initialReasonMap);
  }, [initialReasonMap]);

  useEffect(() => {
    setAgentMap(initialAgentMap);
  }, [initialAgentMap]);

  useEffect(() => {
    setAfcMap(initialAfcMap);
  }, [initialAfcMap]);

  useEffect(() => {
    setExpandedMap((previous) => {
      const next: Record<string, boolean> = {};
      deals.forEach((deal) => {
        next[deal._id] = previous[deal._id] ?? false;
      });
      return next;
    });
  }, [deals]);

  const propertyLabel =
    overrides?.propertyAddress ||
    referral.propertyAddress ||
    (referral.lookingInZip ? `Looking in ${referral.lookingInZip}` : 'Pending address');

  const summaryBorrower = summary?.borrowerName?.trim() ? summary.borrowerName.trim() : null;
  const summaryStatusLabel = summary?.statusLabel?.trim() ? summary.statusLabel.trim() : null;
  const summaryAddress = overrides?.propertyAddress ?? summary?.propertyAddress ?? propertyLabel;
  const summaryContractPriceCents =
    overrides?.contractPriceCents ?? summary?.contractPriceCents ?? null;
  const summaryReferralFeeCents =
    overrides?.referralFeeDueCents ?? summary?.referralFeeDueCents ?? referral.referralFeeDueCents ?? null;
  const summaryCommissionBasisPoints =
    overrides?.commissionBasisPoints ?? summary?.commissionBasisPoints ?? null;
  const summaryReferralFeeBasisPoints =
    overrides?.referralFeeBasisPoints ?? summary?.referralFeeBasisPoints ?? null;
  const summaryDealSide = overrides?.dealSide ?? summary?.dealSide ?? referral.dealSide ?? 'buy';

  const summaryContractPriceDisplay = summaryContractPriceCents
    ? formatCurrency(summaryContractPriceCents)
    : '—';
  const summaryReferralFeeDisplay =
    summaryReferralFeeCents != null ? formatCurrency(summaryReferralFeeCents) : '—';

  const summaryCommissionCents =
    summaryContractPriceCents && summaryCommissionBasisPoints
      ? Math.round((summaryContractPriceCents * summaryCommissionBasisPoints) / 10000)
      : null;
  const summaryNetCommissionCents =
    summaryCommissionCents != null
      ? summaryCommissionCents - (summaryReferralFeeCents ?? 0)
      : null;
  const summaryNetCommissionDisplay =
    summaryNetCommissionCents != null ? formatCurrency(summaryNetCommissionCents) : '—';
  const summaryCommissionPercentDisplay = summaryCommissionBasisPoints
    ? `${(summaryCommissionBasisPoints / 100).toFixed(2)}%`
    : '—';
  const summaryReferralFeePercentDisplay = summaryReferralFeeBasisPoints
    ? `${(summaryReferralFeeBasisPoints / 100).toFixed(2)}%`
    : '—';
  const summaryDealSideDisplay = summaryDealSide === 'sell' ? 'Sell-side' : 'Buy-side';

  const getStatusForDeal = (deal: DealRecord): DealStatus => {
    return statusMap[deal._id] ?? ((deal.status as DealStatus | undefined) ?? 'under_contract');
  };

  const handleDeleteDeal = (deal: DealRecord) => async () => {
    const confirmed = window.confirm('Delete this deal? This action cannot be undone.');
    if (!confirmed) {
      return;
    }

    setSavingMap((prev) => ({ ...prev, [deal._id]: true }));

    try {
      const response = await fetch('/api/payments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal._id }),
      });

      if (!response.ok) {
        throw new Error('Unable to delete deal');
      }

      setDeals((previous) => previous.filter((item) => item._id !== deal._id));
      setStatusMap((previous) => {
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
      setReasonMap((previous) => {
        if (!(deal._id in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
      setAgentMap((previous) => {
        if (!(deal._id in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
      setAfcMap((previous) => {
        if (!(deal._id in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
      setExpandedMap((previous) => {
        if (!(deal._id in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });

      router.refresh();
      toast.success('Deal deleted');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to delete deal');
    } finally {
      setSavingMap((previous) => {
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
    }
  };

  const activeDealId = (() => {
    for (const deal of deals) {
      if (getStatusForDeal(deal) !== 'terminated') {
        return deal._id;
      }
    }
    return undefined;
  })();

  const computeExpectedAmount = (deal: DealRecord): number => {
    const status = getStatusForDeal(deal);
    if (status === 'terminated') {
      return 0;
    }

    if (activeDealId && deal._id === activeDealId) {
      if (overrides?.referralFeeDueCents !== undefined) {
        return overrides.referralFeeDueCents;
      }
    }

    if (deal.expectedAmountCents && deal.expectedAmountCents > 0) {
      return deal.expectedAmountCents;
    }

    return referral.referralFeeDueCents ?? 0;
  };

  const handleStatusChange = (deal: DealRecord) => async (event: ChangeEvent<HTMLSelectElement>) => {
    const selectEl = event.target;
    const nextStatus = selectEl.value as DealStatus;
    const previousStatus = getStatusForDeal(deal);

    const expectedAmountCents = computeExpectedAmount(deal);

    if (nextStatus !== 'terminated' && expectedAmountCents <= 0) {
      toast.error('Add contract details before updating deal status.');
      selectEl.value = previousStatus;
      return;
    }

    setStatusMap((prev) => ({ ...prev, [deal._id]: nextStatus }));
    setSavingMap((prev) => ({ ...prev, [deal._id]: true }));

    try {
      const payload: Record<string, unknown> = { id: deal._id, status: nextStatus };

      if (nextStatus === 'terminated') {
        payload.expectedAmountCents = 0;
        payload.receivedAmountCents = 0;
        const reason = reasonMap[deal._id] ?? deal.terminatedReason ?? 'inspection';
        payload.terminatedReason = reason;
        setReasonMap((prev) => ({ ...prev, [deal._id]: reason }));
      } else if (expectedAmountCents > 0) {
        payload.expectedAmountCents = expectedAmountCents;
        payload.terminatedReason = null;
        setReasonMap((prev) => {
          if (!(deal._id in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[deal._id];
          return next;
        });
      }

      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Unable to update deal');
      }

      toast.success('Deal status saved');
    } catch (error) {
      console.error(error);
      setStatusMap((prev) => ({ ...prev, [deal._id]: previousStatus }));
      selectEl.value = previousStatus;
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
    } finally {
      setSavingMap((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
    }
  };

  const handleReasonChange = (deal: DealRecord) => async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextReason = event.target.value as TerminatedReason;
    setReasonMap((prev) => ({ ...prev, [deal._id]: nextReason }));

    if (getStatusForDeal(deal) !== 'terminated') {
      return;
    }

    setSavingMap((prev) => ({ ...prev, [deal._id]: true }));
    try {
      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal._id, terminatedReason: nextReason }),
      });

      if (!response.ok) {
        throw new Error('Unable to update deal');
      }

      toast.success('Termination reason saved');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
    } finally {
      setSavingMap((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
    }
  };

  const handleAgentAttributionChange = (deal: DealRecord) => async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value as AgentSelectValue;
    const previousValue = agentMap[deal._id] ?? '';

    if (nextValue === previousValue) {
      return;
    }

    setAgentMap((prev) => ({ ...prev, [deal._id]: nextValue }));
    setSavingMap((prev) => ({ ...prev, [deal._id]: true }));

    try {
      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal._id, agentAttribution: nextValue || null }),
      });

      if (!response.ok) {
        throw new Error('Unable to update agent outcome');
      }

      toast.success('Agent outcome saved');
    } catch (error) {
      console.error(error);
      setAgentMap((prev) => ({ ...prev, [deal._id]: previousValue }));
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
    } finally {
      setSavingMap((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
    }
  };

  const handleAfcToggle = (deal: DealRecord) => async (event: ChangeEvent<HTMLInputElement>) => {
    const nextChecked = event.target.checked;
    const previousChecked = afcMap[deal._id] ?? false;

    if (nextChecked === previousChecked) {
      return;
    }

    setAfcMap((prev) => ({ ...prev, [deal._id]: nextChecked }));
    setSavingMap((prev) => ({ ...prev, [deal._id]: true }));

    try {
      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal._id, usedAfc: nextChecked }),
      });

      if (!response.ok) {
        throw new Error('Unable to update AFC usage');
      }

      toast.success('AFC usage saved');
    } catch (error) {
      console.error(error);
      setAfcMap((prev) => ({ ...prev, [deal._id]: previousChecked }));
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
    } finally {
      setSavingMap((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
    }
  };

  const sortedDeals = useMemo(() => {
    return [...deals].sort((a, b) => {
      const statusA = getStatusForDeal(a);
      const statusB = getStatusForDeal(b);

      if (statusA === 'terminated' && statusB !== 'terminated') {
        return 1;
      }
      if (statusB === 'terminated' && statusA !== 'terminated') {
        return -1;
      }

      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [deals, statusMap]);

  const renderDeal = (deal: DealRecord, index: number) => {
    const status = getStatusForDeal(deal);
    const isPrimary = activeDealId ? deal._id === activeDealId : index === 0;
    const expectedAmountCents = computeExpectedAmount(deal);
    const formattedAmount =
      status === 'terminated'
        ? '—'
        : expectedAmountCents > 0
          ? formatCurrency(expectedAmountCents)
          : '—';
    const isSaving = savingMap[deal._id] ?? false;
    const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
    const selectedReason = reasonMap[deal._id] ?? deal.terminatedReason ?? 'inspection';
    const agentSelection = agentMap[deal._id] ?? '';
    const usedAfc = afcMap[deal._id] ?? false;
    const assignedBucket = referral.ahaBucket ?? null;
    const matchesAssigned = !assignedBucket || agentSelection === assignedBucket || agentSelection === '';
    const dealCommissionBasisPoints =
      overrides?.commissionBasisPoints ?? deal.commissionBasisPoints ?? summary?.commissionBasisPoints ?? null;
    const dealReferralFeeBasisPoints =
      overrides?.referralFeeBasisPoints ?? deal.referralFeeBasisPoints ?? summary?.referralFeeBasisPoints ?? null;
    const dealSide = overrides?.dealSide ?? deal.side ?? summary?.dealSide ?? referral.dealSide ?? 'buy';
    const dealCommissionPercentDisplay = dealCommissionBasisPoints
      ? `${(dealCommissionBasisPoints / 100).toFixed(2)}%`
      : '—';
    const dealReferralFeePercentDisplay = dealReferralFeeBasisPoints
      ? `${(dealReferralFeeBasisPoints / 100).toFixed(2)}%`
      : '—';
    const dealSideDisplay = dealSide === 'sell' ? 'Sell-side' : 'Buy-side';

    const isExpanded = expandedMap[deal._id] ?? false;

    const toggleExpanded = () => {
      setExpandedMap((previous) => ({ ...previous, [deal._id]: !isExpanded }));
    };

    return (
      <div key={deal._id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          className="flex w-full items-center justify-between gap-4 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                status === 'terminated'
                  ? 'bg-rose-50 text-rose-600'
                  : status === 'paid'
                    ? 'bg-emerald-50 text-emerald-600'
                    : status === 'payment_sent'
                      ? 'bg-indigo-50 text-indigo-600'
                      : status === 'closed'
                        ? 'bg-sky-50 text-sky-600'
                        : status === 'clear_to_close'
                          ? 'bg-teal-50 text-teal-600'
                          : status === 'past_appraisal'
                            ? 'bg-blue-50 text-blue-600'
                            : status === 'past_inspection'
                              ? 'bg-amber-50 text-amber-600'
                              : 'bg-amber-50 text-amber-600'
              }`}
            >
              {statusLabel}
            </span>
            <span className="text-xs uppercase tracking-wide text-slate-400">
              {isPrimary ? 'Active Deal' : 'Deal History'}
            </span>
            <span className="text-sm font-medium text-slate-900">{formattedAmount}</span>
            <span className="text-xs text-slate-500">{propertyLabel}</span>
            {deal.createdAt && (
              <span className="text-xs text-slate-400">Updated {new Date(deal.createdAt).toLocaleDateString()}</span>
            )}
          </div>
          <span className="text-xs font-medium text-brand">
            {isExpanded ? 'Hide details' : 'View details'}
          </span>
        </button>
        {isExpanded && (
          <div className="space-y-4 border-t border-slate-200 p-4 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Property</p>
                <p className="font-medium text-slate-900">{propertyLabel}</p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Referral Fee Due</p>
                <p className="font-medium text-slate-900">{formattedAmount}</p>
                {isPrimary && overrides?.hasUnsavedContractChanges && (
                  <p className="mt-2 text-xs text-amber-600">Save contract details to lock in this referral fee.</p>
                )}
                {status === 'terminated' && (
                  <p className="mt-2 text-xs text-slate-500">Terminated deals are excluded from revenue totals.</p>
                )}
                {status === 'payment_sent' && (
                  <p className="mt-2 text-xs text-indigo-600">Agent marked payment as sent. Awaiting admin confirmation.</p>
                )}
                {status === 'paid' && (
                  <p className="mt-2 text-xs text-emerald-600">Payment received and confirmed by admin.</p>
                )}
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <label className="flex flex-col gap-2 text-xs uppercase text-slate-400">
                  Deal Status
                  <select
                    value={status}
                    onChange={handleStatusChange(deal)}
                    className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    disabled={isSaving}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {status === 'terminated' && (
                  <label className="mt-2 flex flex-col gap-2 text-xs uppercase text-slate-400">
                    Termination Reason
                    <select
                      value={selectedReason}
                      onChange={handleReasonChange(deal)}
                      className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-700"
                      disabled={isSaving}
                    >
                      {TERMINATED_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {expectedAmountCents <= 0 && status !== 'terminated' && (
                  <p className="mt-2 text-xs text-amber-600">
                    Enter contract details to calculate the referral fee before updating deal status.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-slate-500">
                {isSaving ? 'Saving…' : 'Update the deal status and referral fee details.'}
              </p>
              <button
                type="button"
                onClick={handleDeleteDeal(deal)}
                disabled={isSaving}
                className="inline-flex items-center justify-center rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Delete deal
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Agent Commission %</p>
                <p className="font-medium text-slate-900">{dealCommissionPercentDisplay}</p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Referral Fee %</p>
                <p className="font-medium text-slate-900">{dealReferralFeePercentDisplay}</p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Deal Side</p>
                <p className="font-medium text-slate-900">{dealSideDisplay}</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <label className="flex flex-col gap-2 text-xs uppercase text-slate-400">
                  Agent Outcome
                  <select
                    value={agentSelection}
                    onChange={handleAgentAttributionChange(deal)}
                    className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    disabled={isSaving}
                  >
                    <option value="">Not Used</option>
                    <option value="AHA">Used AHA</option>
                    <option value="AHA_OOS">Used AHA OOS</option>
                    <option value="OUTSIDE_AGENT">Outside agent (lost)</option>
                  </select>
                </label>
                {assignedBucket && agentSelection === '' && (
                  <p className="mt-2 text-xs text-slate-500">Mark whether this deal stayed with the assigned agent bucket.</p>
                )}
                {assignedBucket && agentSelection && !matchesAssigned && (
                  <p className="mt-2 text-xs text-amber-600">
                    This deal did not close with the assigned {assignedBucket === 'AHA' ? 'AHA' : 'AHA OOS'} agent.
                  </p>
                )}
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Mortgage Company</p>
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                    checked={usedAfc}
                    onChange={handleAfcToggle(deal)}
                    disabled={isSaving}
                  />
                  Used AFC
                </label>
                {!usedAfc && (
                  <p className="mt-2 text-xs text-slate-500">Track whether AFC handled this deal.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Deals</h2>
        <p className="text-sm text-slate-500">Track referral revenue from contract through payout</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase text-slate-400">Referral</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryBorrower ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Status</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryStatusLabel ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs uppercase text-slate-400">Property</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryAddress}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Contract Price</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryContractPriceDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Agent Commission %</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryCommissionPercentDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Referral Fee %</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryReferralFeePercentDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Referral Fee</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryReferralFeeDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Net Commission</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryNetCommissionDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Deal Side</dt>
            <dd className="text-sm font-medium text-slate-900">{summaryDealSideDisplay}</dd>
          </div>
        </dl>
        {overrides?.hasUnsavedContractChanges && (
          <p className="mt-3 text-xs text-amber-600">
            Save the deal preparation form below to create or update the active deal.
          </p>
        )}
      </div>
      {sortedDeals.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          <p>Use the deal preparation form below to create the first deal for this referral.</p>
        </div>
      ) : (
        <div className="space-y-4">{sortedDeals.map(renderDeal)}</div>
      )}
    </div>
  );
}
