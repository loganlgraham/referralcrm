'use client';

import {
  ReactNode,
  useMemo,
  useState,
  useTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
} from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Clock } from 'lucide-react';

import { REFERRAL_STATUSES, ReferralStatus, type ReferralTimeline } from '@/constants/referrals';
import {
  TERMINATED_REASON_OPTIONS,
  type DealStatus,
  type TerminatedReason,
} from '@/constants/deals';
import { formatCurrency, formatNumber, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { shouldDefaultEmailMcForAgentNotes } from '@/utils/referral-email-defaults';
import { calculateTimelineDaysRemaining, formatTimelineCountdown } from '@/utils/timeline-countdown';
import { mapDealStatusToReferralStatusDisplay } from '@/lib/latest-deal-referral-status';
import { confirmCloseStatusDate } from '@/components/referrals/status-date-confirmation-toast';
export interface ReferralRow {
  _id: string;
  createdAt: string;
  updatedAt?: string | null;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  endorser?: string;
  clientType: 'Seller' | 'Buyer' | 'Both';
  dealSide?: 'buy' | 'sell' | null;
  buyStatus?: ReferralStatus | null;
  sellStatus?: ReferralStatus | null;
  viewerAssignedSide?: 'buy' | 'sell' | null;
  lookingInZip: string;
  lookingInZips?: string[];
  borrowerCurrentAddress?: string;
  propertyAddress?: string;
  stageOnTransfer?: string;
  initialNotes?: string;
  loanFileNumber: string;
  status: ReferralStatus;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  assignedAgentEmail?: string;
  assignedAgentPhone?: string;
  lenderName?: string;
  lenderEmail?: string;
  lenderPhone?: string;
  referralFeeDueCents?: number;
  preApprovalAmountCents?: number;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
  origin?: 'agent' | 'mc' | 'admin';
  timeline?: ReferralTimeline;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  hasAhaOosAgentAttached?: boolean;
  hasAhaDesignatedAgentAttached?: boolean;
  hasAhaAgentAttached?: boolean;
  urgentTaskCount?: number;
  autoUpdateRemindersEnabled?: boolean;
  hasAnyPayments?: boolean;
  hasAnyUsedAfcTrue?: boolean;
}

type TableMode = 'admin' | 'mc' | 'agent';

type DeliveryFailureReason = 'missing_configuration' | 'no_recipients' | 'unknown';

interface NoteActivityResponse {
  id: string;
  emailedTargets?: ('mc')[];
  deliveryFailed?: boolean;
  deliveryFailureReason?: DeliveryFailureReason;
}

type ReferralTableProps = {
  data: ReferralRow[] | undefined | null;
  mode: TableMode;
  showAgentOriginIndicator?: boolean;
  hideAgentColumn?: boolean;
  /** Below `md`, render stacked cards instead of a horizontal-scroll table (single subtree; no duplicate controls). */
  stackOnMobile?: boolean;
};

interface StatusSelectProps {
  referralId: string;
  value: ReferralStatus;
  dealStatusLabel?: string | null;
  defaultSide?: 'buy' | 'sell';
  side?: 'buy' | 'sell';
  compact?: boolean;
  roleMode?: TableMode;
  onStatusResolved?: (nextStatus: ReferralStatus) => void;
}

type StatusUpdateResponse = {
  status?: ReferralStatus | null;
  currentStatus?: ReferralStatus | null;
  deal?: {
    status?: DealStatus | null;
  } | null;
  error?:
    | string
    | {
        message?: string;
        general?: string[];
        status?: string[];
      };
};

const isReferralStatus = (value: unknown): value is ReferralStatus =>
  typeof value === 'string' && REFERRAL_STATUSES.includes(value as ReferralStatus);

const extractStatusErrorMessage = (payload: StatusUpdateResponse | null): string => {
  if (!payload?.error) {
    return 'Unable to update status';
  }

  if (typeof payload.error === 'string') {
    return payload.error;
  }

  const firstFieldError = payload.error.status?.[0] ?? payload.error.general?.[0];
  return payload.error.message ?? firstFieldError ?? 'Unable to update status';
};

const parseNumericInput = (value: string): number => {
  const numeric = Number.parseFloat(value.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

const toCents = (value: string): number => {
  const numeric = parseNumericInput(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 100);
};

const formatCurrencyInput = (value: string): string => {
  const sanitized = value.replace(/[^0-9.]/g, '');
  if (!sanitized) {
    return '';
  }

  const [wholeRaw, ...fractionSegments] = sanitized.split('.');
  const normalizedWhole = wholeRaw.replace(/^0+(?=\d)/, '');
  const wholeDigits = normalizedWhole || '0';
  const groupedWhole = wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fractionSegments.length === 0) {
    return groupedWhole;
  }

  const fraction = fractionSegments.join('').slice(0, 2);
  return `${groupedWhole}.${fraction}`;
};

const dateStringToLocalISO = (dateString: string): string => {
  if (!dateString) return '';
  if (dateString.includes('T')) return dateString;
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
};

interface UnderContractDealToastProps {
  defaultSide?: 'buy' | 'sell';
  onClose: () => void;
  onSubmit: (payload: {
    paymentPayload: Record<string, unknown>;
    contractDetails: {
      propertyAddress: string;
      propertyCity: string;
      propertyState: string;
      propertyPostalCode: string;
      contractPrice: number;
      agentCommissionPercentage: number;
      referralFeePercentage: number;
      dealSide: 'buy' | 'sell';
    };
  }) => Promise<void>;
}

function UnderContractDealToast({ onClose, onSubmit, defaultSide = 'buy' }: UnderContractDealToastProps) {
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expectedManuallyEdited, setExpectedManuallyEdited] = useState(false);
  const [contractPrice, setContractPrice] = useState('');
  const [commissionMode, setCommissionMode] = useState<'%' | '$'>('%');
  const [commissionPercentage, setCommissionPercentage] = useState('');
  const [commissionFlat, setCommissionFlat] = useState('');
  const [referralFeePercentage, setReferralFeePercentage] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyPostalCode, setPropertyPostalCode] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [underContractDate, setUnderContractDate] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>(defaultSide);
  const [usedAfc, setUsedAfc] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleDateInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    try {
      event.currentTarget.showPicker?.();
    } catch {
      // Fallback to native date input behavior for browsers without showPicker support.
    }
  }, []);

  useEffect(() => {
    if (expectedManuallyEdited) return;
    const referral = parseNumericInput(referralFeePercentage);
    if (!Number.isFinite(referral)) return;
    if (commissionMode === '$') {
      const flatFee = parseNumericInput(commissionFlat);
      if (Number.isFinite(flatFee)) {
        const computed = flatFee * (referral / 100);
        if (Number.isFinite(computed)) {
          setExpectedAmount(computed.toFixed(2));
        }
      }
      return;
    }
    const contract = parseNumericInput(contractPrice);
    const commission = parseNumericInput(commissionPercentage);
    if (Number.isFinite(contract) && Number.isFinite(commission)) {
      const computed = ((contract * commission) / 100) * (referral / 100);
      if (Number.isFinite(computed)) {
        setExpectedAmount(computed.toFixed(2));
      }
    }
  }, [commissionFlat, commissionMode, commissionPercentage, contractPrice, expectedManuallyEdited, referralFeePercentage]);

  useEffect(() => {
    if (side === 'sell' && usedAfc) {
      setUsedAfc(false);
    }
  }, [side, usedAfc]);

  return (
    <div className="w-[min(calc(100vw-1rem),40rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
      <h3 className="text-sm font-semibold text-slate-900">Add Deal Details</h3>
      <p className="mt-1 text-xs text-slate-500">Enter full deal info before moving referral to Under Contract.</p>
      <form
        className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting) return;
          if (!propertyAddress.trim() || !propertyCity.trim()) {
            toast.error('Property address and city are required.');
            return;
          }
          if (!/^[A-Za-z]{2}$/.test(propertyState.trim())) {
            toast.error('Property state must be a 2-letter code.');
            return;
          }
          if (!/^\d{5}(?:-\d{4})?$/.test(propertyPostalCode.trim())) {
            toast.error('Enter a valid property ZIP code.');
            return;
          }
          if (!contractPrice || parseNumericInput(contractPrice) <= 0) {
            toast.error('Contract price is required.');
            return;
          }
          if (!referralFeePercentage || parseNumericInput(referralFeePercentage) <= 0) {
            toast.error('Referral fee % is required.');
            return;
          }
          const contractPriceCents = toCents(contractPrice);
          const isFlatFeeMode = commissionMode === '$';
          const commissionBasisPoints = isFlatFeeMode
            ? null
            : commissionPercentage
            ? Math.round(parseNumericInput(commissionPercentage) * 100)
            : null;
          const commissionFlatFeeCents = isFlatFeeMode
            ? (commissionFlat ? toCents(commissionFlat) : null)
            : null;
          const referralFeeBasisPoints = referralFeePercentage
            ? Math.round(parseNumericInput(referralFeePercentage) * 100)
            : null;
          const expectedAmountCents = toCents(expectedAmount);
          const computedExpectedAmountCents =
            !expectedAmountCents && referralFeeBasisPoints
              ? isFlatFeeMode
                ? Math.round(((commissionFlatFeeCents ?? 0) * referralFeeBasisPoints) / 10_000)
                : Math.round((contractPriceCents * (commissionBasisPoints ?? 0) * referralFeeBasisPoints) / 100_000_000)
              : expectedAmountCents;
          const finalExpectedAmountCents = computedExpectedAmountCents;

          const agentCommissionPercentage = isFlatFeeMode
            ? commissionFlatFeeCents != null && contractPriceCents > 0
              ? (commissionFlatFeeCents / contractPriceCents) * 100
              : 0
            : (commissionBasisPoints ?? 0) / 100;
          const referralFeePercentageValue = (referralFeeBasisPoints ?? 0) / 100;
          const resolvedUnderContractDate = underContractDate
            ? dateStringToLocalISO(underContractDate)
            : new Date().toISOString();

          setSubmitting(true);
          try {
            await onSubmit({
              paymentPayload: {
                status: 'under_contract',
                expectedAmountCents: finalExpectedAmountCents,
                receivedAmountCents: 0,
                netReferralFeePaidCents: 0,
                contractPriceCents,
                commissionBasisPoints,
                commissionFlatFeeCents,
                referralFeeBasisPoints,
                propertyAddress: propertyAddress.trim(),
                propertyCity: propertyCity.trim(),
                propertyState: propertyState.trim().toUpperCase(),
                closingDate: closingDate ? dateStringToLocalISO(closingDate) : null,
                underContractDate: resolvedUnderContractDate,
                usedAfc: side === 'sell' ? false : usedAfc,
                // Agent-entered deals always use the assigned agent.
                usedAssignedAgent: true,
                side,
                terminatedReason: null,
              },
              contractDetails: {
                propertyAddress: propertyAddress.trim(),
                propertyCity: propertyCity.trim(),
                propertyState: propertyState.trim().toUpperCase(),
                propertyPostalCode: propertyPostalCode.trim(),
                contractPrice: contractPriceCents / 100,
                agentCommissionPercentage,
                referralFeePercentage: referralFeePercentageValue,
                dealSide: side,
              },
            });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="text-xs font-medium text-slate-700">Contract price
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
            <input
              className="w-full rounded border border-slate-300 py-1 pl-6 pr-2 text-sm"
              inputMode="decimal"
              value={contractPrice}
              onChange={(e) => setContractPrice(formatCurrencyInput(e.target.value))}
            />
          </div>
        </label>
        <div className="text-xs font-medium text-slate-700">
          <span>Commission</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                commissionMode === '%'
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => setCommissionMode('%')}
            >
              %
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                commissionMode === '$'
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => setCommissionMode('$')}
            >
              $
            </button>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm sm:flex-1"
              value={commissionMode === '%' ? commissionPercentage : commissionFlat}
              onChange={(event) => commissionMode === '%' ? setCommissionPercentage(event.target.value) : setCommissionFlat(event.target.value)}
            />
          </div>
        </div>
        <label className="text-xs font-medium text-slate-700">Referral fee %
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={referralFeePercentage} onChange={(e) => setReferralFeePercentage(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-700">Expected amount
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={expectedAmount} onChange={(e) => { setExpectedManuallyEdited(Boolean(e.target.value)); setExpectedAmount(e.target.value); }} />
        </label>
        <label className="text-xs font-medium text-slate-700">Under contract date
          <input
            type="date"
            className="mt-1 w-full cursor-pointer rounded border border-slate-300 px-2 py-1 text-sm"
            value={underContractDate}
            onClick={handleDateInputClick}
            onChange={(e) => setUnderContractDate(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-slate-700">Closing date
          <input
            type="date"
            className="mt-1 w-full cursor-pointer rounded border border-slate-300 px-2 py-1 text-sm"
            value={closingDate}
            onClick={handleDateInputClick}
            onChange={(e) => setClosingDate(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-slate-700 sm:col-span-2">Property address
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-700">Property city
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={propertyCity} onChange={(e) => setPropertyCity(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-700">Property state
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm uppercase" maxLength={2} value={propertyState} onChange={(e) => setPropertyState(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))} />
        </label>
        <label className="text-xs font-medium text-slate-700">Property ZIP
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={propertyPostalCode} onChange={(e) => setPropertyPostalCode(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-700">Deal side
          <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}>
            <option value="buy">Buy-side</option>
            <option value="sell">Sell-side</option>
          </select>
        </label>
        {side !== 'sell' && (
          <div className="rounded border border-brand/40 bg-brand/5 px-3 py-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={usedAfc}
                onChange={(e) => setUsedAfc(e.target.checked)}
              />
              Used AFC
            </label>
            <p className="mt-1 text-xs text-slate-600">Check this when AFC handled this deal.</p>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <button type="button" className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 sm:w-auto" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="w-full rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 sm:w-auto" disabled={submitting}>{submitting ? 'Saving…' : 'Save deal & move status'}</button>
        </div>
      </form>
    </div>
  );
}

function StatusSelect({
  referralId,
  value,
  dealStatusLabel,
  defaultSide = 'buy',
  side,
  compact = false,
  roleMode,
  onStatusResolved,
}: StatusSelectProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ReferralStatus>(value);
  const [loading, setLoading] = useState(false);
  const [pendingTerminatedSelection, setPendingTerminatedSelection] = useState(false);
  const [terminatedReason, setTerminatedReason] = useState<TerminatedReason | ''>('');

  useEffect(() => {
    setStatus(value);
  }, [value]);

  const applyResolvedStatus = useCallback(
    (nextStatus: ReferralStatus) => {
      setStatus(nextStatus);
      onStatusResolved?.(nextStatus);
    },
    [onStatusResolved]
  );

  const openUnderContractDealModal = () => {
    const toastId = toast.custom((t) => (
      <UnderContractDealToast
        defaultSide={defaultSide}
        onClose={() => toast.dismiss(t)}
        onSubmit={async ({ paymentPayload, contractDetails }) => {
          const paymentResponse = await fetch('/api/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              referralId,
              ...paymentPayload,
            }),
          });
          if (!paymentResponse.ok) {
            throw new Error('Unable to save deal details');
          }
          const statusResponse = await fetch(`/api/referrals/${referralId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'Under Contract',
              source: 'referral_table',
              side: contractDetails.dealSide,
              contractDetails,
              createNewDeal: false,
            }),
          });
          if (!statusResponse.ok) {
            throw new Error('Unable to move referral to Under Contract');
          }
          applyResolvedStatus('Under Contract');
          router.refresh();
          toast.dismiss(t);
          toast.success('Deal saved and referral moved to Under Contract');
        }}
      />
    ), { duration: Infinity, position: 'top-center' });
    void toastId;
  };

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;
    let closingDateIso: string | undefined;

    if (nextStatus === 'Under Contract') {
      openUnderContractDealModal();
      return;
    }
    if (nextStatus === 'Terminated') {
      applyResolvedStatus(nextStatus);
      setPendingTerminatedSelection(true);
      return;
    }

    if (nextStatus === 'Closed' && roleMode === 'agent') {
      const confirmation = await confirmCloseStatusDate({
        initialDateIso: null,
        canSendClosedEmails: false,
        defaultSendClosedEmails: false,
        canSendAgentNpsEmail: false,
        defaultSendAgentNpsEmail: false,
        showEmailPreference: false,
      });
      if (!confirmation.confirmed) {
        applyResolvedStatus(value);
        return;
      }
      closingDateIso = confirmation.closingDateIso;
    }

    applyResolvedStatus(nextStatus);
    setLoading(true);

    try {
      const response = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          source: 'referral_table',
          side,
          terminatedReason: null,
          closingDate: closingDateIso,
          sendClosedEmails: nextStatus === 'Closed' && roleMode === 'agent',
          sendAgentNpsEmail: nextStatus === 'Closed' && roleMode === 'agent',
        })
      });

      const payload = (await response.json().catch(() => null)) as StatusUpdateResponse | null;
      if (!response.ok) {
        if (isReferralStatus(payload?.currentStatus)) {
          applyResolvedStatus(payload.currentStatus);
        } else {
          applyResolvedStatus(value);
        }
        toast.error(extractStatusErrorMessage(payload));
        router.refresh();
        return;
      }

      const dealMappedStatus = mapDealStatusToReferralStatusDisplay(payload?.deal?.status);
      if (dealMappedStatus) {
        applyResolvedStatus(dealMappedStatus);
      } else if (isReferralStatus(payload?.status)) {
        applyResolvedStatus(payload.status);
      } else {
        applyResolvedStatus(nextStatus);
      }
      toast.success('Referral status updated');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error('Unable to update status');
      applyResolvedStatus(value);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <select
        value={status}
        onChange={handleChange}
        disabled={loading}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
      >
        {REFERRAL_STATUSES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      {pendingTerminatedSelection && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
          <label className="block text-xs font-semibold text-slate-600">
            Termination reason
            <select
              value={terminatedReason}
              onChange={(event) => setTerminatedReason(event.target.value as TerminatedReason | '')}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs shadow-sm focus:border-brand focus:outline-none"
              disabled={loading}
            >
              <option value="">Select reason</option>
              {TERMINATED_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
              disabled={loading}
              onClick={async () => {
                if (!terminatedReason) {
                  toast.error('Termination reason is required.');
                  return;
                }
                setLoading(true);
                try {
                  const response = await fetch(`/api/referrals/${referralId}/status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      status: 'Terminated',
                      source: 'referral_table',
                      side,
                      terminatedReason,
                    }),
                  });
                  if (!response.ok) {
                    throw new Error('Failed to update status');
                  }
                  setPendingTerminatedSelection(false);
                  setTerminatedReason('');
                  applyResolvedStatus('Terminated');
                  toast.success('Referral status updated');
                } catch (error) {
                  console.error(error);
                  toast.error('Unable to update status');
                  applyResolvedStatus(value);
                } finally {
                  setLoading(false);
                }
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600"
              disabled={loading}
              onClick={() => {
                setPendingTerminatedSelection(false);
                setTerminatedReason('');
                applyResolvedStatus(value);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {dealStatusLabel && dealStatusLabel !== status && dealStatusLabel !== 'Terminated' && (
        <p className="text-xs text-slate-500">Deal stage: {dealStatusLabel}</p>
      )}
    </div>
  );
}

function SideStatusPill({ label, status }: { label: string; status?: ReferralStatus | null }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xs font-medium text-slate-700">{status ?? '—'}</p>
    </div>
  );
}

function AgentBothStatusCell({ row }: { row: ReferralRow }) {
  const assignedSide = row.viewerAssignedSide ?? 'buy';
  const [buyStatus, setBuyStatus] = useState<ReferralStatus>(row.buyStatus ?? row.status);
  const [sellStatus, setSellStatus] = useState<ReferralStatus>(row.sellStatus ?? row.status);

  useEffect(() => {
    setBuyStatus(row.buyStatus ?? row.status);
    setSellStatus(row.sellStatus ?? row.status);
  }, [row.buyStatus, row.sellStatus, row.status, row._id]);

  const assignedStatus = assignedSide === 'sell' ? sellStatus : buyStatus;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <SideStatusPill label="Buy" status={buyStatus} />
        <SideStatusPill label="Sell" status={sellStatus} />
      </div>
      <div className="rounded border border-brand/20 bg-brand/5 p-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-brand">
          My side: {assignedSide}
        </p>
        <StatusSelect
          referralId={row._id}
          value={assignedStatus}
          defaultSide={assignedSide}
          side={assignedSide}
          compact
          roleMode="agent"
          onStatusResolved={(nextStatus) => {
            if (assignedSide === 'sell') {
              setSellStatus(nextStatus);
              return;
            }
            setBuyStatus(nextStatus);
          }}
        />
      </div>
    </div>
  );
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  'New Lead': 'bg-sky-100 text-sky-700',
  Paired: 'bg-indigo-100 text-indigo-700',
  'In Communication': 'bg-amber-100 text-amber-700',
  'Active Lead': 'bg-violet-100 text-violet-700',
  'Showing Homes': 'bg-violet-100 text-violet-700',
  'Under Contract': 'bg-slate-100 text-slate-700',
  Closed: 'bg-slate-200 text-slate-800',
  Lost: 'bg-slate-200 text-slate-600',
  Terminated: 'bg-rose-100 text-rose-700',
  'Past Inspection': 'bg-amber-100 text-amber-700',
  'Past Appraisal': 'bg-blue-100 text-blue-700',
  'Clear to Close': 'bg-slate-100 text-slate-700',
  'Payment Sent': 'bg-indigo-100 text-indigo-700',
  'Payment Received': 'bg-slate-200 text-slate-800'
};

const STATUS_LABELS: Record<string, string> = {
  'New Lead': 'New Lead',
  Paired: 'Paired',
  'In Communication': 'Communicating',
  'Active Lead': 'Active Lead',
  'Showing Homes': 'Active Lead',
  'Under Contract': 'Under Contract',
  Closed: 'Closed',
  Lost: 'Lost',
  Terminated: 'Terminated',
  'Past Inspection': 'Past Inspection',
  'Past Appraisal': 'Past Appraisal',
  'Clear to Close': 'Clear to Close',
  'Payment Sent': 'Payment Sent',
  'Payment Received': 'Payment Received'
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

function normalizeStatusForSort({
  status,
  dealStatusLabel,
}: Pick<ReferralRow, 'status' | 'dealStatusLabel'>) {
  const label = dealStatusLabel ?? STATUS_LABELS[status] ?? status;
  return label.toLocaleLowerCase();
}

function NoteComposer({
  referralId,
  mcEmail,
  hasAnyPayments = false,
  hasAnyUsedAfcTrue = false
}: {
  referralId: string;
  mcEmail?: string;
  hasAnyPayments?: boolean;
  hasAnyUsedAfcTrue?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const hasMcEmail = Boolean(mcEmail);
  const defaultEmailMc =
    hasMcEmail &&
    shouldDefaultEmailMcForAgentNotes({
      hasAnyPayments,
      hasAnyUsedAfcTrue
    });
  const [emailMc, setEmailMc] = useState(() => defaultEmailMc);

  const reset = () => {
    setNote('');
    setEmailMc(defaultEmailMc);
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!note.trim()) {
      toast.error('Add a note before saving');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'note',
          content: note.trim(),
          emailTargets: emailMc && hasMcEmail ? ['mc'] : undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save note');
      }

      const payload = (await response.json()) as NoteActivityResponse;
      const emailSummary =
        Array.isArray(payload.emailedTargets) && payload.emailedTargets.length > 0
          ? ' Email sent to MC.'
          : '';
      toast.success(`Note saved.${emailSummary}`.trim());

      if (payload.deliveryFailed && emailMc && hasMcEmail) {
        const message = (() => {
          switch (payload.deliveryFailureReason) {
            case 'missing_configuration':
              return 'Note saved, but email delivery is disabled. Set RESEND_API_KEY and EMAIL_FROM environment variables to enable email notifications.';
            case 'no_recipients':
              return 'Note saved, but no MC recipient with a valid email address was available.';
            default:
              return 'Note was saved, but the email could not be delivered.';
          }
        })();
        toast.error(message);
      }
      reset();
    } catch (error) {
      console.error(error);
      toast.error('Unable to save note');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-brand hover:underline"
      >
        Add note
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
        placeholder="Capture quick context for this referral"
        disabled={saving}
      />
      <label className={`flex items-center gap-2 text-xs font-medium ${hasMcEmail ? 'text-slate-600' : 'text-slate-400'}`}>
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand"
          checked={emailMc}
          onChange={(event) => setEmailMc(event.target.checked)}
          disabled={saving || !hasMcEmail}
        />
        Email MC
      </label>
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center rounded bg-brand px-3 py-1 font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="inline-flex items-center rounded border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


function SortButton({ 
  sortKey, 
  label, 
  currentSortBy, 
  currentSortDirection,
  onSortChange 
}: { 
  sortKey: string; 
  label: string;
  currentSortBy: string | null;
  currentSortDirection: 'asc' | 'desc' | null;
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
}) {
  const isActive = currentSortBy === sortKey;
  const direction = isActive ? currentSortDirection : null;
  const icon = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕';

  const handleClick = () => {
    if (isActive && direction === 'desc') {
      onSortChange(sortKey, 'asc');
    } else {
      onSortChange(sortKey, 'desc');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-1 text-left"
    >
      <span>{label}</span>
      <span className="text-[10px] text-slate-400">{icon}</span>
    </button>
  );
}

const sortableHeader = (
  label: string, 
  sortKey: string,
  currentSortBy: string | null,
  currentSortDirection: 'asc' | 'desc' | null,
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void
): ((props: { column: any }) => ReactNode) => () => (
  <SortButton 
    sortKey={sortKey} 
    label={label}
    currentSortBy={currentSortBy}
    currentSortDirection={currentSortDirection}
    onSortChange={onSortChange}
  />
);

function buildColumns(
  mode: TableMode,
  options: { 
    showAgentOriginIndicator?: boolean;
    hideAgentColumn?: boolean;
    currentSortBy?: string | null;
    currentSortDirection?: 'asc' | 'desc' | null;
    onSortChange?: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
    listParams?: string;
  } = {}
): ColumnDef<ReferralRow>[] {
  const { 
    showAgentOriginIndicator = false,
    hideAgentColumn = false,
    currentSortBy = null,
    currentSortDirection = null,
    onSortChange = () => {},
    listParams = '',
  } = options;

  const borrowerColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Borrower', 'borrowerName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'borrowerName',
    cell: ({ row }) => {
      const { _id, borrowerName, borrowerPhone, borrowerEmail, urgentTaskCount } = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            {showAgentOriginIndicator && row.original.origin === 'agent' ? (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full bg-slate-700"
                aria-label="Agent-created referral"
                title="Agent-created referral"
              />
            ) : null}
            <Link href={listParams ? `/referrals/${_id}?${listParams}` : `/referrals/${_id}`} className="font-medium text-brand">
              {borrowerName}
            </Link>
            {mode === 'admin' && (urgentTaskCount ?? 0) > 0 ? (
              <span
                className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                title={`${urgentTaskCount} overdue or due today`}
              >
                {urgentTaskCount}
              </span>
            ) : null}
          </div>
          {borrowerEmail && (
            <a
              href={buildGmailComposeUrl(borrowerEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand hover:underline"
            >
              Email
            </a>
          )}
          {borrowerPhone ? (
            <a
              href={`tel:${borrowerPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-brand hover:underline"
            >
              {formatPhoneNumber(borrowerPhone)}
            </a>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </div>
      );
    }
  };

  const createdColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Created', 'createdAt', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'createdAt',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
  };

  const lastUpdatedColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Last Updated', 'updatedAt', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'updatedAt',
    cell: ({ row }) => {
      const updatedAt = row.original.updatedAt;
      return updatedAt ? new Date(updatedAt).toLocaleDateString() : '—';
    },
  };

  const renderTimelineCountdown = (row: ReferralRow) => {
    const daysRemaining = calculateTimelineDaysRemaining(row.timeline, row.createdAt);
    return formatTimelineCountdown(daysRemaining, row.timeline);
  };

  const timelineColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Timeline', 'timeline', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'timeline',
    cell: ({ row }) => renderTimelineCountdown(row.original),
  };

  if (mode === 'agent') {
    return [
      borrowerColumn,
      {
        header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'loanFileNumber'
      },
      timelineColumn,
      {
        header: sortableHeader('Pre-approval', 'preApprovalAmountCents', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'preApprovalAmountCents',
        cell: ({ row }) =>
          row.original.preApprovalAmountCents
            ? formatCurrency(row.original.preApprovalAmountCents)
            : '—'
      },
      {
        header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'status',
        cell: ({ row }) => {
          if (row.original.clientType === 'Both') {
            return <AgentBothStatusCell row={row.original} />;
          }

          return (
            <StatusSelect
              referralId={row.original._id}
              value={row.original.status}
              dealStatusLabel={row.original.dealStatusLabel ?? null}
              side={row.original.viewerAssignedSide ?? undefined}
              defaultSide={row.original.viewerAssignedSide === 'sell' ? 'sell' : 'buy'}
              roleMode="agent"
            />
          );
        },
      },
      {
        header: 'Notes',
        id: 'notes',
        cell: ({ row }) => (
          <NoteComposer
            referralId={row.original._id}
            mcEmail={row.original.lenderEmail}
            hasAnyPayments={row.original.hasAnyPayments}
            hasAnyUsedAfcTrue={row.original.hasAnyUsedAfcTrue}
          />
        ),
        enableSorting: false,
      },
      createdColumn
    ];
  }

  if (mode === 'mc') {
    return [
      borrowerColumn,
      {
        header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'loanFileNumber'
      },
      timelineColumn,
      {
        header: 'Agent Contact',
        id: 'agentContact',
        cell: ({ row }) => (
          <div className="flex flex-col text-sm">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-700">{row.original.assignedAgentName || 'Unassigned'}</span>
              {row.original.autoUpdateRemindersEnabled && (
                <span title="Auto reminders enabled">
                  <Clock 
                    className="h-3.5 w-3.5 text-slate-400" 
                    aria-label="Auto reminders enabled"
                  />
                </span>
              )}
            </div>
            {row.original.assignedAgentEmail && (
              <a
                href={buildGmailComposeUrl(row.original.assignedAgentEmail)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                Email
              </a>
            )}
            {row.original.assignedAgentPhone && (
              <a
                href={`tel:${row.original.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                className="text-xs text-brand hover:underline"
              >
                {formatPhoneNumber(row.original.assignedAgentPhone)}
              </a>
            )}
          </div>
        )
      },
      {
        header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusBadge status={row.original.dealStatusLabel ?? row.original.status} />
        ),
      },
      createdColumn
    ];
  }

  const agentColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Agent', 'assignedAgentName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'assignedAgentName',
    cell: ({ row }) => {
      const { assignedAgentName, assignedAgentEmail, assignedAgentPhone, autoUpdateRemindersEnabled } = row.original;
      if (!assignedAgentName && !assignedAgentPhone && !assignedAgentEmail) {
        return 'Unassigned';
      }
      return (
        <div className="flex flex-col text-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-700">{assignedAgentName || 'Unassigned'}</span>
            {autoUpdateRemindersEnabled && (
              <span title="Auto reminders enabled">
                <Clock 
                  className="h-3.5 w-3.5 text-slate-400" 
                  aria-label="Auto reminders enabled"
                />
              </span>
            )}
          </div>
          {assignedAgentEmail && (
            <a
              href={buildGmailComposeUrl(assignedAgentEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand hover:underline"
            >
              Email
            </a>
          )}
          {assignedAgentPhone && (
            <a
              href={`tel:${assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-brand hover:underline"
            >
              {formatPhoneNumber(assignedAgentPhone)}
            </a>
          )}
        </div>
      );
    }
  };

  const adminColumns: ColumnDef<ReferralRow>[] = [
    borrowerColumn,
    {
      header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'loanFileNumber'
    },
    timelineColumn,
    {
      header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'status',
      cell: ({ row }) => <StatusBadge status={row.original.dealStatusLabel ?? row.original.status} />,
    },
    ...(hideAgentColumn ? [] : [agentColumn]),
    {
      header: sortableHeader('Lender/MC', 'lenderName', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'lenderName',
      cell: ({ row }) => {
        const { lenderName, lenderEmail, lenderPhone } = row.original;
        if (!lenderName && !lenderPhone && !lenderEmail) {
          return '—';
        }
        return (
          <div className="flex flex-col text-sm">
            <span className="font-medium text-slate-700">{lenderName || 'Unassigned'}</span>
            {lenderEmail && (
              <a
                href={buildGmailComposeUrl(lenderEmail)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                Email
              </a>
            )}
            {lenderPhone && (
              <a
                href={`tel:${lenderPhone.replace(/[^0-9+]/g, '')}`}
                className="text-xs text-brand hover:underline"
              >
                {formatPhoneNumber(lenderPhone)}
              </a>
            )}
          </div>
        );
      }
    },
    createdColumn,
    lastUpdatedColumn
  ];

  return adminColumns;
}

const MD_MIN_WIDTH_QUERY = '(min-width: 768px)';

function referralDetailHref(row: ReferralRow, listParams: string) {
  return listParams ? `/referrals/${row._id}?${listParams}` : `/referrals/${row._id}`;
}

function MobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  );
}

function ReferralMobileStack({
  rows,
  mode,
  listParams,
  showAgentOriginIndicator,
  hideAgentColumn,
}: {
  rows: ReferralRow[];
  mode: TableMode;
  listParams: string;
  showAgentOriginIndicator?: boolean;
  hideAgentColumn?: boolean;
}) {
  const showOrigin = showAgentOriginIndicator ?? false;
  const hideAgent = hideAgentColumn ?? false;

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const timelineText = formatTimelineCountdown(
          calculateTimelineDaysRemaining(row.timeline, row.createdAt),
          row.timeline
        );
        const href = referralDetailHref(row, listParams);

        if (mode === 'agent') {
          return (
            <div
              key={row._id}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              {/* Header zone */}
              <div className={`bg-slate-50 px-4 pt-4 ${row.clientType === 'Both' ? 'pb-3' : 'pb-3'}`}>
                <div className={`flex ${row.clientType === 'Both' ? 'flex-col gap-3' : 'items-start justify-between gap-3'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {showOrigin && row.origin === 'agent' ? (
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-700"
                          aria-label="Agent-created referral"
                          title="Agent-created referral"
                        />
                      ) : null}
                      <Link href={href} className="text-base font-semibold text-slate-900 break-words hover:text-brand">
                        {row.borrowerName}
                      </Link>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      {row.borrowerEmail ? (
                        <a
                          href={buildGmailComposeUrl(row.borrowerEmail)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand hover:underline"
                        >
                          Email
                        </a>
                      ) : null}
                      {row.borrowerPhone ? (
                        <a
                          href={`tel:${row.borrowerPhone.replace(/[^0-9+]/g, '')}`}
                          className="text-xs text-brand hover:underline"
                        >
                          {formatPhoneNumber(row.borrowerPhone)}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className={row.clientType === 'Both' ? '' : 'shrink-0'}>
                    {row.clientType === 'Both' ? (
                      <AgentBothStatusCell row={row} />
                    ) : (
                      <StatusSelect
                        referralId={row._id}
                        value={row.status}
                        dealStatusLabel={row.dealStatusLabel ?? null}
                        side={row.viewerAssignedSide ?? undefined}
                        defaultSide={row.viewerAssignedSide === 'sell' ? 'sell' : 'buy'}
                        roleMode="agent"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Details zone */}
              <div className="px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <MobileField label="Loan file #">{row.loanFileNumber}</MobileField>
                  <MobileField label="Timeline">{timelineText}</MobileField>
                  <MobileField label="Pre-approval">
                    {row.preApprovalAmountCents ? (
                      <span className="font-semibold text-slate-900">{formatCurrency(row.preApprovalAmountCents)}</span>
                    ) : '—'}
                  </MobileField>
                  <MobileField label="Created">{new Date(row.createdAt).toLocaleDateString()}</MobileField>
                </div>

                {/* Notes zone */}
                <div className="border-t border-slate-100 pt-3">
                  <MobileField label="Notes">
                    <NoteComposer
                      referralId={row._id}
                      mcEmail={row.lenderEmail}
                      hasAnyPayments={row.hasAnyPayments}
                      hasAnyUsedAfcTrue={row.hasAnyUsedAfcTrue}
                    />
                  </MobileField>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            key={row._id}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3"
          >
            <MobileField label="Borrower">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {showOrigin && row.origin === 'agent' ? (
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-700"
                      aria-label="Agent-created referral"
                      title="Agent-created referral"
                    />
                  ) : null}
                  <Link href={href} className="font-medium text-brand break-words">
                    {row.borrowerName}
                  </Link>
                  {mode === 'admin' && (row.urgentTaskCount ?? 0) > 0 ? (
                    <span
                      className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                      title={`${row.urgentTaskCount} overdue or due today`}
                    >
                      {row.urgentTaskCount}
                    </span>
                  ) : null}
                </div>
                {row.borrowerEmail ? (
                  <a
                    href={buildGmailComposeUrl(row.borrowerEmail)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand hover:underline w-fit"
                  >
                    Email
                  </a>
                ) : null}
                {row.borrowerPhone ? (
                  <a
                    href={`tel:${row.borrowerPhone.replace(/[^0-9+]/g, '')}`}
                    className="text-xs text-brand hover:underline w-fit"
                  >
                    {formatPhoneNumber(row.borrowerPhone)}
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </div>
            </MobileField>

            <MobileField label="Loan file #">{row.loanFileNumber}</MobileField>
            <MobileField label="Timeline">{timelineText}</MobileField>

            {mode === 'mc' ? (
              <>
                <MobileField label="Agent contact">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-700">
                        {row.assignedAgentName || 'Unassigned'}
                      </span>
                      {row.autoUpdateRemindersEnabled ? (
                        <span title="Auto reminders enabled">
                          <Clock className="h-3.5 w-3.5 text-slate-400" aria-label="Auto reminders enabled" />
                        </span>
                      ) : null}
                    </div>
                    {row.assignedAgentEmail ? (
                      <a
                        href={buildGmailComposeUrl(row.assignedAgentEmail)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand hover:underline w-fit"
                      >
                        Email
                      </a>
                    ) : null}
                    {row.assignedAgentPhone ? (
                      <a
                        href={`tel:${row.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                        className="text-xs text-brand hover:underline w-fit"
                      >
                        {formatPhoneNumber(row.assignedAgentPhone)}
                      </a>
                    ) : null}
                  </div>
                </MobileField>
                <MobileField label="Status">
                  <StatusBadge status={row.dealStatusLabel ?? row.status} />
                </MobileField>
                <MobileField label="Created">{new Date(row.createdAt).toLocaleDateString()}</MobileField>
              </>
            ) : null}

            {mode === 'admin' ? (
              <>
                <MobileField label="Status">
                  <StatusBadge status={row.dealStatusLabel ?? row.status} />
                </MobileField>
                {!hideAgent ? (
                  <MobileField label="Agent">
                    {!row.assignedAgentName && !row.assignedAgentPhone && !row.assignedAgentEmail ? (
                      'Unassigned'
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-700">
                            {row.assignedAgentName || 'Unassigned'}
                          </span>
                          {row.autoUpdateRemindersEnabled ? (
                            <span title="Auto reminders enabled">
                              <Clock className="h-3.5 w-3.5 text-slate-400" aria-label="Auto reminders enabled" />
                            </span>
                          ) : null}
                        </div>
                        {row.assignedAgentEmail ? (
                          <a
                            href={buildGmailComposeUrl(row.assignedAgentEmail)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-brand hover:underline w-fit"
                          >
                            Email
                          </a>
                        ) : null}
                        {row.assignedAgentPhone ? (
                          <a
                            href={`tel:${row.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                            className="text-xs text-brand hover:underline w-fit"
                          >
                            {formatPhoneNumber(row.assignedAgentPhone)}
                          </a>
                        ) : null}
                      </div>
                    )}
                  </MobileField>
                ) : null}
                <MobileField label="Lender / MC">
                  {!row.lenderName && !row.lenderPhone && !row.lenderEmail ? (
                    '—'
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-slate-700">{row.lenderName || 'Unassigned'}</span>
                      {row.lenderEmail ? (
                        <a
                          href={buildGmailComposeUrl(row.lenderEmail)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand hover:underline w-fit"
                        >
                          Email
                        </a>
                      ) : null}
                      {row.lenderPhone ? (
                        <a
                          href={`tel:${row.lenderPhone.replace(/[^0-9+]/g, '')}`}
                          className="text-xs text-brand hover:underline w-fit"
                        >
                          {formatPhoneNumber(row.lenderPhone)}
                        </a>
                      ) : null}
                    </div>
                  )}
                </MobileField>
                <MobileField label="Created">{new Date(row.createdAt).toLocaleDateString()}</MobileField>
                <MobileField label="Last updated">
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}
                </MobileField>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReferralTable({
  data,
  mode,
  showAgentOriginIndicator,
  hideAgentColumn,
  stackOnMobile = false,
}: ReferralTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);

  const currentSortBy = searchParams.get('sortBy');
  const currentSortDirection = (searchParams.get('sortDirection') as 'asc' | 'desc' | null) || null;

  const listParams = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    params.delete('page');
    params.delete('pageSize');
    return params.toString();
  }, [searchParamsString]);

  const handleSortChange = useCallback(
    (sortBy: string, sortDirection: 'asc' | 'desc') => {
      const params = new URLSearchParams(searchParamsString);
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);
      params.delete('page');
      startTransition(() => {
        const queryString = params.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname);
      });
    },
    [router, pathname, searchParamsString, startTransition]
  );

  const columns = useMemo<ColumnDef<ReferralRow>[]>(
    () => buildColumns(mode, { 
      showAgentOriginIndicator,
      hideAgentColumn,
      currentSortBy,
      currentSortDirection,
      onSortChange: handleSortChange,
      listParams,
    }),
    [mode, showAgentOriginIndicator, hideAgentColumn, currentSortBy, currentSortDirection, handleSortChange, listParams]
  );

  // Ensure data is always an array - handle all edge cases
  // This is critical because useReactTable requires an iterable array
  const safeData = useMemo(() => {
    try {
      if (!data) return [];
      if (Array.isArray(data)) {
        // Double-check each item is valid
        return data.filter((item): item is ReferralRow => item != null && typeof item === 'object');
      }
      return [];
    } catch (error) {
      console.error('Error processing referral data:', error);
      return [];
    }
  }, [data]);

  const table = useReactTable({
    data: safeData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const [isDesktop, setIsDesktop] = useState(false);

  useLayoutEffect(() => {
    if (!stackOnMobile || typeof window === 'undefined') {
      return;
    }
    const mq = window.matchMedia(MD_MIN_WIDTH_QUERY);
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [stackOnMobile]);

  if (stackOnMobile && !isDesktop) {
    return (
      <ReferralMobileStack
        rows={safeData}
        mode={mode}
        listParams={listParams}
        showAgentOriginIndicator={showAgentOriginIndicator}
        hideAgentColumn={hideAgentColumn}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                    header.column.id === 'actions' ? 'text-right' : 'text-left'
                  }`}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`px-4 py-3 text-sm text-slate-700 ${
                    cell.column.id === 'actions' ? 'text-right' : ''
                  }`}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ReferralSummaryMetrics {
  total: number;
  closedDeals: number;
  closeRate: number;
  activeReferrals: number;
}

type ReferralSummaryMode = 'mc' | 'agent';

export function ReferralSummary({
  summary,
  mode
}: {
  summary: ReferralSummaryMetrics;
  mode: ReferralSummaryMode;
}) {
  const { total, closedDeals, closeRate, activeReferrals } = summary;

  const metrics =
    mode === 'agent'
      ? [
          {
            label: 'Total Referrals',
            value: formatNumber(total)
          },
          {
            label: 'Active Referrals',
            value: formatNumber(activeReferrals)
          },
          {
            label: 'Closed Referrals',
            value: formatNumber(closedDeals)
          },
          {
            label: 'Close Rate',
            value: `${closeRate.toFixed(1)}%`
          }
        ]
      : [
          {
            label: 'Total Referrals',
            value: formatNumber(total)
          },
          {
            label: 'Closed Deals',
            value: formatNumber(closedDeals)
          },
          {
            label: 'Close Rate',
            value: `${closeRate.toFixed(1)}%`
          }
        ];

  const columnClass = mode === 'agent' ? 'md:grid-cols-4' : 'md:grid-cols-3';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <dl className={clsx('grid gap-4', columnClass)}>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
