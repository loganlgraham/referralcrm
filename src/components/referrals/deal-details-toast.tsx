'use client';

import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { inputFieldClasses } from '@/components/ui/input';
import { selectFieldClasses, SegmentedToggle } from '@/components/ui/field-group';
import {
  openPromptToast,
  PromptToastCard,
  PromptToastField,
  PromptToastFieldset,
  promptToastRadioClasses,
  promptToastRadioLabelClasses
} from '@/components/referrals/prompt-toast-shell';
import type { ReferralPayment } from '@/types/referral-payment';

/** The deal fields both modes collect, shaped for `paymentSchema` in the payments API. */
export type DealDetailsPayload = {
  expectedAmountCents: number;
  contractPriceCents: number;
  commissionBasisPoints: number | null;
  commissionFlatFeeCents: number | null;
  referralFeeBasisPoints: number | null;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  closingDate: string | null;
  underContractDate: string | null;
  usedAfc: boolean;
  side: 'buy' | 'sell';
};

export interface UnderContractDealResult {
  paymentPayload: Record<string, unknown>;
  dealFields: DealDetailsPayload;
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
}

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

const centsToInput = (value?: number | null): string => {
  if (value == null) {
    return '';
  }
  return formatCurrencyInput((value / 100).toFixed(2));
};

const basisPointsToInput = (value?: number | null): string => {
  if (value == null) {
    return '';
  }
  return String(value / 100);
};

const isoToDateInput = (value?: string | null): string => {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
};

const COMMISSION_MODES = [
  { value: '%' as const, label: '%' },
  { value: '$' as const, label: '$' }
];

interface DealDetailsFormProps {
  /** `create` collects a brand new deal and also moves the referral; `edit` only patches deal fields. */
  mode: 'create' | 'edit';
  defaultSide: 'buy' | 'sell';
  /** Agent-created (agent→AFC) referrals collect no referral fee. */
  isAgentOrigin: boolean;
  initialDeal?: ReferralPayment;
  onCancel: () => void;
  onSubmit: (result: UnderContractDealResult) => Promise<void>;
}

