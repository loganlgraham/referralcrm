'use client';

import { type ChangeEvent, type FormEvent, MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { DEAL_STATUS_LABELS, DEAL_STATUS_OPTIONS, type DealStatus } from '@/constants/deals';
import { formatCurrency } from '@/utils/formatters';
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
  contractPriceCents?: number | null;
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
  viewerRole?: string;
  onAddDeal?: () => void;
}

interface DealDraft {
  contractPrice: string;
  commissionPercent: string;
  referralFeePercent: string;
  side: 'buy' | 'sell';
}

const deriveReferralFeeCents = (
  contractPriceCents?: number | null,
  commissionBasisPoints?: number | null,
  referralFeeBasisPoints?: number | null
) => {
  if (!contractPriceCents || contractPriceCents <= 0) {
    return null;
  }
  if (!commissionBasisPoints || commissionBasisPoints <= 0) {
    return null;
  }
  if (!referralFeeBasisPoints || referralFeeBasisPoints <= 0) {
    return null;
  }

  const computed =
    (contractPriceCents * commissionBasisPoints * referralFeeBasisPoints) / 100_000_000;
  if (!Number.isFinite(computed) || computed <= 0) {
    return null;
  }

  return Math.round(computed);
};

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
      contractPriceCents: deal.contractPriceCents ?? null,
    }))
    .sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
};

