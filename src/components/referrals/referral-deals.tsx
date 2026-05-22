'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { DEAL_STATUS_LABELS, DEAL_STATUS_OPTIONS, type DealStatus } from '@/constants/deals';
import type { ReferralStatus } from '@/constants/referrals';
import { formatCurrency, formatDateMST, formatDateTimeMST } from '@/utils/formatters';
import type { ReferralPayment } from '@/types/referral-payment';
import {
  confirmCloseStatusDate,
  confirmFeeBreakdownSend,
  confirmPaidStatusDate,
} from '@/components/referrals/status-date-confirmation-toast';

interface ReferralDealsProps {
  referralId: string;
  deals: ReferralPayment[];
  onDealCreated: (deal: ReferralPayment) => void;
  onDealUpdated?: (
    deal: ReferralPayment,
    snapshot?: { referralStatus?: ReferralStatus | null; referralStatusLastUpdated?: string | null }
  ) => void;
  onDealDeleted?: (id: string) => void;
  viewerRole?: string;
  viewerAssignedSide?: 'buy' | 'sell' | null;
  referralOrigin?: 'agent' | 'admin' | 'mc' | null;
  feeBreakdownAutoSendEnabled?: boolean;
  hiddenOutsideAgentCount?: number;
  assignedAgentDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  defaultSide?: 'buy' | 'sell';
}

type AgentOption = { id: string; name: string };

type TerminatedReason = 'inspection' | 'appraisal' | 'financing' | 'changed_mind';

const TERMINATED_REASON_OPTIONS: { value: TerminatedReason; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'financing', label: 'Financing' },
  { value: 'changed_mind', label: 'Changed Mind' },
];

type DealUpdatePayload = {
  status: DealStatus;
  expectedAmountCents: number;
  netReferralFeePaidCents: number;
  contractPriceCents: number | null;
  commissionBasisPoints: number | null;
  commissionFlatFeeCents: number | null;
  referralFeeBasisPoints: number | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  agentId: string | null;
  closingDate: string | null;
  underContractDate: string | null;
  side: 'buy' | 'sell';
  usedAfc: boolean;
  usedAssignedAgent: boolean;
  receivedAmountCents?: number;
  terminatedReason?: TerminatedReason | null;
};

type PaymentPatchResponse = {
  id: string;
  status?: DealStatus;
  expectedAmountCents?: number;
  receivedAmountCents?: number;
  netReferralFeePaidCents?: number;
  closingDate?: string | null;
  paidDate?: string | null;
  referralStatus?: ReferralStatus | null;
  referralStatusLastUpdated?: string | null;
};

const toCents = (value: string): number => {
  const numeric = Number.parseFloat(value.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 100);
};

const formatPercent = (basisPoints?: number | null) => {
  if (basisPoints == null) return '—';
  return `${(basisPoints / 100).toFixed(2)}%`;
};

const centsToDisplay = (value?: number | null) => {
  if (value == null) return '';
  return (value / 100).toFixed(2);
};

const basisPointsToDisplay = (value?: number | null) => {
  if (value == null) return '';
  return (value / 100).toFixed(2);
};

// Convert a date string (YYYY-MM-DD) to ISO string preserving the date
// This prevents timezone shifts that cause dates to display as one day earlier
// by creating a date in local timezone and formatting it correctly
const dateStringToLocalISO = (dateString: string): string => {
  if (!dateString) return '';
  // If the date string is already in ISO format with time, use it as-is
  if (dateString.includes('T')) {
    return dateString;
  }
  // Parse the date string components
  const [year, month, day] = dateString.split('-').map(Number);
  // Create a date in local timezone (not UTC)
  const localDate = new Date(year, month - 1, day);
  // Format as ISO string - this will be in UTC but represents the correct local date
  // The key is that we created it from local components, so getTime() gives us the right value
  return localDate.toISOString();
};