function DealDetailsForm({
  mode,
  defaultSide,
  isAgentOrigin,
  initialDeal,
  onCancel,
  onSubmit
}: DealDetailsFormProps) {
  const isEdit = mode === 'edit';
  const [expectedAmount, setExpectedAmount] = useState(() => centsToInput(initialDeal?.expectedAmountCents));
  // A saved expected amount is authoritative, so editing must not silently recompute it.
  const [expectedManuallyEdited, setExpectedManuallyEdited] = useState(
    () => initialDeal?.expectedAmountCents != null
  );
  const [contractPrice, setContractPrice] = useState(() => centsToInput(initialDeal?.contractPriceCents));
  const [commissionMode, setCommissionMode] = useState<'%' | '$'>(
    initialDeal?.commissionFlatFeeCents != null ? '$' : '%'
  );
  const [commissionPercentage, setCommissionPercentage] = useState(() =>
    basisPointsToInput(initialDeal?.commissionBasisPoints)
  );
  const [commissionFlat, setCommissionFlat] = useState(() => centsToInput(initialDeal?.commissionFlatFeeCents));
  const [referralFeePercentage, setReferralFeePercentage] = useState(() =>
    basisPointsToInput(initialDeal?.referralFeeBasisPoints)
  );
  const [propertyAddress, setPropertyAddress] = useState(initialDeal?.propertyAddress ?? '');
  const [propertyCity, setPropertyCity] = useState(initialDeal?.propertyCity ?? '');
  const [propertyState, setPropertyState] = useState(initialDeal?.propertyState ?? '');
  const [propertyPostalCode, setPropertyPostalCode] = useState('');
  const [closingDate, setClosingDate] = useState(() => isoToDateInput(initialDeal?.closingDate));
  const [underContractDate, setUnderContractDate] = useState(() =>
    isoToDateInput(initialDeal?.underContractDate)
  );
  const [side, setSide] = useState<'buy' | 'sell'>(initialDeal?.side ?? defaultSide);
  const [usedAfc, setUsedAfc] = useState(initialDeal ? Boolean(initialDeal.usedAfc) : true);
  const [submitting, setSubmitting] = useState(false);

  const handleDateInputClick = useCallback((event: MouseEvent<HTMLInputElement>) => {
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
  }, [
    commissionFlat,
    commissionMode,
    commissionPercentage,
    contractPrice,
    expectedManuallyEdited,
    referralFeePercentage
  ]);

  useEffect(() => {
    if (side === 'sell' && usedAfc) {
      setUsedAfc(false);
    }
  }, [side, usedAfc]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!propertyAddress.trim() || !propertyCity.trim()) {
      toast.error('Property address and city are required.');
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(propertyState.trim())) {
      toast.error('Property state must be a 2-letter code.');
      return;
    }
    // ZIP lives on the referral, not the deal, so it is only collected when creating.
    if (!isEdit && !/^\d{5}(?:-\d{4})?$/.test(propertyPostalCode.trim())) {
      toast.error('Enter a valid property ZIP code.');
      return;
    }
    if (!contractPrice || parseNumericInput(contractPrice) <= 0) {
      toast.error('Contract price is required.');
      return;
    }
    if (isAgentOrigin) {
      if (!commissionPercentage.trim()) {
        toast.error('Commission % is required.');
        return;
      }
      const commissionParsed = parseNumericInput(commissionPercentage);
      if (!Number.isFinite(commissionParsed) || commissionParsed < 0) {
        toast.error('Enter a valid commission % (0 or greater).');
        return;
      }
    }
    if (!isAgentOrigin) {
      if (!referralFeePercentage.trim()) {
        toast.error('Referral fee % is required.');
        return;
      }
      const referralFeeParsed = parseNumericInput(referralFeePercentage);
      if (!Number.isFinite(referralFeeParsed) || referralFeeParsed < 0) {
        toast.error('Enter a valid referral fee % (0 or greater).');
        return;
      }
    }

    const contractPriceCents = toCents(contractPrice);
    const isFlatFeeMode = commissionMode === '$';
    const commissionBasisPoints = isAgentOrigin
      ? Math.round(parseNumericInput(commissionPercentage) * 100)
      : isFlatFeeMode
        ? null
        : commissionPercentage
          ? Math.round(parseNumericInput(commissionPercentage) * 100)
          : null;
    const commissionFlatFeeCents = isAgentOrigin
      ? null
      : isFlatFeeMode
        ? (commissionFlat ? toCents(commissionFlat) : null)
        : null;
    const referralFeeBasisPoints = isAgentOrigin
      ? null
      : Math.round(parseNumericInput(referralFeePercentage) * 100);
    const expectedAmountCents = isAgentOrigin ? 0 : toCents(expectedAmount);
    const finalExpectedAmountCents = isAgentOrigin
      ? 0
      : !expectedAmountCents && referralFeeBasisPoints
        ? isFlatFeeMode
          ? Math.round(((commissionFlatFeeCents ?? 0) * referralFeeBasisPoints) / 10_000)
          : Math.round(
              (contractPriceCents * (commissionBasisPoints ?? 0) * referralFeeBasisPoints) /
                100_000_000
            )
        : expectedAmountCents;

    const agentCommissionPercentage = isAgentOrigin
      ? parseNumericInput(commissionPercentage)
      : isFlatFeeMode
        ? commissionFlatFeeCents != null && contractPriceCents > 0
          ? (commissionFlatFeeCents / contractPriceCents) * 100
          : 0
        : (commissionBasisPoints ?? 0) / 100;
    const referralFeePercentageValue = isAgentOrigin ? 0 : (referralFeeBasisPoints ?? 0) / 100;
    const resolvedUnderContractDate = underContractDate
      ? dateStringToLocalISO(underContractDate)
      : isEdit
        ? null
        : new Date().toISOString();

    const dealFields: DealDetailsPayload = {
      expectedAmountCents: finalExpectedAmountCents,
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
      side
    };

    setSubmitting(true);
    try {
      // Failures keep the toast open so the entered deal is not lost.
      await onSubmit({
        // Editing leaves the stage alone — that moves through the deal stage pills.
        paymentPayload: isEdit
          ? dealFields
          : {
              ...dealFields,
              status: 'under_contract',
              receivedAmountCents: 0,
              netReferralFeePaidCents: 0,
              // Agent-entered deals always use the assigned agent.
              usedAssignedAgent: true,
              terminatedReason: null
            },
        dealFields,
        contractDetails: {
          propertyAddress: propertyAddress.trim(),
          propertyCity: propertyCity.trim(),
          propertyState: propertyState.trim().toUpperCase(),
          propertyPostalCode: propertyPostalCode.trim(),
          contractPrice: contractPriceCents / 100,
          agentCommissionPercentage,
          referralFeePercentage: referralFeePercentageValue,
          dealSide: side
        }
      });
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save deal details');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PromptToastCard
      title={isEdit ? 'Edit deal details' : 'Add deal details'}
      description={
        isEdit
          ? 'Update the contract info for this deal. Use the stage pills to move it forward.'
          : 'Enter the full deal info before moving this referral to Under Contract.'
      }
      width="wide"
      submitLabel={
        submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save deal & move status'
      }
      submitting={submitting}
      onCancel={onCancel}
      onSubmit={() => void handleSubmit()}
      bodyClassName="grid grid-cols-1 gap-3 space-y-0 sm:grid-cols-2"
    >
      <PromptToastField label="Contract price">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-subtle">
            $
          </span>
          <input
            className={cn(inputFieldClasses, 'text-numeric pl-6')}
            inputMode="decimal"
            value={contractPrice}
            onChange={(event) => setContractPrice(formatCurrencyInput(event.target.value))}
          />
        </div>
      </PromptToastField>

      {!isAgentOrigin ? (
        <>
          <PromptToastField label="Commission">
            <div className="flex items-center gap-2">
              <SegmentedToggle
                ariaLabel="Commission mode"
                value={commissionMode}
                onChange={setCommissionMode}
                options={COMMISSION_MODES}
              />
              <input
                className={cn(inputFieldClasses, 'text-numeric flex-1')}
                value={commissionMode === '%' ? commissionPercentage : commissionFlat}
                onChange={(event) =>
                  commissionMode === '%'
                    ? setCommissionPercentage(event.target.value)
                    : setCommissionFlat(event.target.value)
                }
              />
            </div>
          </PromptToastField>
          <PromptToastField label="Referral fee %">
            <input
              className={cn(inputFieldClasses, 'text-numeric')}
              value={referralFeePercentage}
              onChange={(event) => setReferralFeePercentage(event.target.value)}
            />
          </PromptToastField>
          <PromptToastField label="Expected amount">
            <input
              className={cn(inputFieldClasses, 'text-numeric')}
              value={expectedAmount}
              onChange={(event) => {
                setExpectedManuallyEdited(Boolean(event.target.value));
                setExpectedAmount(event.target.value);
              }}
            />
          </PromptToastField>
        </>
      ) : null}

      <PromptToastField label="Under contract date">
        <input
          type="date"
          className={cn(inputFieldClasses, 'text-numeric cursor-pointer')}
          value={underContractDate}
          onClick={handleDateInputClick}
          onChange={(event) => setUnderContractDate(event.target.value)}
        />
      </PromptToastField>
      <PromptToastField label="Closing date">
        <input
          type="date"
          className={cn(inputFieldClasses, 'text-numeric cursor-pointer')}
          value={closingDate}
          onClick={handleDateInputClick}
          onChange={(event) => setClosingDate(event.target.value)}
        />
      </PromptToastField>
      {isAgentOrigin ? (
        <PromptToastField label="Commission %">
          <input
            className={cn(inputFieldClasses, 'text-numeric')}
            inputMode="decimal"
            value={commissionPercentage}
            onChange={(event) => setCommissionPercentage(event.target.value)}
          />
        </PromptToastField>
      ) : null}
      <PromptToastField label="Property address" className="sm:col-span-2">
        <input
          className={inputFieldClasses}
          value={propertyAddress}
          onChange={(event) => setPropertyAddress(event.target.value)}
        />
      </PromptToastField>
      <PromptToastField label="Property city">
        <input
          className={inputFieldClasses}
          value={propertyCity}
          onChange={(event) => setPropertyCity(event.target.value)}
        />
      </PromptToastField>
      <PromptToastField label="Property state">
        <input
          className={cn(inputFieldClasses, 'uppercase')}
          maxLength={2}
          value={propertyState}
          onChange={(event) =>
            setPropertyState(
              event.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
            )
          }
        />
      </PromptToastField>
      {isEdit ? null : (
        <PromptToastField label="Property ZIP">
          <input
            className={cn(inputFieldClasses, 'text-numeric')}
            value={propertyPostalCode}
            onChange={(event) => setPropertyPostalCode(event.target.value)}
          />
        </PromptToastField>
      )}
      <PromptToastField label="Deal side">
        <select
          className={selectFieldClasses}
          value={side}
          onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}
        >
          <option value="buy">Buy-side</option>
          <option value="sell">Sell-side</option>
        </select>
      </PromptToastField>

      {side !== 'sell' ? (
        <PromptToastFieldset legend="Is this client financing with AFC?" className="sm:col-span-2">
          <label className={promptToastRadioLabelClasses}>
            <input
              type="radio"
              name="underContractUsedAfc"
              className={promptToastRadioClasses}
              checked={usedAfc}
              onChange={() => setUsedAfc(true)}
            />
            Yes — financing with AFC
          </label>
          <label className={promptToastRadioLabelClasses}>
            <input
              type="radio"
              name="underContractUsedAfc"
              className={promptToastRadioClasses}
              checked={!usedAfc}
              onChange={() => setUsedAfc(false)}
            />
            No — financing with another lender
          </label>
        </PromptToastFieldset>
      ) : null}
    </PromptToastCard>
  );
}