export function DealCard({ referral, overrides, summary, viewerRole, onAddDeal }: ReferralDealProps) {
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
  const [detailDraftMap, setDetailDraftMap] = useState<Record<string, DealDraft>>({});
  const [detailSavingMap, setDetailSavingMap] = useState<Record<string, boolean>>({});

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

  const statusOptions = useMemo(() => {
    if (viewerRole === 'agent') {
      return DEAL_STATUS_OPTIONS.filter((option) => option.value !== 'paid');
    }
    return DEAL_STATUS_OPTIONS;
  }, [viewerRole]);

  const propertyLabel =
    overrides?.propertyAddress ||
    referral.propertyAddress ||
    (referral.lookingInZip ? `Looking in ${referral.lookingInZip}` : 'Pending address');

  const summaryBorrower = summary?.borrowerName?.trim() ? summary.borrowerName.trim() : null;
  const summaryStatusLabel = summary?.statusLabel?.trim() ? summary.statusLabel.trim() : null;
  const summaryAddress = overrides?.propertyAddress ?? summary?.propertyAddress ?? propertyLabel;
  const summaryContractPriceCents =
    overrides?.contractPriceCents ?? summary?.contractPriceCents ?? null;
  const summaryCommissionBasisPoints =
    overrides?.commissionBasisPoints ?? summary?.commissionBasisPoints ?? null;
  const summaryReferralFeeBasisPoints =
    overrides?.referralFeeBasisPoints ?? summary?.referralFeeBasisPoints ?? null;
  const derivedSummaryReferralFee = deriveReferralFeeCents(
    summaryContractPriceCents,
    summaryCommissionBasisPoints,
    summaryReferralFeeBasisPoints
  );
  const summaryReferralFeeCents =
    derivedSummaryReferralFee ??
    overrides?.referralFeeDueCents ??
    summary?.referralFeeDueCents ??
    referral.referralFeeDueCents ??
    null;
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

  const formatDraftCurrency = (cents?: number | null) => {
    if (!cents || cents <= 0) {
      return '';
    }
    const dollars = cents / 100;
    const formatted = Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2);
    return formatted.replace(/\.00$/, '');
  };

  const formatDraftPercent = (bps?: number | null) => {
    if (!bps || bps <= 0) {
      return '';
    }
    const value = bps / 100;
    const formatted = value.toFixed(2);
    return formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted;
  };

  const getDefaultDraft = useCallback(
    (deal: DealRecord): DealDraft => {
      const priceCents = deal.contractPriceCents ?? summaryContractPriceCents ?? null;
      const commissionBps = deal.commissionBasisPoints ?? summaryCommissionBasisPoints ?? null;
      const referralFeeBps = deal.referralFeeBasisPoints ?? summaryReferralFeeBasisPoints ?? null;
      const side = deal.side ?? overrides?.dealSide ?? summaryDealSide ?? 'buy';

      return {
        contractPrice: formatDraftCurrency(priceCents),
        commissionPercent: formatDraftPercent(commissionBps),
        referralFeePercent: formatDraftPercent(referralFeeBps),
        side,
      };
    },
    [
      overrides?.dealSide,
      summaryCommissionBasisPoints,
      summaryContractPriceCents,
      summaryDealSide,
      summaryReferralFeeBasisPoints,
    ]
  );

  useEffect(() => {
    setDetailDraftMap((previous) => {
      const next: Record<string, DealDraft> = {};
      deals.forEach((deal) => {
        next[deal._id] = previous[deal._id] ?? getDefaultDraft(deal);
      });
      return next;
    });
  }, [deals, getDefaultDraft]);

  const parseCurrencyInput = (value: string): number | null => {
    if (!value) {
      return null;
    }
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed * 100);
  };

  const parsePercentInput = (value: string): number | null => {
    if (!value) {
      return null;
    }
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed * 100);
  };

  const getStatusForDeal = (deal: DealRecord): DealStatus => {
    return statusMap[deal._id] ?? ((deal.status as DealStatus | undefined) ?? 'under_contract');
  };

  const handleSaveDealDetails = (deal: DealRecord) => async () => {
    const draft = detailDraftMap[deal._id] ?? getDefaultDraft(deal);
    const contractPriceCents = parseCurrencyInput(draft.contractPrice);
    const commissionBasisPoints = parsePercentInput(draft.commissionPercent);
    const referralFeeBasisPoints = parsePercentInput(draft.referralFeePercent);

    if (
      contractPriceCents == null ||
      commissionBasisPoints == null ||
      referralFeeBasisPoints == null
    ) {
      toast.error('Enter the contract price, commission %, and referral fee % before saving.');
      return;
    }

    const expectedAmountCents = deriveReferralFeeCents(
      contractPriceCents,
      commissionBasisPoints,
      referralFeeBasisPoints
    );

    if (!expectedAmountCents || expectedAmountCents <= 0) {
      toast.error('Enter valid deal details to calculate the referral fee.');
      return;
    }

    setDetailSavingMap((prev) => ({ ...prev, [deal._id]: true }));

    try {
      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: deal._id,
          contractPriceCents,
          commissionBasisPoints,
          referralFeeBasisPoints,
          side: draft.side,
          expectedAmountCents,
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => undefined)) as
          | { error?: unknown }
          | undefined;
        const message =
          errorBody && typeof errorBody.error === 'string'
            ? errorBody.error
            : 'Unable to update deal details';
        throw new Error(message);
      }

      setDeals((previous) =>
        previous.map((item) =>
          item._id === deal._id
            ? {
                ...item,
                contractPriceCents,
                commissionBasisPoints,
                referralFeeBasisPoints,
                side: draft.side,
                expectedAmountCents,
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      setDetailDraftMap((previous) => ({
        ...previous,
        [deal._id]: {
          contractPrice: formatDraftCurrency(contractPriceCents),
          commissionPercent: formatDraftPercent(commissionBasisPoints),
          referralFeePercent: formatDraftPercent(referralFeeBasisPoints),
          side: draft.side,
        },
      }));
      toast.success('Deal details saved');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update deal details');
    } finally {
      setDetailSavingMap((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
    }
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
      setDetailDraftMap((previous) => {
        if (!(deal._id in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
      setDetailSavingMap((previous) => {
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

  const computeExpectedAmount = (deal: DealRecord, isPrimary: boolean): number => {
    const status = getStatusForDeal(deal);
    if (status === 'terminated') {
      return 0;
    }

    const baseContractPrice = isPrimary
      ? overrides?.contractPriceCents ?? deal.contractPriceCents ?? summary?.contractPriceCents ?? null
      : deal.contractPriceCents ?? summary?.contractPriceCents ?? null;
    const baseCommissionBps = isPrimary
      ? overrides?.commissionBasisPoints ?? deal.commissionBasisPoints ?? summary?.commissionBasisPoints ?? null
      : deal.commissionBasisPoints ?? summary?.commissionBasisPoints ?? null;
    const baseReferralFeeBps = isPrimary
      ? overrides?.referralFeeBasisPoints ?? deal.referralFeeBasisPoints ?? summary?.referralFeeBasisPoints ?? null
      : deal.referralFeeBasisPoints ?? summary?.referralFeeBasisPoints ?? null;

    const derivedAmount = deriveReferralFeeCents(
      baseContractPrice,
      baseCommissionBps,
      baseReferralFeeBps
    );

    if (derivedAmount && derivedAmount > 0) {
      return derivedAmount;
    }

    if (isPrimary && overrides?.referralFeeDueCents !== undefined) {
      return overrides.referralFeeDueCents;
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

    const isPrimaryDeal = activeDealId ? deal._id === activeDealId : deals[0]?._id === deal._id;
    const expectedAmountCents = computeExpectedAmount(deal, Boolean(isPrimaryDeal));

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
    const expectedAmountCents = computeExpectedAmount(deal, isPrimary);
    const formattedAmount =
      status === 'terminated'
        ? '—'
        : expectedAmountCents > 0
          ? formatCurrency(expectedAmountCents)
          : '—';
    const isSaving = savingMap[deal._id] ?? false;
    const isDetailSaving = detailSavingMap[deal._id] ?? false;
    const statusLabel = DEAL_STATUS_LABELS[status] ?? status;
    const selectedReason = reasonMap[deal._id] ?? deal.terminatedReason ?? 'inspection';
    const agentSelection = agentMap[deal._id] ?? '';
    const usedAfc = afcMap[deal._id] ?? false;
    const assignedBucket = referral.ahaBucket ?? null;
    const matchesAssigned =
      !assignedBucket || agentSelection === assignedBucket || agentSelection === '';
    const draft = detailDraftMap[deal._id] ?? getDefaultDraft(deal);
    const isExpanded = expandedMap[deal._id] ?? false;

    const draftContractPriceCents = parseCurrencyInput(draft.contractPrice);
    const draftCommissionBasisPoints = parsePercentInput(draft.commissionPercent);
    const draftReferralFeeBasisPoints = parsePercentInput(draft.referralFeePercent);
    const draftReferralFeeCents =
      draftContractPriceCents != null &&
      draftCommissionBasisPoints != null &&
      draftReferralFeeBasisPoints != null
        ? deriveReferralFeeCents(
            draftContractPriceCents,
            draftCommissionBasisPoints,
            draftReferralFeeBasisPoints
          )
        : null;
    const draftReferralFeeDisplay =
      draftReferralFeeCents != null ? formatCurrency(draftReferralFeeCents) : '—';

    const toggleExpanded = () => {
      setExpandedMap((previous) => ({ ...previous, [deal._id]: !isExpanded }));
    };

    const handleDeleteClick = async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteDeal(deal)();
    };

    const handleDraftChange =
      (field: keyof DealDraft) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const rawValue = event.target.value;
        setDetailDraftMap((previous) => {
          const current = previous[deal._id] ?? getDefaultDraft(deal);
          let nextValue: string | 'buy' | 'sell';
          if (field === 'side') {
            nextValue = rawValue === 'sell' ? 'sell' : 'buy';
          } else {
            nextValue = rawValue.replace(/[^0-9.]/g, '');
          }
          return {
            ...previous,
            [deal._id]: {
              ...current,
              [field]: nextValue,
            },
          };
        });
      };

    const handleResetDraft = () => {
      setDetailDraftMap((previous) => ({
        ...previous,
        [deal._id]: getDefaultDraft(deal),
      }));
    };

    const handleSubmitDetails = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSaveDealDetails(deal)();
    };

    return (
      <div key={deal._id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 bg-slate-50 px-4 py-3">
          <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-4">
            <div className="flex flex-wrap items-center gap-3">
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
            </div>
            <div className="flex flex-col text-sm text-slate-600 sm:flex-row sm:items-center sm:gap-2">
              <span className="font-medium text-slate-900">{formattedAmount}</span>
              <span className="text-xs text-slate-500">{propertyLabel}</span>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs uppercase text-slate-400">
              Status
              <select
                value={status}
                onChange={handleStatusChange(deal)}
                className="rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                disabled={isSaving || isDetailSaving}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={toggleExpanded}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              {isExpanded ? 'Hide details' : 'Show details'}
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="space-y-4 border-t border-slate-200 bg-white px-4 py-4 text-sm">
            <form onSubmit={handleSubmitDetails} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs uppercase text-slate-400">
                  Contract Price (USD)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.contractPrice}
                    onChange={handleDraftChange('contractPrice')}
                    className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
                    placeholder="350000"
                    disabled={isDetailSaving}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs uppercase text-slate-400">
                  Agent Commission %
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.commissionPercent}
                    onChange={handleDraftChange('commissionPercent')}
                    className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
                    placeholder="3"
                    disabled={isDetailSaving}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs uppercase text-slate-400">
                  Referral Fee %
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.referralFeePercent}
                    onChange={handleDraftChange('referralFeePercent')}
                    className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
                    placeholder="25"
                    disabled={isDetailSaving}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs uppercase text-slate-400">
                  Deal Side
                  <select
                    value={draft.side}
                    onChange={handleDraftChange('side')}
                    className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
                    disabled={isDetailSaving}
                  >
                    <option value="buy">Buy-side</option>
                    <option value="sell">Sell-side</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Projected Referral Fee:{' '}
                  <span className="text-sm font-semibold text-slate-900">{draftReferralFeeDisplay}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleResetDraft}
                    disabled={isDetailSaving}
                    className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    disabled={isDetailSaving}
                    className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDetailSaving ? 'Saving…' : 'Save details'}
                  </button>
                </div>
              </div>
            </form>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                {status === 'terminated' ? (
                  <label className="flex flex-col gap-2 text-xs uppercase text-slate-400">
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
                ) : (
                  <p className="text-xs text-slate-500">
                    Update the contract and percentage details to keep this referral fee accurate for reporting.
                  </p>
                )}
                {expectedAmountCents <= 0 && status !== 'terminated' && (
                  <p className="mt-2 text-xs text-amber-600">
                    Enter contract details to calculate the referral fee before updating deal status.
                  </p>
                )}
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                {status === 'payment_sent' && (
                  <p className="text-indigo-600">Agent marked payment as sent. Awaiting admin confirmation.</p>
                )}
                {status === 'paid' && (
                  <p className="text-emerald-600">Payment received and confirmed by admin.</p>
                )}
                {status !== 'payment_sent' && status !== 'paid' && (
                  <p>Track the payment journey from contract through payout for this referral.</p>
                )}
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
                    disabled={isSaving || isDetailSaving}
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Deals</h2>
          <p className="text-sm text-slate-500">Track referral revenue from contract through payout</p>
        </div>
        {typeof onAddDeal === 'function' && (
          <button
            type="button"
            onClick={onAddDeal}
            className="inline-flex items-center justify-center rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-brand-dark"
          >
            Add deal
          </button>
        )}
      </div>
      {sortedDeals.length === 0 || overrides?.hasUnsavedContractChanges ? (
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
      ) : null}
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