const toDateInputValue = (sourceIso?: string | null): string => {
  if (typeof sourceIso === 'string' && sourceIso.length >= 10) {
    return sourceIso.slice(0, 10);
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function DealCard({
  deal,
  agents,
  agentsLoading,
  canManage,
  statusUpdating,
  deleting,
  isAgentOrigin,
  isAgitDeal,
  onStatusChange,
  onDelete,
  onUpdate,
  viewerRole,
  feeBreakdownAutoSendEnabled,
  isCrossSideReadOnly = false,
}: {
  deal: ReferralPayment;
  agents: AgentOption[];
  agentsLoading: boolean;
  canManage: boolean;
  statusUpdating?: boolean;
  deleting?: boolean;
  isAgentOrigin?: boolean;
  isAgitDeal?: boolean;
  onStatusChange: (
    deal: ReferralPayment,
    status: DealStatus,
    terminationReason?: TerminatedReason | null,
    paidAmountCents?: number,
    paidDateIso?: string
  ) => Promise<boolean> | boolean;
  onDelete: (deal: ReferralPayment) => void;
  onUpdate: (deal: ReferralPayment, payload: DealUpdatePayload) => Promise<boolean>;
  viewerRole?: string;
  feeBreakdownAutoSendEnabled?: boolean;
  isCrossSideReadOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<DealStatus>((deal.status as DealStatus | undefined) ?? 'under_contract');
  const [expectedAmount, setExpectedAmount] = useState(centsToDisplay(deal.expectedAmountCents));
  const [expectedManuallyEdited, setExpectedManuallyEdited] = useState(false);
  const [netReferralFeePaid, setNetReferralFeePaid] = useState(
    centsToDisplay(deal.netReferralFeePaidCents ?? deal.receivedAmountCents)
  );
  const [contractPrice, setContractPrice] = useState(centsToDisplay(deal.contractPriceCents));
  const [commissionMode, setCommissionMode] = useState<'%' | '$'>(
    deal.commissionFlatFeeCents ? '$' : '%'
  );
  const [commissionCanonicalMode, setCommissionCanonicalMode] = useState<'%' | '$'>(
    deal.commissionFlatFeeCents ? '$' : '%'
  );
  const [commissionPercentage, setCommissionPercentage] = useState(
    basisPointsToDisplay(deal.commissionBasisPoints)
  );
  const [commissionFlat, setCommissionFlat] = useState(
    deal.commissionFlatFeeCents ? centsToDisplay(deal.commissionFlatFeeCents) : ''
  );
  const [referralFeePercentage, setReferralFeePercentage] = useState(
    basisPointsToDisplay(deal.referralFeeBasisPoints)
  );
  const [propertyAddress, setPropertyAddress] = useState(deal.propertyAddress ?? '');
  const [propertyCity, setPropertyCity] = useState(deal.propertyCity ?? '');
  const [propertyState, setPropertyState] = useState(deal.propertyState ?? '');
  const [closingDate, setClosingDate] = useState(deal.closingDate ? deal.closingDate.slice(0, 10) : '');
  const [underContractDate, setUnderContractDate] = useState(deal.underContractDate ? deal.underContractDate.slice(0, 10) : '');
  const [agentId, setAgentId] = useState(deal.agentId ?? deal.agent?.id ?? '');
  const [side, setSide] = useState<'buy' | 'sell'>(deal.side ?? 'buy');
  const [usedAfc, setUsedAfc] = useState(Boolean(deal.usedAfc));
  const [usedAssignedAgent, setUsedAssignedAgent] = useState(deal.usedAssignedAgent ?? true);
  const [markPaid, setMarkPaid] = useState(deal.status === 'paid');
  const [terminatedReason, setTerminatedReason] = useState<TerminatedReason | null>(
    (deal.terminatedReason as TerminatedReason | undefined) ?? null
  );
  const agentCreatedReferral = Boolean(isAgentOrigin);
  const isOutsideAgent = !agentCreatedReferral && !usedAssignedAgent;
  const isNoFeeDeal = Boolean(isAgitDeal) || isOutsideAgent;
  const statusOptions = useMemo(
    () =>
      viewerRole === 'agent'
        ? DEAL_STATUS_OPTIONS.filter((option) => option.value !== 'paid')
        : DEAL_STATUS_OPTIONS,
    [viewerRole]
  );
  const router = useRouter();

  const populateFromDeal = useCallback(() => {
    setStatus((deal.status as DealStatus | undefined) ?? 'under_contract');
    setExpectedAmount(centsToDisplay(deal.expectedAmountCents));
    setExpectedManuallyEdited(false);
    setNetReferralFeePaid(centsToDisplay(deal.netReferralFeePaidCents ?? deal.receivedAmountCents));
    setContractPrice(centsToDisplay(deal.contractPriceCents));
    setCommissionMode(deal.commissionFlatFeeCents ? '$' : '%');
    setCommissionCanonicalMode(deal.commissionFlatFeeCents ? '$' : '%');
    setCommissionPercentage(basisPointsToDisplay(deal.commissionBasisPoints));
    setCommissionFlat(deal.commissionFlatFeeCents ? centsToDisplay(deal.commissionFlatFeeCents) : '');
    setReferralFeePercentage(basisPointsToDisplay(deal.referralFeeBasisPoints));
    setPropertyAddress(deal.propertyAddress ?? '');
    setPropertyCity(deal.propertyCity ?? '');
    setPropertyState(deal.propertyState ?? '');
    setClosingDate(deal.closingDate ? deal.closingDate.slice(0, 10) : '');
    setUnderContractDate(deal.underContractDate ? deal.underContractDate.slice(0, 10) : '');
    // Properly handle agentId from either deal.agentId or deal.agent?.id
    const dealAgentId = deal.agentId ?? deal.agent?.id ?? null;
    setAgentId(dealAgentId ?? '');
    setSide(deal.side ?? 'buy');
    setUsedAfc(Boolean(deal.usedAfc));
    setUsedAssignedAgent(deal.usedAssignedAgent ?? true);
    setMarkPaid(deal.status === 'paid');
    setTerminatedReason((deal.terminatedReason as TerminatedReason | undefined) ?? null);
  }, [deal]);

  useEffect(() => {
    // Don't reset form state if user is currently editing
    if (!editing) {
      populateFromDeal();
    }
  }, [populateFromDeal, editing]);

  const handleCommissionModeToggle = (mode: '%' | '$') => {
    if (mode === commissionMode) return;
    setCommissionMode(mode);
    // If the destination field is already the user's canonical input, leave it
    // untouched so we don't lossily round-trip through a converted display value.
    if (mode === commissionCanonicalMode) {
      return;
    }
    const contractCents = toCents(contractPrice);
    if (mode === '$') {
      const pct = Number.parseFloat(commissionPercentage);
      if (contractCents > 0 && Number.isFinite(pct) && pct > 0) {
        const flatCents = Math.round((contractCents * pct) / 100);
        setCommissionFlat(centsToDisplay(flatCents));
      } else {
        setCommissionFlat('');
      }
    } else {
      const flatCents = toCents(commissionFlat);
      if (contractCents > 0 && flatCents > 0) {
        const bps = Math.round((flatCents / contractCents) * 10_000);
        setCommissionPercentage(basisPointsToDisplay(bps));
      } else {
        setCommissionPercentage('');
      }
    }
  };

  const handleCommissionPercentageChange = (value: string) => {
    setCommissionPercentage(value);
    setCommissionCanonicalMode('%');
  };

  const handleCommissionFlatChange = (value: string) => {
    setCommissionFlat(value);
    setCommissionCanonicalMode('$');
  };

  const handleSendFeeBreakdown = async () => {
    const message = deal.feeBreakdownEmailSentAt
      ? 'This fee breakdown was already sent. Resend it now?'
      : 'Send fee breakdown email to agent now?\n\n' +
        'If you send manually, the automatic send (7 days before closing) will be disabled for this deal.';
    const confirmation = await confirmFeeBreakdownSend({ message });
    if (!confirmation.confirmed) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/payments/${deal._id}/send-fee-breakdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalCcRecipients: confirmation.additionalCcRecipients }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to send fee breakdown email');
      }

      toast.success('Fee breakdown email sent successfully');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to send fee breakdown email');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (expectedManuallyEdited || agentCreatedReferral || isNoFeeDeal) return;
    const referral = Number.parseFloat(referralFeePercentage);
    if (!Number.isFinite(referral)) return;
    if (commissionMode === '$') {
      const flatFee = Number.parseFloat(commissionFlat);
      if (Number.isFinite(flatFee)) {
        const computed = flatFee * (referral / 100);
        if (Number.isFinite(computed)) {
          setExpectedAmount(computed.toFixed(2));
        }
      }
    } else {
      const contract = Number.parseFloat(contractPrice);
      const commission = Number.parseFloat(commissionPercentage);
      if (Number.isFinite(contract) && Number.isFinite(commission)) {
        const computed = ((contract * commission) / 100) * (referral / 100);
        if (Number.isFinite(computed)) {
          setExpectedAmount(computed.toFixed(2));
        }
      }
    }
  }, [commissionMode, commissionFlat, commissionPercentage, contractPrice, referralFeePercentage, expectedManuallyEdited, agentCreatedReferral, isNoFeeDeal]);

  useEffect(() => {
    if (!isNoFeeDeal) {
      return;
    }

    setCommissionMode('%');
    setCommissionCanonicalMode('%');
    setCommissionPercentage('');
    setCommissionFlat('');
    setReferralFeePercentage('');
    setExpectedAmount('');
    setExpectedManuallyEdited(false);
    setNetReferralFeePaid('');
  }, [isNoFeeDeal]);

  useEffect(() => {
    if (side === 'sell' && usedAfc) {
      setUsedAfc(false);
    }
  }, [side, usedAfc]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || saving) return;

    const isFlatFeeMode = commissionMode === '$';
    const expectedAmountCents = agentCreatedReferral || isNoFeeDeal ? 0 : toCents(expectedAmount);
    let netReferralFeePaidCents = agentCreatedReferral || isNoFeeDeal ? 0 : toCents(netReferralFeePaid);
    const contractPriceCents = contractPrice ? toCents(contractPrice) : null;
    const commissionBasisPoints = agentCreatedReferral || isNoFeeDeal || isFlatFeeMode
      ? null
      : commissionPercentage
          ? Math.round(Number.parseFloat(commissionPercentage) * 100)
          : null;
    const commissionFlatFeeCents = agentCreatedReferral || isNoFeeDeal || !isFlatFeeMode
      ? null
      : commissionFlat
          ? toCents(commissionFlat)
          : null;
    const referralFeeBasisPoints = agentCreatedReferral || isNoFeeDeal
      ? null
      : referralFeePercentage
          ? Math.round(Number.parseFloat(referralFeePercentage) * 100)
          : null;

    const shouldComputeExpected =
      !agentCreatedReferral &&
      !isNoFeeDeal &&
      !expectedAmountCents &&
      referralFeeBasisPoints &&
      (isFlatFeeMode ? commissionFlatFeeCents : contractPriceCents && commissionBasisPoints);
    const computedExpected = shouldComputeExpected
      ? isFlatFeeMode
        ? Math.round((commissionFlatFeeCents! * referralFeeBasisPoints) / 10_000)
        : Math.round((contractPriceCents! * commissionBasisPoints! * referralFeeBasisPoints) / 100_000_000)
      : 0;
    const finalExpectedAmountCents = agentCreatedReferral || isNoFeeDeal ? 0 : expectedAmountCents || computedExpected;

    if (!agentCreatedReferral && !isNoFeeDeal && markPaid && !netReferralFeePaidCents && finalExpectedAmountCents) {
      netReferralFeePaidCents = finalExpectedAmountCents;
    }

    if (
      !agentCreatedReferral &&
      !isNoFeeDeal &&
      !finalExpectedAmountCents &&
      referralFeeBasisPoints !== 0
    ) {
      toast.error('Enter an expected amount or fill price, commission, and referral fee percentages');
      return;
    }

    setSaving(true);
    const statusToSend = viewerRole === 'admin' && markPaid ? 'paid' : status;
    if (statusToSend === 'terminated' && !terminatedReason) {
      toast.error('Select a termination reason');
      setSaving(false);
      return;
    }
    // Only auto-set closing date when status is CHANGING to 'closed' (not already closed)
    const isChangingToClosed = statusToSend === 'closed' && deal.status !== 'closed';
    const closingDateToSend = isChangingToClosed
      ? closingDate
        ? dateStringToLocalISO(closingDate)
        : new Date().toISOString()
      : closingDate
        ? dateStringToLocalISO(closingDate)
        : null;
    const success = await onUpdate(deal, {
      status: statusToSend,
      expectedAmountCents: finalExpectedAmountCents,
      netReferralFeePaidCents,
      contractPriceCents,
      commissionBasisPoints,
      commissionFlatFeeCents,
      referralFeeBasisPoints,
      propertyAddress: propertyAddress.trim() || null,
      propertyCity: propertyCity.trim() || null,
      propertyState: propertyState.trim().toUpperCase() || null,
      closingDate: closingDateToSend,
      underContractDate: underContractDate ? dateStringToLocalISO(underContractDate) : null,
      // Always include agentId, even if empty (will be converted to null)
      agentId: agentId.trim() || null,
      side,
      usedAfc: side === 'sell' ? false : usedAfc,
      usedAssignedAgent,
      receivedAmountCents: netReferralFeePaidCents,
      terminatedReason: statusToSend === 'terminated' ? terminatedReason : undefined,
    });

    if (success) {
      setEditing(false);
      setExpectedManuallyEdited(false);
    }
    setSaving(false);
  };

  const statusLabel = DEAL_STATUS_LABELS[(deal.status as DealStatus | undefined) ?? 'under_contract'];
  const expectedAmountCents = deal.expectedAmountCents ?? 0;
  const reportedNetPaidCents = deal.netReferralFeePaidCents ?? deal.receivedAmountCents;
  const netPaidCents =
    reportedNetPaidCents ??
    (deal.status === 'paid' ? expectedAmountCents : 0);
  const remainingExpectedCents = Math.max(expectedAmountCents - (reportedNetPaidCents ?? 0), 0);
  const expected = formatCurrency(remainingExpectedCents);
  const netPaid = formatCurrency(netPaidCents ?? 0);
  const contractPriceValue = deal.contractPriceCents ? formatCurrency(deal.contractPriceCents) : '—';
  const dealSide = deal.side === 'sell' ? 'Sell-side' : 'Buy-side';
  const terminatedReasonLabel = terminatedReason
    ? TERMINATED_REASON_OPTIONS.find((option) => option.value === terminatedReason)?.label ??
      terminatedReason
    : null;
  const defaultPaidAmountDisplay = centsToDisplay(
    deal.expectedAmountCents ??
      deal.netReferralFeePaidCents ??
      deal.receivedAmountCents ??
      0
  );
  const originalClosingDate = (() => {
    if (!Array.isArray(deal.closingDatePushbacks)) {
      return null;
    }
    for (const entry of deal.closingDatePushbacks) {
      if (entry?.previousClosingDate) {
        return entry.previousClosingDate;
      }
    }
    return null;
  })();

  const handleMarkPaidClick = () => {
    let amountDraft = defaultPaidAmountDisplay || '0.00';
    let paidDateDraft = toDateInputValue(deal.paidDate);

    toast.custom(
      (toastInstance) => (
        <form
          className="w-[360px] rounded-lg border border-border bg-surface-raised p-4 shadow-lg"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmedValue = amountDraft.trim();
            const parsedAmount = Number.parseFloat(trimmedValue.replace(/[^0-9.]/g, ''));
            if (!trimmedValue || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
              toast.error('Enter a valid paid amount');
              return;
            }
            if (!paidDateDraft) {
              toast.error('Select a paid date');
              return;
            }

            const paidAmountCents = Math.round(parsedAmount * 100);
            const paidDateIso = dateStringToLocalISO(paidDateDraft);
            const updated = await onStatusChange(deal, 'paid', undefined, paidAmountCents, paidDateIso);
            if (updated) {
              toast.dismiss(toastInstance);
            }
          }}
        >
          <p className="text-sm font-semibold text-foreground">Mark deal as paid</p>
          <p className="mt-1 text-xs text-foreground-subtle">Confirm the amount paid for this deal.</p>
          <label className="mt-3 block text-xs font-semibold text-foreground-muted">
            Amount paid
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              defaultValue={amountDraft}
              onChange={(event) => {
                amountDraft = event.target.value;
              }}
              className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold text-foreground-muted">
            Paid date
            <input
              type="date"
              defaultValue={paidDateDraft}
              onChange={(event) => {
                paidDateDraft = event.target.value;
              }}
              className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => toast.dismiss(toastInstance)}
              className="rounded border border-border-strong bg-surface-raised px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-800"
            >
              Save
            </button>
          </div>
        </form>
      ),
      { duration: Infinity, position: 'top-center' }
    );
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs uppercase text-foreground-subtle">Status</p>
            <p className="text-sm font-semibold text-foreground">{statusLabel}</p>
            <p className="text-xs text-foreground-subtle">Created {formatDateMST(deal.createdAt)}</p>
            <p className="text-xs text-foreground-subtle">
              Under contract: {deal.underContractDate ? formatDateMST(deal.underContractDate) : '—'}
            </p>
            <p className="text-xs text-foreground-subtle">
              Closing date: {deal.closingDate ? formatDateMST(deal.closingDate) : '—'}
            </p>
            {originalClosingDate ? (
              <p className="text-xs text-foreground-subtle">
                Original close date: {formatDateMST(originalClosingDate)}
              </p>
            ) : null}
            {deal.status === 'terminated' && (
              <p className="text-xs font-medium text-rose-600">
                Termination reason: {terminatedReasonLabel ?? 'Not specified'}
              </p>
            )}
          </div>
          {!isCrossSideReadOnly && (
            <label className="block text-xs font-semibold text-foreground-muted">
              <span className="mr-2">Update stage</span>
              <select
                value={(deal.status as DealStatus | undefined) ?? 'under_contract'}
                onChange={(event) =>
                  onStatusChange(
                    deal,
                    event.target.value as DealStatus,
                    event.target.value === 'terminated' ? terminatedReason : null
                  )
                }
                disabled={!canManage || statusUpdating}
                className="mt-1 w-full rounded border border-border-strong px-2 py-1 text-xs shadow-sm focus:border-primary-500 focus:outline-none"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canManage && !isCrossSideReadOnly && (
            <label className="block text-xs font-semibold text-foreground-muted">
              <span className="mr-2">Termination reason</span>
              <select
                value={terminatedReason ?? ''}
                onChange={(event) =>
                  setTerminatedReason(
                    event.target.value ? (event.target.value as TerminatedReason) : null
                  )
                }
                disabled={!canManage || statusUpdating}
                className="mt-1 w-full rounded border border-border-strong px-2 py-1 text-xs shadow-sm focus:border-primary-500 focus:outline-none"
              >
                <option value="">Select reason</option>
                {TERMINATED_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!isCrossSideReadOnly && (
          <div className="space-y-1">
            <p className="text-xs uppercase text-foreground-subtle">Expected</p>
            <p className="text-sm font-semibold text-foreground">{expected}</p>
            <p className="text-xs text-foreground-subtle">Net paid: {netPaid}</p>
          </div>
        )}
        <div className="space-y-1 text-sm text-foreground-muted">
          <p>
            <span className="text-xs uppercase text-foreground-subtle">Contract price: </span>
            <span className="font-semibold">{contractPriceValue}</span>
          </p>
          {!isCrossSideReadOnly && (
            <>
              <p>
                <span className="text-xs uppercase text-foreground-subtle">Commission: </span>
                <span className="font-semibold">
                  {deal.commissionFlatFeeCents
                    ? formatCurrency(deal.commissionFlatFeeCents)
                    : formatPercent(deal.commissionBasisPoints)}
                </span>
              </p>
              <p>
                <span className="text-xs uppercase text-foreground-subtle">Referral fee: </span>
                <span className="font-semibold">{formatPercent(deal.referralFeeBasisPoints)}</span>
              </p>
              <p>
                <span className="text-xs uppercase text-foreground-subtle">Side: </span>
                <span className="font-semibold">{dealSide}</span>
              </p>
              <p>
                <span className="text-xs uppercase text-foreground-subtle">Used AFC: </span>
                <span className="font-semibold">{deal.side === 'sell' ? 'N/A' : deal.usedAfc ? 'Yes' : 'No'}</span>
              </p>
              <p>
                <span className="text-xs uppercase text-foreground-subtle">Used Agent: </span>
                <span className="font-semibold">{deal.usedAssignedAgent ? 'Yes' : 'No'}</span>
              </p>
            </>
          )}
          <p>
            <span className="text-xs uppercase text-foreground-subtle">Address: </span>
            <span className="font-semibold">{deal.propertyAddress?.trim() || '—'}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-foreground-subtle">Agent: </span>
            <span className="font-semibold">{deal.agent?.name ?? 'Unassigned'}</span>
          </p>
        </div>
        {canManage && (
          <div className="flex flex-col gap-2 sm:w-44">
            {viewerRole === 'admin' && (
              <button
                type="button"
                onClick={handleMarkPaidClick}
                disabled={statusUpdating}
                className="rounded border border-border-strong bg-surface-muted px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-70"
              >
                Mark Paid
              </button>
            )}
            {viewerRole === 'agent' && (
              <button
                type="button"
                onClick={() => void onStatusChange(deal, 'payment_sent')}
                disabled={statusUpdating || deal.status === 'payment_sent' || deal.status === 'paid'}
                className="rounded border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Payment Sent
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing((previous) => !previous)}
              className="rounded border border-border bg-surface-raised px-3 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-muted"
            >
              {editing ? 'Close edit' : 'Edit deal'}
            </button>
            <button
              type="button"
              onClick={() => onDelete(deal)}
              disabled={deleting}
              className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {deleting ? 'Deleting…' : 'Delete deal'}
            </button>
            {viewerRole === 'admin' && (
              <>
                <button
                  type="button"
                  onClick={handleSendFeeBreakdown}
                  disabled={saving || !deal.closingDate || !deal.agentId}
                  className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deal.feeBreakdownEmailSentAt ? 'Resend Fee Breakdown Email' : 'Send Fee Breakdown Email'}
                </button>
                {deal.closingDate && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-foreground-subtle">
                      {deal.feeBreakdownEmailSentAt ? (
                        <>
                          {deal.feeBreakdownEmailSentBy === 'cron'
                            ? `✓ Sent ${formatDateTimeMST(deal.feeBreakdownEmailSentAt)} (auto)`
                            : `✓ Sent ${formatDateTimeMST(deal.feeBreakdownEmailSentAt)} by ${deal.feeBreakdownEmailSentByUser?.name ?? deal.feeBreakdownEmailSentByUser?.email ?? 'admin'}`}
                        </>
                      ) : feeBreakdownAutoSendEnabled !== false ? (
                        '⏰ Auto-sends 7 days before closing.'
                      ) : null}
                    </p>
                    {deal.feeBreakdownEmailSentAt &&
                      deal.feeBreakdownEmailSentBy !== 'cron' && (
                        <p className="text-xs text-amber-600">
                          Auto-send disabled for this deal because it was sent manually.
                        </p>
                      )}
                  </div>
                )}
                {!deal.closingDate && (
                  <p className="text-xs text-amber-600">
                    Add closing date to enable
                  </p>
                )}
                {!deal.agentId && deal.closingDate && (
                  <p className="text-xs text-amber-600">
                    Assign an agent to enable
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {editing && canManage && (
        <form onSubmit={handleSubmit} className="grid gap-3 rounded-md border border-border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Contract price</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={contractPrice}
              onChange={(event) => setContractPrice(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="0.00"
              disabled={saving || isNoFeeDeal}
            />
          </label>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground-muted">Commission</span>
              <div className="flex rounded border border-border-strong text-xs font-medium overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleCommissionModeToggle('%')}
                  disabled={saving || isNoFeeDeal}
                  className={`px-1.5 py-0.5 transition-colors ${commissionMode === '%' ? 'bg-primary-600 text-white' : 'bg-surface-raised text-foreground-subtle hover:bg-surface-muted'}`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => handleCommissionModeToggle('$')}
                  disabled={saving || isNoFeeDeal}
                  className={`px-1.5 py-0.5 transition-colors ${commissionMode === '$' ? 'bg-primary-600 text-white' : 'bg-surface-raised text-foreground-subtle hover:bg-surface-muted'}`}
                >
                  $
                </button>
              </div>
            </div>
            {commissionMode === '%' ? (
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={commissionPercentage}
                onChange={(event) => handleCommissionPercentageChange(event.target.value)}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                placeholder="0.00"
                disabled={saving || isNoFeeDeal}
              />
            ) : (
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={commissionFlat}
                onChange={(event) => handleCommissionFlatChange(event.target.value)}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                placeholder="0.00"
                disabled={saving || isNoFeeDeal}
              />
            )}
          </div>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Referral fee %</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={referralFeePercentage}
              onChange={(event) => setReferralFeePercentage(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="0.00"
              disabled={saving || isNoFeeDeal}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Expected amount</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={expectedAmount}
              onChange={(event) => {
                const value = event.target.value;
                setExpectedManuallyEdited(Boolean(value));
                setExpectedAmount(value);
              }}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="0.00"
              disabled={saving || isNoFeeDeal}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Net referral fee paid (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={netReferralFeePaid}
              onChange={(event) => setNetReferralFeePaid(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="0.00"
              disabled={saving || isNoFeeDeal}
            />
          </label>
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as DealStatus)}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                disabled={saving}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              </select>
            </label>
            {status === 'terminated' && (
              <label className="space-y-1 text-sm font-medium text-foreground-muted">
                <span>Termination reason</span>
                <select
                  value={terminatedReason ?? ''}
                  onChange={(event) =>
                    setTerminatedReason(
                      event.target.value ? (event.target.value as TerminatedReason) : null
                    )
                  }
                  className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                  disabled={saving}
                >
                  <option value="">Select reason</option>
                  {TERMINATED_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Under contract date</span>
              <input
                type="date"
                value={underContractDate}
                onChange={(event) => setUnderContractDate(event.target.value)}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                disabled={saving}
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Closing date</span>
              <input
                type="date"
                value={closingDate}
              onChange={(event) => setClosingDate(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Property address</span>
            <input
              type="text"
              value={propertyAddress}
              onChange={(event) => setPropertyAddress(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="123 Main St, City, ST"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Property city</span>
            <input
              type="text"
              value={propertyCity}
              onChange={(event) => setPropertyCity(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="City"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Property state</span>
            <input
              type="text"
              value={propertyState}
              maxLength={2}
              onChange={(event) => {
                const value = event.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
                setPropertyState(value);
              }}
              onPaste={(event) => {
                event.preventDefault();
                const pastedText = event.clipboardData.getData('text');
                const processed = pastedText.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
                setPropertyState(processed);
                event.currentTarget.value = processed;
              }}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm uppercase focus:border-primary-500 focus:outline-none"
              placeholder="ST"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              disabled={saving || agentsLoading}
            >
              <option value="">Unassigned</option>
              {agentsLoading && agents.length === 0 ? (
                <option value="" disabled>Loading agents...</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Deal side</span>
            <select
              value={side}
              onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              disabled={saving}
            >
              <option value="buy">Buy-side</option>
              <option value="sell">Sell-side</option>
            </select>
          </label>
          <div className="flex flex-col justify-center gap-2 rounded border border-border p-3 text-sm sm:col-span-2 lg:col-span-4">
            {side !== 'sell' && (
              <label className="flex items-center gap-2 text-foreground-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-strong"
                  checked={usedAfc}
                  onChange={(event) => setUsedAfc(event.target.checked)}
                  disabled={saving}
                />
                Used AFC
              </label>
            )}
            <label className="flex items-center gap-2 text-foreground-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong"
                checked={usedAssignedAgent}
                onChange={(event) => setUsedAssignedAgent(event.target.checked)}
                disabled={saving}
              />
              Used Agent
            </label>
            {!agentCreatedReferral && isNoFeeDeal && (
              <p className="text-xs text-foreground-subtle">
                {isAgitDeal
                  ? 'AGIT agent deal: no referral fee is collected. Commission/referral fee fields are disabled and owed amount is forced to $0.'
                  : 'Outside-agent deal selected: commission/referral fee fields are disabled and owed amount is forced to $0.'}
              </p>
            )}
            {viewerRole === 'admin' && (
              <label className="flex items-center gap-2 text-foreground-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-strong"
                  checked={markPaid || status === 'paid'}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setMarkPaid(checked);
                    if (checked) {
                      setStatus('paid');
                      if (!netReferralFeePaid) {
                        setNetReferralFeePaid(expectedAmount);
                      }
                    }
                  }}
                  disabled={saving}
                />
                Paid
              </label>
            )}
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => {
                populateFromDeal();
                setExpectedManuallyEdited(false);
                setEditing(false);
              }}
              className="rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground-muted shadow-sm transition hover:bg-surface-muted"
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ReferralDeals({
  referralId,
  deals,
  onDealCreated,
  onDealUpdated,
  onDealDeleted,
  viewerRole,
  viewerAssignedSide,
  referralOrigin,
  feeBreakdownAutoSendEnabled,
  hiddenOutsideAgentCount = 0,
  assignedAgentDesignation,
  defaultSide = 'buy',
}: ReferralDealsProps) {
  const [status, setStatus] = useState<DealStatus>('under_contract');
  const [markPaid, setMarkPaid] = useState(false);
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expectedManuallyEdited, setExpectedManuallyEdited] = useState(false);
  const [netReferralFeePaid, setNetReferralFeePaid] = useState('');
  const [contractPrice, setContractPrice] = useState('');
  const [commissionMode, setCommissionMode] = useState<'%' | '$'>('%');
  const [commissionCanonicalMode, setCommissionCanonicalMode] = useState<'%' | '$'>('%');
  const [commissionPercentage, setCommissionPercentage] = useState('');
  const [commissionFlat, setCommissionFlat] = useState('');
  const [referralFeePercentage, setReferralFeePercentage] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [underContractDate, setUnderContractDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agentId, setAgentId] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>(defaultSide);
  const [usedAfc, setUsedAfc] = useState(false);
  const [usedAssignedAgent, setUsedAssignedAgent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [terminatedReason, setTerminatedReason] = useState<TerminatedReason | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const isAgentOrigin = referralOrigin === 'agent';
  const isAgitDeal = assignedAgentDesignation === 'AGIT';
  const statusOptions = useMemo(
    () =>
      viewerRole === 'agent'
        ? DEAL_STATUS_OPTIONS.filter((option) => option.value !== 'paid')
        : DEAL_STATUS_OPTIONS,
    [viewerRole]
  );

  const canManage = viewerRole !== 'viewer';
  const canCreateForViewer = !(viewerRole === 'agent' && !viewerAssignedSide);
  const effectiveCreateSide: 'buy' | 'sell' =
    viewerRole === 'agent' && (viewerAssignedSide === 'buy' || viewerAssignedSide === 'sell')
      ? viewerAssignedSide
      : side;

  useEffect(() => {
    setSide(defaultSide);
  }, [defaultSide]);

  useEffect(() => {
    if (viewerRole === 'agent' && (viewerAssignedSide === 'buy' || viewerAssignedSide === 'sell')) {
      setSide(viewerAssignedSide);
    }
  }, [viewerRole, viewerAssignedSide]);

  useEffect(() => {
    if (!canManage) {
      setAgentsLoading(false);
      return;
    }
    setAgentsLoading(true);
    setAgentsError(null);
    const controller = new AbortController();
    fetch('/api/agents?minimal=true&all=true', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load agents');
        }
        return response.json() as Promise<{ items: { _id: string; name?: string | null }[] }>;
      })
      .then((data) => {
        const options = data.items || [];
        setAgents(
          options
            .filter((option) => option?._id)
            .map((option) => ({ id: option._id, name: option.name ?? 'Unnamed agent' }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        setAgentsError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setAgentsError(error instanceof Error ? error.message : 'Failed to load agents');
        toast.error('Unable to load agents list');
      })
      .finally(() => {
        setAgentsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [canManage]);

  useEffect(() => {
    if (expectedManuallyEdited || isAgentOrigin) return;
    const referral = Number.parseFloat(referralFeePercentage);
    if (!Number.isFinite(referral)) return;
    if (commissionMode === '$') {
      const flatFee = Number.parseFloat(commissionFlat);
      if (Number.isFinite(flatFee)) {
        const computed = flatFee * (referral / 100);
        if (Number.isFinite(computed)) {
          setExpectedAmount(computed.toFixed(2));
        }
      }
    } else {
      const contract = Number.parseFloat(contractPrice);
      const commission = Number.parseFloat(commissionPercentage);
      if (Number.isFinite(contract) && Number.isFinite(commission)) {
        const computed = ((contract * commission) / 100) * (referral / 100);
        if (Number.isFinite(computed)) {
          setExpectedAmount(computed.toFixed(2));
        }
      }
    }
  }, [commissionMode, commissionFlat, commissionPercentage, contractPrice, referralFeePercentage, expectedManuallyEdited, isAgentOrigin]);

  useEffect(() => {
    if (isAgentOrigin || (usedAssignedAgent && !isAgitDeal)) {
      return;
    }

    // Outside-agent and AGIT deals do not carry owed fee values.
    setCommissionMode('%');
    setCommissionCanonicalMode('%');
    setCommissionPercentage('');
    setCommissionFlat('');
    setReferralFeePercentage('');
    setExpectedAmount('');
    setExpectedManuallyEdited(false);
    setNetReferralFeePaid('');
  }, [isAgentOrigin, usedAssignedAgent, isAgitDeal]);

  useEffect(() => {
    if (side === 'sell' && usedAfc) {
      setUsedAfc(false);
    }
  }, [side, usedAfc]);

  const handleCommissionModeToggle = (mode: '%' | '$') => {
    if (mode === commissionMode) return;
    setCommissionMode(mode);
    if (mode === commissionCanonicalMode) {
      return;
    }
    const contractCents = toCents(contractPrice);
    if (mode === '$') {
      const pct = Number.parseFloat(commissionPercentage);
      if (contractCents > 0 && Number.isFinite(pct) && pct > 0) {
        const flatCents = Math.round((contractCents * pct) / 100);
        setCommissionFlat(centsToDisplay(flatCents));
      } else {
        setCommissionFlat('');
      }
    } else {
      const flatCents = toCents(commissionFlat);
      if (contractCents > 0 && flatCents > 0) {
        const bps = Math.round((flatCents / contractCents) * 10_000);
        setCommissionPercentage(basisPointsToDisplay(bps));
      } else {
        setCommissionPercentage('');
      }
    }
  };

  const handleCommissionPercentageChange = (value: string) => {
    setCommissionPercentage(value);
    setCommissionCanonicalMode('%');
  };

  const handleCommissionFlatChange = (value: string) => {
    setCommissionFlat(value);
    setCommissionCanonicalMode('$');
  };

  const sortedDeals = useMemo(
    () => [...deals].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    }),
    [deals]
  );
  const shouldHideAgentEmptyState =
    viewerRole === 'agent' && sortedDeals.length === 0 && hiddenOutsideAgentCount > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || !canCreateForViewer || submitting) return;

    const isOutsideAgent = !isAgentOrigin && !usedAssignedAgent;
    const isNoFeeDeal = isAgitDeal || isOutsideAgent;
    const isFlatFeeMode = commissionMode === '$';
    const expectedAmountCents = isAgentOrigin || isNoFeeDeal ? 0 : toCents(expectedAmount);
    let netReferralFeePaidCents = isAgentOrigin || isNoFeeDeal ? 0 : toCents(netReferralFeePaid);
    const contractPriceCents = contractPrice ? toCents(contractPrice) : null;
    const commissionBasisPoints = isAgentOrigin || isNoFeeDeal || isFlatFeeMode
      ? null
      : commissionPercentage
          ? Math.round(Number.parseFloat(commissionPercentage) * 100)
          : null;
    const commissionFlatFeeCents = isAgentOrigin || isNoFeeDeal || !isFlatFeeMode
      ? null
      : commissionFlat
          ? toCents(commissionFlat)
          : null;
    const referralFeeBasisPoints = isAgentOrigin || isNoFeeDeal
      ? null
      : referralFeePercentage
          ? Math.round(Number.parseFloat(referralFeePercentage) * 100)
          : null;

    const shouldComputeExpected =
      !isAgentOrigin &&
      !isNoFeeDeal &&
      !expectedAmountCents &&
      referralFeeBasisPoints &&
      (isFlatFeeMode ? commissionFlatFeeCents : contractPriceCents && commissionBasisPoints);
    const computedExpected = shouldComputeExpected
      ? isFlatFeeMode
        ? Math.round((commissionFlatFeeCents! * referralFeeBasisPoints) / 10_000)
        : Math.round((contractPriceCents! * commissionBasisPoints! * referralFeeBasisPoints) / 100_000_000)
      : 0;
    const finalExpectedAmountCents =
      isAgentOrigin || isNoFeeDeal ? 0 : expectedAmountCents || computedExpected;

    if (!isAgentOrigin && !isNoFeeDeal && markPaid && !netReferralFeePaidCents && finalExpectedAmountCents) {
      netReferralFeePaidCents = finalExpectedAmountCents;
    }

    if (
      !isAgentOrigin &&
      !isNoFeeDeal &&
      !finalExpectedAmountCents &&
      referralFeeBasisPoints !== 0
    ) {
      toast.error('Enter an expected amount or fill price, commission, and referral fee percentages');
      return;
    }

      if (status === 'terminated' && !terminatedReason) {
        toast.error('Select a termination reason');
        return;
      }

      setSubmitting(true);
      try {
        const statusToSend = viewerRole === 'admin' && markPaid ? 'paid' : status;
        const closingDateToSend =
          statusToSend === 'closed'
            ? new Date().toISOString()
            : closingDate
              ? dateStringToLocalISO(closingDate)
              : null;
        const response = await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referralId,
            status: statusToSend,
            expectedAmountCents: finalExpectedAmountCents,
            receivedAmountCents: netReferralFeePaidCents,
          netReferralFeePaidCents,
          contractPriceCents,
          commissionBasisPoints,
          commissionFlatFeeCents,
          referralFeeBasisPoints,
          propertyAddress: propertyAddress.trim() || null,
          propertyCity: propertyCity.trim() || null,
          propertyState: propertyState.trim().toUpperCase() || null,
          closingDate: closingDateToSend,
          underContractDate: underContractDate ? dateStringToLocalISO(underContractDate) : new Date().toISOString(),
          agentId: agentId || null,
          usedAfc: isAgentOrigin ? false : effectiveCreateSide === 'sell' ? false : usedAfc,
          usedAssignedAgent: isAgentOrigin ? true : usedAssignedAgent,
          agentAttribution: isOutsideAgent ? 'OUTSIDE_AGENT' : null,
          side: effectiveCreateSide,
          terminatedReason: statusToSend === 'terminated' ? terminatedReason : undefined,
        }),
      });

      if (!response.ok) {
        toast.error('Unable to save deal');
        return;
      }

      const payload = (await response.json()) as { id: string; createdAt?: string };
        onDealCreated({
          _id: payload.id,
          status: statusToSend,
          expectedAmountCents: finalExpectedAmountCents,
          receivedAmountCents: netReferralFeePaidCents,
          netReferralFeePaidCents,
          contractPriceCents,
          commissionBasisPoints,
          commissionFlatFeeCents,
          referralFeeBasisPoints,
          propertyAddress: propertyAddress.trim() || null,
          propertyCity: propertyCity.trim() || null,
          propertyState: propertyState.trim().toUpperCase() || null,
          closingDate: closingDateToSend,
          underContractDate: underContractDate ? dateStringToLocalISO(underContractDate) : new Date().toISOString(),
          agent: agentId ? { id: agentId, name: agents.find((option) => option.id === agentId)?.name ?? null } : null,
          agentId: agentId || null,
          usedAfc: isAgentOrigin ? false : effectiveCreateSide === 'sell' ? false : usedAfc,
          usedAssignedAgent: isAgentOrigin ? true : usedAssignedAgent,
          side: effectiveCreateSide,
          terminatedReason: statusToSend === 'terminated' ? terminatedReason : undefined,
          createdAt: payload.createdAt ?? new Date().toISOString(),
          updatedAt: payload.createdAt ?? new Date().toISOString(),
          paidDate: null,
          invoiceDate: null,
        });
      setShowForm(false);
      toast.success('Deal added');
    } catch (error) {
      console.error(error);
      toast.error('Something went wrong while saving the deal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (
    deal: ReferralPayment,
    nextStatus: DealStatus,
    terminationReason?: TerminatedReason | null,
    paidAmountCents?: number,
    paidDateFromAction?: string
  ): Promise<boolean> => {
    if (statusUpdating[deal._id]) return false;
    if (nextStatus === 'terminated' && !terminationReason) {
      toast.error('Select a termination reason before marking the deal terminated');
      return false;
    }
    
    let closingDate: string | undefined;
    let paidDate: string | undefined;
    let sendClosedEmails = false;
    let sendAgentNpsEmail = false;

    if (nextStatus === 'closed') {
      const usedAssignedAgent = deal.usedAssignedAgent ?? false;
      const closeUsedAfc = deal.side === 'sell' ? false : Boolean(deal.usedAfc);

      if (viewerRole === 'admin' || viewerRole === 'agent') {
        const confirmation = await confirmCloseStatusDate({
          initialDateIso: deal.closingDate ?? null,
          canSendClosedEmails: viewerRole === 'admin' ? usedAssignedAgent : false,
          defaultSendClosedEmails: viewerRole === 'admin' ? usedAssignedAgent : false,
          canSendAgentNpsEmail: viewerRole === 'admin' ? closeUsedAfc : false,
          defaultSendAgentNpsEmail: viewerRole === 'admin' ? closeUsedAfc : false,
          showEmailPreference: viewerRole === 'admin',
        });

        if (!confirmation.confirmed) {
          return false;
        }

        closingDate = confirmation.closingDateIso;
        sendClosedEmails =
          viewerRole === 'admin' ? confirmation.sendClosedEmails : true;
        sendAgentNpsEmail =
          viewerRole === 'admin' ? confirmation.sendAgentNpsEmail : true;

        if (sendClosedEmails) {
          toast.success('A referral rating email will be sent to the referral.');
        }
        if (sendAgentNpsEmail) {
          toast.success('An MC NPS email will be sent to the agent.');
        }
      }
    }

    if (nextStatus === 'paid' && viewerRole === 'admin') {
      if (paidDateFromAction) {
        paidDate = paidDateFromAction;
      } else {
        const confirmation = await confirmPaidStatusDate({
          initialDateIso: deal.paidDate ?? null,
        });
        if (!confirmation.confirmed) {
          return false;
        }
        paidDate = confirmation.paidDateIso;
      }
    }
    
    setStatusUpdating((previous) => ({ ...previous, [deal._id]: true }));
    try {
      const fallbackPaidCents =
        nextStatus === 'paid'
          ? paidAmountCents ??
            deal.netReferralFeePaidCents ??
            deal.receivedAmountCents ??
            deal.expectedAmountCents ??
            0
          : undefined;
      const patchPayload: Record<string, unknown> = {
        id: deal._id,
        status: nextStatus,
        closingDate,
        paidDate,
        receivedAmountCents: fallbackPaidCents,
        netReferralFeePaidCents: fallbackPaidCents,
        sendClosedEmails,
        sendAgentNpsEmail,
      };
      if (nextStatus === 'closed') {
        patchPayload.usedAfc = deal.side === 'sell' ? false : Boolean(deal.usedAfc);
      }
      if (nextStatus === 'terminated') {
        patchPayload.terminatedReason = terminationReason ?? null;
      }

      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
      });

      if (!response.ok) {
        toast.error('Unable to update deal stage');
        return false;
      }
      const patchResult = (await response.json()) as PaymentPatchResponse;
      const resolvedPaidAmountCents =
        patchResult.netReferralFeePaidCents ??
        patchResult.receivedAmountCents ??
        fallbackPaidCents;

      onDealUpdated?.({
        ...deal,
        status: patchResult.status ?? nextStatus,
        expectedAmountCents: patchResult.expectedAmountCents ?? deal.expectedAmountCents,
        receivedAmountCents: resolvedPaidAmountCents ?? deal.receivedAmountCents,
        netReferralFeePaidCents: resolvedPaidAmountCents ?? deal.netReferralFeePaidCents,
        terminatedReason: nextStatus === 'terminated' ? terminationReason ?? null : null,
        closingDate: patchResult.closingDate ?? closingDate ?? deal.closingDate ?? null,
        paidDate: patchResult.paidDate ?? paidDate ?? deal.paidDate ?? null,
        updatedAt: new Date().toISOString(),
      }, {
        referralStatus: patchResult.referralStatus,
        referralStatusLastUpdated: patchResult.referralStatusLastUpdated,
      });
      toast.success('Deal stage updated');
      return true;
    } catch (error) {
      console.error(error);
      toast.error('Something went wrong while updating the deal');
      return false;
    } finally {
      setStatusUpdating((previous) => {
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
    }
  };

  const handleDelete = async (deal: ReferralPayment) => {
    if (deleting[deal._id]) return;
    const confirmed = window.confirm('Are you sure you want to delete this deal?');
    if (!confirmed) return;
    setDeleting((previous) => ({ ...previous, [deal._id]: true }));
    try {
      const response = await fetch('/api/payments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal._id }),
      });

      if (!response.ok) {
        toast.error('Unable to delete deal');
        return;
      }

      onDealDeleted?.(deal._id);
      toast.success('Deal deleted');
    } catch (error) {
      console.error(error);
      toast.error('Something went wrong while deleting the deal');
    } finally {
      setDeleting((previous) => {
        const next = { ...previous };
        delete next[deal._id];
        return next;
      });
    }
  };

  const handleDealEdit = async (deal: ReferralPayment, payload: DealUpdatePayload) => {
    try {
      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal._id, ...payload }),
      });

      if (!response.ok) {
        toast.error('Unable to update deal');
        return false;
      }
      const patchResult = (await response.json()) as PaymentPatchResponse;

      // Preserve agentId - payload always includes it (even if null to unassign)
      const updatedAgentId = payload.agentId ?? null;
      const agentName = updatedAgentId
        ? agents.find((option) => option.id === updatedAgentId)?.name ?? null
        : null;
      onDealUpdated?.({
        ...deal,
        status: patchResult.status ?? payload.status ?? deal.status,
        expectedAmountCents: patchResult.expectedAmountCents ?? payload.expectedAmountCents ?? deal.expectedAmountCents,
        receivedAmountCents: patchResult.receivedAmountCents ?? payload.netReferralFeePaidCents,
        netReferralFeePaidCents: patchResult.netReferralFeePaidCents ?? payload.netReferralFeePaidCents,
        contractPriceCents: payload.contractPriceCents ?? null,
        commissionBasisPoints: payload.commissionBasisPoints ?? null,
        commissionFlatFeeCents: payload.commissionFlatFeeCents ?? null,
        referralFeeBasisPoints: payload.referralFeeBasisPoints ?? null,
        propertyAddress: payload.propertyAddress ?? null,
        propertyCity: payload.propertyCity ?? null,
        propertyState: payload.propertyState ?? null,
        closingDate: patchResult.closingDate ?? payload.closingDate ?? null,
        underContractDate: payload.underContractDate ?? null,
        agentId: updatedAgentId,
        agent: updatedAgentId
          ? { id: updatedAgentId, name: agentName }
          : null,
        side: payload.side ?? deal.side,
        usedAfc: (payload.side ?? deal.side) === 'sell' ? false : payload.usedAfc,
        usedAssignedAgent: payload.usedAssignedAgent,
        terminatedReason: payload.terminatedReason ?? null,
        paidDate: patchResult.paidDate ?? deal.paidDate ?? null,
        updatedAt: new Date().toISOString(),
      }, {
        referralStatus: patchResult.referralStatus,
        referralStatusLastUpdated: patchResult.referralStatusLastUpdated,
      });
      toast.success('Deal updated');
      return true;
    } catch (error) {
      console.error(error);
      toast.error('Something went wrong while updating the deal');
      return false;
    }
  };

  return (
    <section className="space-y-4 rounded-md border border-border bg-surface-raised p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-foreground-subtle">Deals</p>
          <h2 className="text-lg font-semibold text-foreground">Referral deals</h2>
        </div>
        {canManage && canCreateForViewer && (
          <button
            type="button"
            onClick={() => setShowForm((previous) => !previous)}
            className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-semibold text-foreground-muted shadow-sm transition hover:bg-surface-subtle"
          >
            <span className="text-lg leading-none">{showForm ? '−' : '+'}</span>
            {showForm ? 'Hide form' : 'Add deal'}
          </button>
        )}
      </div>

      {canManage && canCreateForViewer && showForm && (
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Contract price</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={contractPrice}
              onChange={(event) => setContractPrice(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="0.00"
              disabled={submitting}
            />
          </label>
          {!isAgentOrigin && (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground-muted">Commission</span>
                  <div className="flex rounded border border-border-strong text-xs font-medium overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleCommissionModeToggle('%')}
                      disabled={submitting || !usedAssignedAgent || isAgitDeal}
                      className={`px-1.5 py-0.5 transition-colors ${commissionMode === '%' ? 'bg-primary-600 text-white' : 'bg-surface-raised text-foreground-subtle hover:bg-surface-muted'}`}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCommissionModeToggle('$')}
                      disabled={submitting || !usedAssignedAgent || isAgitDeal}
                      className={`px-1.5 py-0.5 transition-colors ${commissionMode === '$' ? 'bg-primary-600 text-white' : 'bg-surface-raised text-foreground-subtle hover:bg-surface-muted'}`}
                    >
                      $
                    </button>
                  </div>
                </div>
                {commissionMode === '%' ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={commissionPercentage}
                    onChange={(event) => handleCommissionPercentageChange(event.target.value)}
                    className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                    placeholder="0.00"
                    disabled={submitting || !usedAssignedAgent || isAgitDeal}
                  />
                ) : (
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={commissionFlat}
                    onChange={(event) => handleCommissionFlatChange(event.target.value)}
                    className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                    placeholder="0.00"
                    disabled={submitting || !usedAssignedAgent || isAgitDeal}
                  />
                )}
              </div>
              <label className="space-y-1 text-sm font-medium text-foreground-muted">
                <span>Referral fee %</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={referralFeePercentage}
                  onChange={(event) => setReferralFeePercentage(event.target.value)}
                  className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting || !usedAssignedAgent || isAgitDeal}
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-foreground-muted">
                <span>Expected amount</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={expectedAmount}
                  onChange={(event) => {
                    const value = event.target.value;
                    setExpectedManuallyEdited(Boolean(value));
                    setExpectedAmount(value);
                  }}
                  className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting || !usedAssignedAgent || isAgitDeal}
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-foreground-muted">
                <span>Net referral fee paid (optional)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={netReferralFeePaid}
                  onChange={(event) => setNetReferralFeePaid(event.target.value)}
                  className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting || !usedAssignedAgent || isAgitDeal}
                />
              </label>
            </>
          )}
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as DealStatus)}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                disabled={submitting}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              </select>
            </label>
            {status === 'terminated' && (
              <label className="space-y-1 text-sm font-medium text-foreground-muted">
                <span>Termination reason</span>
                <select
                  value={terminatedReason ?? ''}
                  onChange={(event) =>
                    setTerminatedReason(
                      event.target.value ? (event.target.value as TerminatedReason) : null
                    )
                  }
                  className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                  disabled={submitting}
                >
                  <option value="">Select reason</option>
                  {TERMINATED_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Under contract date</span>
              <input
                type="date"
                value={underContractDate}
                onChange={(event) => setUnderContractDate(event.target.value)}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                disabled={submitting}
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Closing date</span>
              <input
                type="date"
                value={closingDate}
              onChange={(event) => setClosingDate(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted sm:col-span-2 lg:col-span-4">
            <span>Property address</span>
            <input
              type="text"
              value={propertyAddress}
              onChange={(event) => setPropertyAddress(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="123 Main St, City, ST"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Property city</span>
            <input
              type="text"
              value={propertyCity}
              onChange={(event) => setPropertyCity(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              placeholder="City"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Property state</span>
            <input
              type="text"
              value={propertyState}
              maxLength={2}
              onChange={(event) => {
                const value = event.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
                setPropertyState(value);
              }}
              onPaste={(event) => {
                event.preventDefault();
                const pastedText = event.clipboardData.getData('text');
                const processed = pastedText.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
                setPropertyState(processed);
                event.currentTarget.value = processed;
              }}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm uppercase focus:border-primary-500 focus:outline-none"
              placeholder="ST"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground-muted">
            <span>Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
              disabled={submitting || agentsLoading}
            >
              <option value="">Unassigned</option>
              {agentsLoading && agents.length === 0 ? (
                <option value="" disabled>Loading agents...</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))
              )}
            </select>
          </label>
          {!(viewerRole === 'agent' && (viewerAssignedSide === 'buy' || viewerAssignedSide === 'sell')) && (
            <label className="space-y-1 text-sm font-medium text-foreground-muted">
              <span>Deal side</span>
              <select
                value={side}
                onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none"
                disabled={submitting}
              >
                <option value="buy">Buy-side</option>
                <option value="sell">Sell-side</option>
              </select>
            </label>
          )}
          <div className="flex flex-col justify-center gap-2 rounded border border-border p-3 text-sm sm:col-span-2 lg:col-span-4">
            {effectiveCreateSide !== 'sell' && (
              <label className="flex items-center gap-2 text-foreground-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-strong"
                  checked={usedAfc}
                  onChange={(event) => setUsedAfc(event.target.checked)}
                  disabled={submitting}
                />
                Used AFC
              </label>
            )}
            <label className="flex items-center gap-2 text-foreground-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong"
                checked={usedAssignedAgent}
                onChange={(event) => setUsedAssignedAgent(event.target.checked)}
                disabled={submitting}
              />
              Used Agent
            </label>
            {!isAgentOrigin && (!usedAssignedAgent || isAgitDeal) && (
              <p className="text-xs text-foreground-subtle">
                {isAgitDeal
                  ? 'AGIT agent deal: no referral fee is collected. Commission/referral fee fields are disabled and owed amount is forced to $0.'
                  : 'Outside-agent deal selected: commission/referral fee fields are disabled and owed amount is forced to $0.'}
              </p>
            )}
            {viewerRole === 'admin' && (
              <label className="flex items-center gap-2 text-foreground-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-strong"
                  checked={markPaid || status === 'paid'}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setMarkPaid(checked);
                    if (checked) {
                      setStatus('paid');
                      if (!netReferralFeePaid) {
                        setNetReferralFeePaid(expectedAmount);
                      }
                    }
                  }}
                  disabled={submitting}
                />
                Paid
              </label>
            )}
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? 'Saving…' : 'Add deal'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {sortedDeals.length === 0 ? (
          shouldHideAgentEmptyState ? null : (
          <p className="text-sm text-foreground-muted">No deals have been added yet.</p>
          )
        ) : (
          <>
            {sortedDeals.map((deal) => (
              <DealCard
                key={deal._id}
                deal={deal}
                agents={agents}
                agentsLoading={agentsLoading}
                canManage={
                  canManage &&
                  !(
                    viewerRole === 'agent' &&
                    (deal.isCrossSideReadOnly === true ||
                      ((viewerAssignedSide === 'buy' || viewerAssignedSide === 'sell') &&
                        (deal.side === 'buy' || deal.side === 'sell') &&
                        deal.side !== viewerAssignedSide))
                  )
                }
                isCrossSideReadOnly={
                  viewerRole === 'agent' &&
                  (deal.isCrossSideReadOnly === true ||
                    ((viewerAssignedSide === 'buy' || viewerAssignedSide === 'sell') &&
                      (deal.side === 'buy' || deal.side === 'sell') &&
                      deal.side !== viewerAssignedSide))
                }
                isAgentOrigin={isAgentOrigin}
                isAgitDeal={isAgitDeal}
                statusUpdating={statusUpdating[deal._id]}
                deleting={deleting[deal._id]}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onUpdate={handleDealEdit}
                viewerRole={viewerRole}
                feeBreakdownAutoSendEnabled={feeBreakdownAutoSendEnabled}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}