/**
 * Under Contract needs a full deal before the status can move, so the toast owns
 * the save: it stays open with a spinner while `onSubmit` runs and only closes
 * once the deal is persisted.
 */
export function collectUnderContractDeal(options: {
  defaultSide?: 'buy' | 'sell';
  isAgentOrigin?: boolean;
  onSubmit: (result: UnderContractDealResult) => Promise<void>;
}): Promise<boolean> {
  return openPromptToast<boolean>(
    (finalize) => (
      <DealDetailsForm
        mode="create"
        defaultSide={options.defaultSide ?? 'buy'}
        isAgentOrigin={options.isAgentOrigin ?? false}
        onCancel={() => finalize(false)}
        onSubmit={async (result) => {
          await options.onSubmit(result);
          finalize(true);
        }}
      />
    ),
    false
  );
}

/**
 * Same form as the Under Contract prompt, prefilled from an existing deal. The
 * payload only carries deal fields — stage changes go through the deal pills.
 */
export function editDealDetails(options: {
  deal: ReferralPayment;
  isAgentOrigin?: boolean;
  onSubmit: (payload: DealDetailsPayload) => Promise<void>;
}): Promise<boolean> {
  return openPromptToast<boolean>(
    (finalize) => (
      <DealDetailsForm
        mode="edit"
        defaultSide={options.deal.side ?? 'buy'}
        isAgentOrigin={options.isAgentOrigin ?? false}
        initialDeal={options.deal}
        onCancel={() => finalize(false)}
        onSubmit={async (result) => {
          await options.onSubmit(result.dealFields);
          finalize(true);
        }}
      />
    ),
    false
  );
}

/** Creates the deal, then moves the referral, mirroring the admin table sequence. */
export async function submitUnderContractDeal(
  referralId: string,
  { paymentPayload, contractDetails }: UnderContractDealResult,
  source: 'referral_table' | 'referral_detail' = 'referral_table'
): Promise<void> {
  const paymentResponse = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referralId, ...paymentPayload })
  });
  if (!paymentResponse.ok) {
    throw new Error('Unable to save deal details');
  }

  const statusResponse = await fetch(`/api/referrals/${referralId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'Under Contract',
      source,
      side: contractDetails.dealSide,
      contractDetails,
      createNewDeal: false,
      usedAfc: contractDetails.dealSide === 'sell' ? false : Boolean(paymentPayload.usedAfc)
    })
  });
  if (!statusResponse.ok) {
    throw new Error('Unable to move referral to Under Contract');
  }
}
