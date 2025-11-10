'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { formatCurrency } from '@/utils/formatters';

type DealStatus = 'under_contract' | 'closed' | 'paid' | 'terminated';
type TerminatedReason = 'inspection' | 'appraisal' | 'financing' | 'changed_mind';
type AgentSelectValue = '' | 'AHA' | 'AHA_OOS';

const TERMINATED_REASON_OPTIONS: { value: TerminatedReason; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'financing', label: 'Financing' },
  { value: 'changed_mind', label: 'Changed Mind' },
];

interface DealRecord {
  _id: string;
  status?: DealStatus | null;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  createdAt?: string | null;
  terminatedReason?: TerminatedReason | null;
  agentAttribution?: AgentSelectValue;
  usedAfc?: boolean | null;
}

interface DealOverrides {
  referralFeeDueCents?: number;
  propertyAddress?: string;
  hasUnsavedContractChanges?: boolean;
}

interface ReferralDealProps {
  referral: {
    _id: string;
    propertyAddress?: string;
    propertyZip?: string | null;
    referralFeeDueCents?: number | null;
    payments?: DealRecord[] | null;
    ahaBucket?: AgentSelectValue | null;
  };
  overrides?: DealOverrides;
}

const STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
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
      terminatedReason: (deal.terminatedReason as TerminatedReason | undefined) ?? null,
      agentAttribution: (deal.agentAttribution as AgentSelectValue | undefined) ?? '',
      usedAfc: deal.usedAfc ?? false,
    }))
    .sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
};

export function DealCard({ referral, overrides }: ReferralDealProps) {
  const deals = useMemo(() => normalizeDeals(referral.payments), [referral.payments]);

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

  const propertyLabel =
    overrides?.propertyAddress ||
    referral.propertyAddress ||
    (referral.propertyZip ? `Zip ${referral.propertyZip}` : 'Pending address');

  const getStatusForDeal = (deal: DealRecord): DealStatus => {
    return statusMap[deal._id] ?? ((deal.status as DealStatus | undefined) ?? 'under_contract');
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

    return (
      <div key={deal._id} className="space-y-3 rounded border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400">{isPrimary ? 'Active Deal' : 'Deal History'}</p>
            <p className="text-sm font-medium text-slate-900">{statusLabel}</p>
          </div>
          {deal.createdAt && (
            <p className="text-xs text-slate-500">Updated {new Date(deal.createdAt).toLocaleDateString()}</p>
          )}
        </div>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded border border-slate-200 p-3">
            <p className="text-xs uppercase text-slate-400">Property</p>
            <p className="font-medium text-slate-900">{propertyLabel}</p>
          </div>
          <div className="rounded border border-slate-200 p-3">
            <p className="text-xs uppercase text-slate-400">Referral Fee Due</p>
            <p className="font-medium text-slate-900">{formattedAmount}</p>
            {isPrimary && overrides?.hasUnsavedContractChanges && (
              <p className="mt-2 text-xs text-amber-600">Save contract details to lock in this referral fee.</p>
            )}
            {status === 'terminated' && (
              <p className="mt-2 text-xs text-slate-500">Terminated deals are excluded from revenue totals.</p>
            )}
          </div>
          <div className="rounded border border-slate-200 p-3">
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
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded border border-slate-200 p-3">
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
          <div className="rounded border border-slate-200 p-3">
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
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Deals</h2>
        <p className="text-sm text-slate-500">Track referral revenue from contract through payout</p>
      </div>
      {sortedDeals.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          <p>Save contract details to create the first deal for this referral.</p>
        </div>
      ) : (
        <div className="space-y-4">{sortedDeals.map(renderDeal)}</div>
      )}
    </div>
  );
}
