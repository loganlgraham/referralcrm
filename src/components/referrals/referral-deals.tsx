'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { DEAL_STATUS_LABELS, DEAL_STATUS_OPTIONS, type DealStatus } from '@/constants/deals';
import { formatCurrency, formatDateMST, formatDateTimeMST } from '@/utils/formatters';
import type { ReferralPayment } from '@/types/referral-payment';

interface ReferralDealsProps {
  referralId: string;
  deals: ReferralPayment[];
  onDealCreated: (deal: ReferralPayment) => void;
  onDealUpdated?: (deal: ReferralPayment) => void;
  onDealDeleted?: (id: string) => void;
  viewerRole?: string;
  referralOrigin?: 'agent' | 'admin' | 'mc' | null;
  feeBreakdownAutoSendEnabled?: boolean;
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
  referralFeeBasisPoints: number | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  agentId: string | null;
  closingDate: string | null;
  side: 'buy' | 'sell';
  usedAfc: boolean;
  usedAssignedAgent: boolean;
  receivedAmountCents?: number;
  terminatedReason?: TerminatedReason | null;
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

function DealCard({
  deal,
  agents,
  agentsLoading,
  canManage,
  statusUpdating,
  deleting,
  isAgentOrigin,
  onStatusChange,
  onDelete,
  onUpdate,
  viewerRole,
}: {
  deal: ReferralPayment;
  agents: AgentOption[];
  agentsLoading: boolean;
  canManage: boolean;
  statusUpdating?: boolean;
  deleting?: boolean;
  isAgentOrigin?: boolean;
  onStatusChange: (
    deal: ReferralPayment,
    status: DealStatus,
    terminationReason?: TerminatedReason | null
  ) => void;
  onDelete: (deal: ReferralPayment) => void;
  onUpdate: (deal: ReferralPayment, payload: DealUpdatePayload) => Promise<boolean>;
  viewerRole?: string;
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
  const [commissionPercentage, setCommissionPercentage] = useState(
    basisPointsToDisplay(deal.commissionBasisPoints)
  );
  const [referralFeePercentage, setReferralFeePercentage] = useState(
    basisPointsToDisplay(deal.referralFeeBasisPoints)
  );
  const [propertyAddress, setPropertyAddress] = useState(deal.propertyAddress ?? '');
  const [propertyCity, setPropertyCity] = useState(deal.propertyCity ?? '');
  const [propertyState, setPropertyState] = useState(deal.propertyState ?? '');
  const [closingDate, setClosingDate] = useState(deal.closingDate ? deal.closingDate.slice(0, 10) : '');
  const [agentId, setAgentId] = useState(deal.agentId ?? deal.agent?.id ?? '');
  const [side, setSide] = useState<'buy' | 'sell'>(deal.side ?? 'buy');
  const [usedAfc, setUsedAfc] = useState(Boolean(deal.usedAfc));
  const [usedAssignedAgent, setUsedAssignedAgent] = useState(deal.usedAssignedAgent ?? true);
  const [markPaid, setMarkPaid] = useState(deal.status === 'paid');
  const [terminatedReason, setTerminatedReason] = useState<TerminatedReason | null>(
    (deal.terminatedReason as TerminatedReason | undefined) ?? null
  );
  const agentCreatedReferral = Boolean(isAgentOrigin);
  const router = useRouter();

  const populateFromDeal = useCallback(() => {
    setStatus((deal.status as DealStatus | undefined) ?? 'under_contract');
    setExpectedAmount(centsToDisplay(deal.expectedAmountCents));
    setExpectedManuallyEdited(false);
    setNetReferralFeePaid(centsToDisplay(deal.netReferralFeePaidCents ?? deal.receivedAmountCents));
    setContractPrice(centsToDisplay(deal.contractPriceCents));
    setCommissionPercentage(basisPointsToDisplay(deal.commissionBasisPoints));
    setReferralFeePercentage(basisPointsToDisplay(deal.referralFeeBasisPoints));
    setPropertyAddress(deal.propertyAddress ?? '');
    setPropertyCity(deal.propertyCity ?? '');
    setPropertyState(deal.propertyState ?? '');
    setClosingDate(deal.closingDate ? deal.closingDate.slice(0, 10) : '');
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

  const handleSendFeeBreakdown = async () => {
    const confirmed = window.confirm(
      'Send fee breakdown email to agent now?\n\n' +
        'If you send manually, the automatic send (7 days before closing) will be disabled for this deal.'
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/payments/${deal._id}/send-fee-breakdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    if (expectedManuallyEdited || agentCreatedReferral) return;
    const contract = Number.parseFloat(contractPrice);
    const commission = Number.parseFloat(commissionPercentage);
    const referral = Number.parseFloat(referralFeePercentage);
    if (Number.isFinite(contract) && Number.isFinite(commission) && Number.isFinite(referral)) {
      const computed = ((contract * commission) / 100) * (referral / 100);
      if (Number.isFinite(computed)) {
        setExpectedAmount(computed.toFixed(2));
      }
    }
    }, [commissionPercentage, contractPrice, referralFeePercentage, expectedManuallyEdited, agentCreatedReferral]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || saving) return;

    const expectedAmountCents = agentCreatedReferral ? 0 : toCents(expectedAmount);
    let netReferralFeePaidCents = agentCreatedReferral ? 0 : toCents(netReferralFeePaid);
    const contractPriceCents = contractPrice ? toCents(contractPrice) : null;
    const commissionBasisPoints = agentCreatedReferral
      ? null
      : commissionPercentage
          ? Math.round(Number.parseFloat(commissionPercentage) * 100)
          : null;
    const referralFeeBasisPoints = agentCreatedReferral
      ? null
      : referralFeePercentage
          ? Math.round(Number.parseFloat(referralFeePercentage) * 100)
          : null;

    const shouldComputeExpected =
      !agentCreatedReferral &&
      !expectedAmountCents &&
      contractPriceCents &&
      commissionBasisPoints &&
      referralFeeBasisPoints;
    const computedExpected = shouldComputeExpected
      ? Math.round((contractPriceCents * commissionBasisPoints * referralFeeBasisPoints) / 100_000_000)
      : 0;
    const finalExpectedAmountCents = agentCreatedReferral ? 0 : expectedAmountCents || computedExpected;

    if (!agentCreatedReferral && markPaid && !netReferralFeePaidCents && finalExpectedAmountCents) {
      netReferralFeePaidCents = finalExpectedAmountCents;
    }

    if (!agentCreatedReferral && !finalExpectedAmountCents) {
      toast.error('Enter an expected amount or fill price, commission, and referral fee percentages');
      return;
    }

    setSaving(true);
    const statusToSend = markPaid ? 'paid' : status;
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
      referralFeeBasisPoints,
      propertyAddress: propertyAddress.trim() || null,
      propertyCity: propertyCity.trim() || null,
      propertyState: propertyState.trim().toUpperCase() || null,
      closingDate: closingDateToSend,
      // Always include agentId, even if empty (will be converted to null)
      agentId: agentId.trim() || null,
      side,
      usedAfc,
      usedAssignedAgent,
      receivedAmountCents: netReferralFeePaidCents,
      terminatedReason: statusToSend === 'terminated' ? terminatedReason : null,
    });

    if (success) {
      setEditing(false);
      setExpectedManuallyEdited(false);
    }
    setSaving(false);
  };

  const statusLabel = DEAL_STATUS_LABELS[(deal.status as DealStatus | undefined) ?? 'under_contract'];
  const expected = formatCurrency(deal.status === 'paid' ? 0 : deal.expectedAmountCents ?? 0);
  const netPaidCents =
    deal.netReferralFeePaidCents ??
    deal.receivedAmountCents ??
    (deal.status === 'paid' ? deal.expectedAmountCents ?? 0 : 0);
  const netPaid = formatCurrency(netPaidCents ?? 0);
  const contractPriceValue = deal.contractPriceCents ? formatCurrency(deal.contractPriceCents) : '—';
  const dealSide = deal.side === 'sell' ? 'Sell-side' : 'Buy-side';
  const terminatedReasonLabel = terminatedReason
    ? TERMINATED_REASON_OPTIONS.find((option) => option.value === terminatedReason)?.label ??
      terminatedReason
    : null;

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs uppercase text-slate-500">Status</p>
            <p className="text-sm font-semibold text-slate-900">{statusLabel}</p>
            <p className="text-xs text-slate-500">Created {formatDateMST(deal.createdAt)}</p>
            <p className="text-xs text-slate-500">
              Closing date: {deal.closingDate ? formatDateMST(deal.closingDate) : '—'}
            </p>
            {deal.status === 'terminated' && (
              <p className="text-xs font-medium text-rose-600">
                Termination reason: {terminatedReasonLabel ?? 'Not specified'}
              </p>
            )}
          </div>
          <label className="block text-xs font-semibold text-slate-600">
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
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs shadow-sm focus:border-brand focus:outline-none"
            >
              {DEAL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {canManage && (
            <label className="block text-xs font-semibold text-slate-600">
              <span className="mr-2">Termination reason</span>
              <select
                value={terminatedReason ?? ''}
                onChange={(event) =>
                  setTerminatedReason(
                    event.target.value ? (event.target.value as TerminatedReason) : null
                  )
                }
                disabled={!canManage || statusUpdating}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs shadow-sm focus:border-brand focus:outline-none"
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
        <div className="space-y-1">
          <p className="text-xs uppercase text-slate-500">Expected</p>
          <p className="text-sm font-semibold text-slate-900">{expected}</p>
          <p className="text-xs text-slate-500">Net paid: {netPaid}</p>
        </div>
        <div className="space-y-1 text-sm text-slate-700">
          <p>
            <span className="text-xs uppercase text-slate-500">Contract price: </span>
            <span className="font-semibold">{contractPriceValue}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Commission: </span>
            <span className="font-semibold">{formatPercent(deal.commissionBasisPoints)}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Referral fee: </span>
            <span className="font-semibold">{formatPercent(deal.referralFeeBasisPoints)}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Side: </span>
            <span className="font-semibold">{dealSide}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Used AFC: </span>
            <span className="font-semibold">{deal.usedAfc ? 'Yes' : 'No'}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Used Agent: </span>
            <span className="font-semibold">{deal.usedAssignedAgent ? 'Yes' : 'No'}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Address: </span>
            <span className="font-semibold">{deal.propertyAddress?.trim() || '—'}</span>
          </p>
          <p>
            <span className="text-xs uppercase text-slate-500">Agent: </span>
            <span className="font-semibold">{deal.agent?.name ?? 'Unassigned'}</span>
          </p>
        </div>
        {canManage && (
          <div className="flex flex-col gap-2 sm:w-44">
            <button
              type="button"
              onClick={() => onStatusChange(deal, 'paid')}
              disabled={statusUpdating}
              className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Mark Paid
            </button>
            <button
              type="button"
              onClick={() => setEditing((previous) => !previous)}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
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
                  Send Fee Breakdown Email
                </button>
                {deal.closingDate && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-slate-500">
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
        <form onSubmit={handleSubmit} className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Contract price</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={contractPrice}
              onChange={(event) => setContractPrice(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Commission %</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={commissionPercentage}
              onChange={(event) => setCommissionPercentage(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Referral fee %</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={referralFeePercentage}
              onChange={(event) => setReferralFeePercentage(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
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
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Net referral fee paid (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={netReferralFeePaid}
              onChange={(event) => setNetReferralFeePaid(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={saving}
            />
          </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as DealStatus)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                disabled={saving}
              >
                {DEAL_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              </select>
            </label>
            {status === 'terminated' && (
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Termination reason</span>
                <select
                  value={terminatedReason ?? ''}
                  onChange={(event) =>
                    setTerminatedReason(
                      event.target.value ? (event.target.value as TerminatedReason) : null
                    )
                  }
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
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
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>Closing date</span>
              <input
                type="date"
                value={closingDate}
              onChange={(event) => setClosingDate(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Property address</span>
            <input
              type="text"
              value={propertyAddress}
              onChange={(event) => setPropertyAddress(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="123 Main St, City, ST"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Property city</span>
            <input
              type="text"
              value={propertyCity}
              onChange={(event) => setPropertyCity(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="City"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
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
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm uppercase focus:border-brand focus:outline-none"
              placeholder="ST"
              disabled={saving}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
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
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Deal side</span>
            <select
              value={side}
              onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              disabled={saving}
            >
              <option value="buy">Buy-side</option>
              <option value="sell">Sell-side</option>
            </select>
          </label>
          <div className="flex flex-col justify-center gap-2 rounded border border-slate-200 p-3 text-sm sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={usedAfc}
                onChange={(event) => setUsedAfc(event.target.checked)}
                disabled={saving}
              />
              Used AFC
            </label>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={usedAssignedAgent}
                onChange={(event) => setUsedAssignedAgent(event.target.checked)}
                disabled={saving}
              />
              Used Agent
            </label>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
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
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
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
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
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
  referralOrigin,
  feeBreakdownAutoSendEnabled,
}: ReferralDealsProps) {
  const [status, setStatus] = useState<DealStatus>('under_contract');
  const [markPaid, setMarkPaid] = useState(false);
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expectedManuallyEdited, setExpectedManuallyEdited] = useState(false);
  const [netReferralFeePaid, setNetReferralFeePaid] = useState('');
  const [contractPrice, setContractPrice] = useState('');
  const [commissionPercentage, setCommissionPercentage] = useState('');
  const [referralFeePercentage, setReferralFeePercentage] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [agentId, setAgentId] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
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

  const canManage = viewerRole !== 'viewer';

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
    const contract = Number.parseFloat(contractPrice);
    const commission = Number.parseFloat(commissionPercentage);
    const referral = Number.parseFloat(referralFeePercentage);
    if (Number.isFinite(contract) && Number.isFinite(commission) && Number.isFinite(referral)) {
      const computed = ((contract * commission) / 100) * (referral / 100);
      if (Number.isFinite(computed)) {
        setExpectedAmount(computed.toFixed(2));
      }
    }
  }, [commissionPercentage, contractPrice, referralFeePercentage, expectedManuallyEdited]);

  const sortedDeals = useMemo(
    () => [...deals].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    }),
    [deals]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || submitting) return;

    const expectedAmountCents = isAgentOrigin ? 0 : toCents(expectedAmount);
    let netReferralFeePaidCents = isAgentOrigin ? 0 : toCents(netReferralFeePaid);
    const contractPriceCents = contractPrice ? toCents(contractPrice) : null;
    const commissionBasisPoints = isAgentOrigin
      ? null
      : commissionPercentage
          ? Math.round(Number.parseFloat(commissionPercentage) * 100)
          : null;
    const referralFeeBasisPoints = isAgentOrigin
      ? null
      : referralFeePercentage
          ? Math.round(Number.parseFloat(referralFeePercentage) * 100)
          : null;

    const shouldComputeExpected =
      !isAgentOrigin && !expectedAmountCents && contractPriceCents && commissionBasisPoints && referralFeeBasisPoints;
    const computedExpected = shouldComputeExpected
      ? Math.round((contractPriceCents * commissionBasisPoints * referralFeeBasisPoints) / 100_000_000)
      : 0;
    const finalExpectedAmountCents = isAgentOrigin ? 0 : expectedAmountCents || computedExpected;

    if (!isAgentOrigin && markPaid && !netReferralFeePaidCents && finalExpectedAmountCents) {
      netReferralFeePaidCents = finalExpectedAmountCents;
    }

    if (!isAgentOrigin && !finalExpectedAmountCents) {
      toast.error('Enter an expected amount or fill price, commission, and referral fee percentages');
      return;
    }

      if (status === 'terminated' && !terminatedReason) {
        toast.error('Select a termination reason');
        return;
      }

      setSubmitting(true);
      try {
        const statusToSend = markPaid ? 'paid' : status;
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
          referralFeeBasisPoints,
          propertyAddress: propertyAddress.trim() || null,
          propertyCity: propertyCity.trim() || null,
          propertyState: propertyState.trim().toUpperCase() || null,
          closingDate: closingDateToSend,
          agentId: agentId || null,
          usedAfc: isAgentOrigin ? false : usedAfc,
          usedAssignedAgent: isAgentOrigin ? true : usedAssignedAgent,
          side,
          terminatedReason: statusToSend === 'terminated' ? terminatedReason : null,
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
          referralFeeBasisPoints,
          propertyAddress: propertyAddress.trim() || null,
          propertyCity: propertyCity.trim() || null,
          propertyState: propertyState.trim().toUpperCase() || null,
          closingDate: closingDateToSend,
          agent: agentId ? { id: agentId, name: agents.find((option) => option.id === agentId)?.name ?? null } : null,
          agentId: agentId || null,
          usedAfc: isAgentOrigin ? false : usedAfc,
          usedAssignedAgent: isAgentOrigin ? true : usedAssignedAgent,
          side,
          terminatedReason: statusToSend === 'terminated' ? terminatedReason : null,
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
    terminationReason?: TerminatedReason | null
  ) => {
    if (statusUpdating[deal._id]) return;
    if (nextStatus === 'terminated' && !terminationReason) {
      toast.error('Select a termination reason before marking the deal terminated');
      return;
    }
    
    // Check survey email readiness when closing deal
    let sendClosedEmails = false;
    if (nextStatus === 'closed') {
      const usedAfc = deal.usedAfc ?? false;
      const usedAssignedAgent = deal.usedAssignedAgent ?? false;
      
      if (usedAssignedAgent) {
        const emailMessage = usedAfc
          ? 'Send congratulations emails to the agent and borrower? (includes AFC rating survey)'
          : 'Send congratulations emails to the agent and borrower?';
        const confirmed = window.confirm(emailMessage);
        sendClosedEmails = confirmed;
        if (confirmed) {
          toast.success('Survey emails will be sent to the agent and borrower.');
        }
      } else {
        toast.warning('Survey emails will not be sent. Please ensure the assigned agent is marked as used.');
      }
    }
    
    setStatusUpdating((previous) => ({ ...previous, [deal._id]: true }));
    try {
      const closingDate = nextStatus === 'closed' ? new Date().toISOString() : undefined;
      const fallbackPaidCents =
        nextStatus === 'paid'
          ? deal.netReferralFeePaidCents ??
            deal.receivedAmountCents ??
            deal.expectedAmountCents ??
            0
          : undefined;
      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: deal._id,
          status: nextStatus,
          terminatedReason: nextStatus === 'terminated' ? terminationReason : null,
          closingDate,
          receivedAmountCents: fallbackPaidCents,
          netReferralFeePaidCents: fallbackPaidCents,
          sendClosedEmails,
        }),
      });

      if (!response.ok) {
        toast.error('Unable to update deal stage');
        return;
      }

      onDealUpdated?.({
        ...deal,
        status: nextStatus,
        terminatedReason: nextStatus === 'terminated' ? terminationReason ?? null : null,
        closingDate: closingDate ?? deal.closingDate ?? null,
        updatedAt: new Date().toISOString(),
      });
      toast.success('Deal stage updated');
    } catch (error) {
      console.error(error);
      toast.error('Something went wrong while updating the deal');
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

      // Preserve agentId - payload always includes it (even if null to unassign)
      const updatedAgentId = payload.agentId ?? null;
      const agentName = updatedAgentId
        ? agents.find((option) => option.id === updatedAgentId)?.name ?? null
        : null;
      onDealUpdated?.({
        ...deal,
        status: payload.status ?? deal.status,
        expectedAmountCents: payload.expectedAmountCents ?? deal.expectedAmountCents,
        receivedAmountCents: payload.netReferralFeePaidCents,
        netReferralFeePaidCents: payload.netReferralFeePaidCents,
        contractPriceCents: payload.contractPriceCents ?? null,
        commissionBasisPoints: payload.commissionBasisPoints ?? null,
        referralFeeBasisPoints: payload.referralFeeBasisPoints ?? null,
        propertyAddress: payload.propertyAddress ?? null,
        propertyCity: payload.propertyCity ?? null,
        propertyState: payload.propertyState ?? null,
        closingDate: payload.closingDate ?? null,
        agentId: updatedAgentId,
        agent: updatedAgentId
          ? { id: updatedAgentId, name: agentName }
          : null,
        side: payload.side ?? deal.side,
        usedAfc: payload.usedAfc,
        usedAssignedAgent: payload.usedAssignedAgent,
        terminatedReason: payload.terminatedReason ?? null,
        updatedAt: new Date().toISOString(),
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
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-slate-500">Deals</p>
          <h2 className="text-lg font-semibold text-slate-900">Referral deals</h2>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((previous) => !previous)}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            <span className="text-lg leading-none">{showForm ? '−' : '+'}</span>
            {showForm ? 'Hide form' : 'Add deal'}
          </button>
        )}
      </div>

      {canManage && showForm && (
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 rounded-md border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Contract price</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={contractPrice}
              onChange={(event) => setContractPrice(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={submitting}
            />
          </label>
          {!isAgentOrigin && (
            <>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Commission %</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={commissionPercentage}
                  onChange={(event) => setCommissionPercentage(event.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting}
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Referral fee %</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={referralFeePercentage}
                  onChange={(event) => setReferralFeePercentage(event.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting}
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
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
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting}
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Net referral fee paid (optional)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={netReferralFeePaid}
                  onChange={(event) => setNetReferralFeePaid(event.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                  placeholder="0.00"
                  disabled={submitting}
                />
              </label>
            </>
          )}
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as DealStatus)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                disabled={submitting}
              >
                {DEAL_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              </select>
            </label>
            {status === 'terminated' && (
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Termination reason</span>
                <select
                  value={terminatedReason ?? ''}
                  onChange={(event) =>
                    setTerminatedReason(
                      event.target.value ? (event.target.value as TerminatedReason) : null
                    )
                  }
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
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
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>Closing date</span>
              <input
                type="date"
                value={closingDate}
              onChange={(event) => setClosingDate(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">
            <span>Property address</span>
            <input
              type="text"
              value={propertyAddress}
              onChange={(event) => setPropertyAddress(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="123 Main St, City, ST"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Property city</span>
            <input
              type="text"
              value={propertyCity}
              onChange={(event) => setPropertyCity(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="City"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
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
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm uppercase focus:border-brand focus:outline-none"
              placeholder="ST"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
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
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Deal side</span>
            <select
              value={side}
              onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              disabled={submitting}
            >
              <option value="buy">Buy-side</option>
              <option value="sell">Sell-side</option>
            </select>
          </label>
          <div className="flex flex-col justify-center gap-2 rounded border border-slate-200 p-3 text-sm sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={usedAfc}
                onChange={(event) => setUsedAfc(event.target.checked)}
                disabled={submitting}
              />
              Used AFC
            </label>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={usedAssignedAgent}
                onChange={(event) => setUsedAssignedAgent(event.target.checked)}
                disabled={submitting}
              />
              Used Agent
            </label>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
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
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? 'Saving…' : 'Add deal'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {sortedDeals.length === 0 ? (
          <p className="text-sm text-slate-600">No deals have been added yet.</p>
        ) : (
          sortedDeals.map((deal) => (
            <DealCard
              key={deal._id}
              deal={deal}
              agents={agents}
              agentsLoading={agentsLoading}
              canManage={canManage}
              isAgentOrigin={isAgentOrigin}
              statusUpdating={statusUpdating[deal._id]}
              deleting={deleting[deal._id]}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onUpdate={handleDealEdit}
              viewerRole={viewerRole}
            />
          ))
        )}
      </div>
    </section>
  );
}
