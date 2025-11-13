'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ReferralStatus } from '@/models/referral';

interface ContractDetails {
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyPostalCode?: string;
  contractPriceCents?: number;
  agentCommissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  dealSide?: 'buy' | 'sell';
}

interface ContractFormState {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyPostalCode: string;
  contractPrice: string;
  agentCommissionPercentage: string;
  referralFeePercentage: string;
  dealSide: 'buy' | 'sell';
}

interface CreatedDealPayload {
  _id: string;
  status?: string | null;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  terminatedReason?: string | null;
  agentAttribution?: string | null;
  usedAfc?: boolean;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  paidDate?: string | null;
}

interface DealPreparationFormProps {
  referralId: string;
  previousStatus: ReferralStatus;
  visible: boolean;
  contractDetails?: ContractDetails;
  onContractSaved?: (details: {
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyPostalCode: string;
    contractPriceCents: number;
    agentCommissionBasisPoints: number;
    referralFeeBasisPoints: number;
    referralFeeDueCents: number;
    dealSide: 'buy' | 'sell';
  }) => void;
  onStatusChanged?: (status: ReferralStatus, payload?: Record<string, unknown>) => void;
  onContractDraftChange?: (details: {
    propertyAddress?: string;
    propertyCity?: string;
    propertyState?: string;
    propertyPostalCode?: string;
    contractPriceCents?: number;
    agentCommissionBasisPoints?: number;
    referralFeeBasisPoints?: number;
    referralFeeDueCents?: number;
    dealSide?: 'buy' | 'sell';
    hasUnsavedChanges: boolean;
  }) => void;
  onDealCreated?: (deal: CreatedDealPayload) => void;
}

const buildInitialFormState = (details?: ContractDetails): ContractFormState => ({
  propertyAddress: details?.propertyAddress ?? '',
  propertyCity: details?.propertyCity ?? '',
  propertyState: details?.propertyState ? details.propertyState.toUpperCase() : '',
  propertyPostalCode: details?.propertyPostalCode ?? '',
  contractPrice: details?.contractPriceCents ? (details.contractPriceCents / 100).toString() : '',
  agentCommissionPercentage: details?.agentCommissionBasisPoints
    ? (details.agentCommissionBasisPoints / 100).toString()
    : '3',
  referralFeePercentage: details?.referralFeeBasisPoints
    ? (details.referralFeeBasisPoints / 100).toString()
    : '25',
  dealSide: details?.dealSide ?? 'buy',
});

const formatFullAddress = (
  street?: string,
  city?: string,
  state?: string,
  postal?: string
) => {
  const trimmedStreet = street?.trim();
  const trimmedCity = city?.trim();
  const trimmedState = state?.trim();
  const trimmedPostal = postal?.trim();

  const localityParts: string[] = [];
  if (trimmedCity) {
    localityParts.push(trimmedCity);
  }
  const statePostal = [trimmedState, trimmedPostal].filter((part) => part && part.length > 0).join(' ');
  if (statePostal) {
    localityParts.push(statePostal);
  }

  return [trimmedStreet, localityParts.join(', ')].filter((part) => part && part.length > 0).join(', ');
};

const calculateReferralFeeAmount = (
  priceInput: string,
  commissionInput: string,
  referralFeeInput: string
) => {
  const price = priceInput ? Number(priceInput) : Number.NaN;
  const commission = Number(commissionInput);
  const referralFee = Number(referralFeeInput);

  if ([price, commission, referralFee].some((value) => Number.isNaN(value) || value <= 0)) {
    return null;
  }

  const amount = price * (commission / 100) * (referralFee / 100);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount;
};

const formatContractPriceDisplay = (value: string) => {
  if (!value) {
    return '';
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return '';
  }
  return numeric.toLocaleString('en-US');
};

export function DealPreparationForm({
  referralId,
  previousStatus,
  visible,
  contractDetails,
  onContractSaved,
  onStatusChanged,
  onContractDraftChange,
  onDealCreated,
}: DealPreparationFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<ContractFormState>(() => buildInitialFormState(contractDetails));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible && onContractDraftChange) {
      onContractDraftChange({ hasUnsavedChanges: false });
    }
  }, [visible, onContractDraftChange]);

  useEffect(() => {
    if (!visible || dirty) {
      return;
    }

    const nextState = buildInitialFormState(contractDetails);
    setForm((previous) => {
      const hasChanged =
        previous.propertyAddress !== nextState.propertyAddress ||
        previous.propertyCity !== nextState.propertyCity ||
        previous.propertyState !== nextState.propertyState ||
        previous.propertyPostalCode !== nextState.propertyPostalCode ||
        previous.contractPrice !== nextState.contractPrice ||
        previous.agentCommissionPercentage !== nextState.agentCommissionPercentage ||
        previous.referralFeePercentage !== nextState.referralFeePercentage;

      if (!hasChanged) {
        return previous;
      }

      return nextState;
    });
  }, [contractDetails, dirty, visible]);

  const broadcastDraft = useCallback(
    (state: ContractFormState, hasUnsavedChanges: boolean) => {
      if (!onContractDraftChange) {
        return;
      }

      const price = state.contractPrice ? Number(state.contractPrice) : Number.NaN;
      const commission = Number(state.agentCommissionPercentage);
      const referralFee = Number(state.referralFeePercentage);
      const referralFeeAmount = calculateReferralFeeAmount(
        state.contractPrice,
        state.agentCommissionPercentage,
        state.referralFeePercentage
      );

      const trimmedCity = state.propertyCity.trim();
      const trimmedState = state.propertyState.trim().toUpperCase();
      const trimmedPostal = state.propertyPostalCode.trim();
      const displayAddress = formatFullAddress(
        state.propertyAddress,
        trimmedCity,
        trimmedState,
        trimmedPostal
      );

      onContractDraftChange({
        propertyAddress: displayAddress || undefined,
        propertyCity: trimmedCity || undefined,
        propertyState: trimmedState || undefined,
        propertyPostalCode: trimmedPostal || undefined,
        contractPriceCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : undefined,
        agentCommissionBasisPoints:
          Number.isFinite(commission) && commission > 0 ? Math.round(commission * 100) : undefined,
        referralFeeBasisPoints:
          Number.isFinite(referralFee) && referralFee > 0 ? Math.round(referralFee * 100) : undefined,
        referralFeeDueCents:
          referralFeeAmount && referralFeeAmount > 0 ? Math.round(referralFeeAmount * 100) : undefined,
        dealSide: state.dealSide,
        hasUnsavedChanges,
      });
    },
    [onContractDraftChange]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    broadcastDraft(form, dirty);
  }, [broadcastDraft, dirty, form, visible]);

  const contractFieldsValid = useMemo(() => {
    if (!visible) {
      return false;
    }

    const referralFeeAmount = calculateReferralFeeAmount(
      form.contractPrice,
      form.agentCommissionPercentage,
      form.referralFeePercentage
    );

    const hasCity = form.propertyCity.trim().length > 0;
    const stateValid = /^[A-Za-z]{2}$/.test(form.propertyState.trim());
    const postalValid = /^\d{5}(?:-\d{4})?$/.test(form.propertyPostalCode.trim());

    return (
      form.propertyAddress.trim().length > 0 &&
      hasCity &&
      stateValid &&
      postalValid &&
      form.contractPrice.trim().length > 0 &&
      form.agentCommissionPercentage.trim().length > 0 &&
      form.referralFeePercentage.trim().length > 0 &&
      referralFeeAmount !== null
    );
  }, [form, visible]);

  const referralFeeAmountDisplay = useMemo(() => {
    const amount = calculateReferralFeeAmount(
      form.contractPrice,
      form.agentCommissionPercentage,
      form.referralFeePercentage
    );

    if (amount === null) {
      return '';
    }

    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [form.contractPrice, form.agentCommissionPercentage, form.referralFeePercentage]);

  const handleFieldChange = (field: keyof ContractFormState) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setForm((previous) => {
      let nextValue = value;
      if (field === 'contractPrice') {
        const digitsOnly = value.replace(/[^0-9]/g, '');
        nextValue = digitsOnly;
      } else if (field === 'propertyState') {
        nextValue = value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
      } else if (field === 'propertyPostalCode') {
        const sanitized = value.replace(/[^0-9-]/g, '');
        nextValue = sanitized.slice(0, 10);
      } else if (field === 'dealSide') {
        nextValue = value === 'sell' ? 'sell' : 'buy';
      }
      const next = { ...previous, [field]: nextValue as ContractFormState[typeof field] };
      broadcastDraft(next, true);
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!contractFieldsValid) {
      toast.error('Fill in all contract details before saving.');
      return;
    }

    const contractPrice = form.contractPrice ? Number(form.contractPrice) : Number.NaN;
    const agentCommission = Number(form.agentCommissionPercentage);
    const referralFeePercentage = Number(form.referralFeePercentage);
    const referralFeeAmount = calculateReferralFeeAmount(
      form.contractPrice,
      form.agentCommissionPercentage,
      form.referralFeePercentage
    );

    if (
      [contractPrice, agentCommission, referralFeePercentage].some((value) => Number.isNaN(value)) ||
      referralFeeAmount === null
    ) {
      toast.error('Contract amounts must be valid numbers.');
      return;
    }

    setSaving(true);
    try {
      const propertyStreet = form.propertyAddress.trim();
      const propertyCity = form.propertyCity.trim();
      const propertyState = form.propertyState.trim().toUpperCase();
      const propertyPostalCode = form.propertyPostalCode.trim();

      const response = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Under Contract',
          contractDetails: {
            propertyAddress: propertyStreet,
            propertyCity,
            propertyState,
            propertyPostalCode,
            contractPrice,
            agentCommissionPercentage: agentCommission,
            referralFeePercentage,
            dealSide: form.dealSide,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response
          .json()
          .catch(() => undefined) as { error?: Record<string, unknown> } | undefined;
        const hasContractError = Boolean(errorBody?.error && 'contractDetails' in (errorBody.error ?? {}));
        const message = hasContractError
          ? 'Add contract details before marking this referral Under Contract.'
          : 'Failed to update contract details';
        throw new Error(message);
      }

      const body = (await response.json()) as Record<string, unknown>;
      const details = body.contractDetails as {
        propertyAddress?: string;
        propertyCity?: string;
        propertyState?: string;
        propertyPostalCode?: string;
        contractPriceCents?: number;
        agentCommissionBasisPoints?: number;
        referralFeeBasisPoints?: number;
        referralFeeDueCents?: number;
        dealSide?: 'buy' | 'sell';
      } | undefined;
      const createdDeal = body.deal as Record<string, unknown> | undefined;

      if (details) {
        const nextState = buildInitialFormState({
          propertyAddress: details.propertyAddress,
          propertyCity: details.propertyCity,
          propertyState: details.propertyState,
          propertyPostalCode: details.propertyPostalCode,
          contractPriceCents: details.contractPriceCents,
          agentCommissionBasisPoints: details.agentCommissionBasisPoints,
          referralFeeBasisPoints: details.referralFeeBasisPoints,
          dealSide: details.dealSide,
        });
        setForm(nextState);
        setDirty(false);
        broadcastDraft(nextState, false);
        onContractSaved?.({
          propertyAddress: details.propertyAddress ?? '',
          propertyCity: details.propertyCity ?? '',
          propertyState: details.propertyState ?? '',
          propertyPostalCode: details.propertyPostalCode ?? '',
          contractPriceCents: details.contractPriceCents ?? 0,
          agentCommissionBasisPoints: details.agentCommissionBasisPoints ?? 0,
          referralFeeBasisPoints: details.referralFeeBasisPoints ?? 0,
          referralFeeDueCents: details.referralFeeDueCents ?? 0,
          dealSide: details.dealSide ?? 'buy',
        });
      } else {
        setDirty(false);
        broadcastDraft(form, false);
      }

      if (createdDeal && typeof createdDeal === 'object' && createdDeal !== null) {
        const payload: CreatedDealPayload = {
          _id: String(createdDeal._id ?? ''),
          status:
            typeof createdDeal.status === 'string'
              ? createdDeal.status
              : 'under_contract',
          expectedAmountCents:
            typeof createdDeal.expectedAmountCents === 'number'
              ? createdDeal.expectedAmountCents
              : 0,
          receivedAmountCents:
            typeof createdDeal.receivedAmountCents === 'number'
              ? createdDeal.receivedAmountCents
              : 0,
          terminatedReason:
            typeof createdDeal.terminatedReason === 'string'
              ? createdDeal.terminatedReason
              : null,
          agentAttribution:
            typeof createdDeal.agentAttribution === 'string'
              ? createdDeal.agentAttribution
              : null,
          usedAfc: Boolean(createdDeal.usedAfc),
          commissionBasisPoints:
            typeof createdDeal.commissionBasisPoints === 'number'
              ? createdDeal.commissionBasisPoints
              : null,
          referralFeeBasisPoints:
            typeof createdDeal.referralFeeBasisPoints === 'number'
              ? createdDeal.referralFeeBasisPoints
              : null,
          side:
            createdDeal.side === 'sell'
              ? 'sell'
              : createdDeal.side === 'buy'
                ? 'buy'
                : null,
          createdAt:
            typeof createdDeal.createdAt === 'string'
              ? createdDeal.createdAt
              : createdDeal.createdAt instanceof Date
                ? createdDeal.createdAt.toISOString()
                : null,
          updatedAt:
            typeof createdDeal.updatedAt === 'string'
              ? createdDeal.updatedAt
              : createdDeal.updatedAt instanceof Date
                ? createdDeal.updatedAt.toISOString()
                : null,
          paidDate:
            typeof createdDeal.paidDate === 'string'
              ? createdDeal.paidDate
              : createdDeal.paidDate instanceof Date
                ? createdDeal.paidDate.toISOString()
                : null,
        };

        onDealCreated?.(payload);
      }

      onStatusChanged?.('Under Contract', { ...body, previousStatus });
      router.refresh();
      toast.success('Contract details saved');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update contract details');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase text-slate-400">Deal preparation</p>
      <div className="space-y-2 text-sm">
        <label className="block">
          <span className="text-slate-500">Property Address</span>
          <input
            type="text"
            value={form.propertyAddress}
            onChange={handleFieldChange('propertyAddress')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            placeholder="123 Main St"
            disabled={saving}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr),repeat(2,minmax(0,1fr))]">
          <label className="block">
            <span className="text-slate-500">City</span>
            <input
              type="text"
              value={form.propertyCity}
              onChange={handleFieldChange('propertyCity')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="Austin"
              disabled={saving}
            />
          </label>
          <label className="block">
            <span className="text-slate-500">State</span>
            <input
              type="text"
              value={form.propertyState}
              onChange={handleFieldChange('propertyState')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 uppercase"
              placeholder="TX"
              maxLength={2}
              disabled={saving}
            />
          </label>
          <label className="block">
            <span className="text-slate-500">ZIP</span>
            <input
              type="text"
              value={form.propertyPostalCode}
              onChange={handleFieldChange('propertyPostalCode')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="73301"
              inputMode="numeric"
              disabled={saving}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-slate-500">Contract Price ($)</span>
          <input
            type="text"
            inputMode="numeric"
            value={formatContractPriceDisplay(form.contractPrice)}
            onChange={handleFieldChange('contractPrice')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            placeholder="300,000"
            disabled={saving}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-slate-500">Agent Commission %</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.agentCommissionPercentage}
              onChange={handleFieldChange('agentCommissionPercentage')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="3"
              disabled={saving}
            />
          </label>
          <label className="block">
            <span className="text-slate-500">Referral Fee %</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.referralFeePercentage}
              onChange={handleFieldChange('referralFeePercentage')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="25"
              disabled={saving}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-slate-500">Deal Side</span>
          <select
            value={form.dealSide}
            onChange={handleFieldChange('dealSide')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            disabled={saving}
          >
            <option value="buy">Buy-side</option>
            <option value="sell">Sell-side</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-500">Referral Fee Amount</span>
          <input
            type="text"
            value={referralFeeAmountDisplay}
            readOnly
            className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
            placeholder="Calculated automatically"
            disabled
          />
        </label>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !contractFieldsValid || !dirty}
        className="inline-flex w-full items-center justify-center rounded bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? 'Saving…' : 'Save contract details'}
      </button>
    </div>
  );
}
