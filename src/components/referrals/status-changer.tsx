'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReferralStatus } from '@/models/referral';
import { toast } from 'sonner';

import { formatCurrency } from '@/utils/formatters';

interface ContractDetails {
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyPostalCode?: string;
  contractPriceCents?: number;
  agentCommissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
}

interface Props {
  referralId: string;
  status: ReferralStatus;
  statuses: readonly ReferralStatus[];
  contractDetails?: ContractDetails;
  preApprovalAmountCents?: number;
  referralFeeDueCents?: number;
  onStatusChanged?: (status: ReferralStatus, payload?: Record<string, unknown>) => void;
  onContractSaved?: (details: {
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyPostalCode: string;
    contractPriceCents: number;
    agentCommissionBasisPoints: number;
    referralFeeBasisPoints: number;
    referralFeeDueCents: number;
  }) => void;
  onPreApprovalSaved?: (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => void;
  onContractDraftChange?: (details: {
    propertyAddress?: string;
    propertyCity?: string;
    propertyState?: string;
    propertyPostalCode?: string;
    contractPriceCents?: number;
    agentCommissionBasisPoints?: number;
    referralFeeBasisPoints?: number;
    referralFeeDueCents?: number;
    hasUnsavedChanges: boolean;
  }) => void;
}

interface ContractFormState {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyPostalCode: string;
  contractPrice: string;
  agentCommissionPercentage: string;
  referralFeePercentage: string;
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

const centsToCurrencyInput = (value?: number | null) => {
  if (!value) {
    return '';
  }
  const amount = value / 100;
  return Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
};

const sanitizeCurrencyInput = (value: string) => {
  if (!value) {
    return '';
  }
  const stripped = value.replace(/[^0-9.]/g, '');
  if (!stripped) {
    return '';
  }

  const [integerPart = '', ...decimalParts] = stripped.split('.');
  const decimalPart = decimalParts.join('').slice(0, 2);
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const hasDecimal = decimalParts.length > 0;
  const safeInteger = normalizedInteger || (integerPart.length > 0 ? '0' : '');

  if (!hasDecimal) {
    return safeInteger;
  }

  const integerPortion = safeInteger || '0';
  return decimalPart.length > 0 ? `${integerPortion}.${decimalPart}` : `${integerPortion}.`;
};

const formatCurrencyInputDisplay = (value: string) => {
  if (!value) {
    return '';
  }

  const [integerPart = '', decimalPart] = value.split('.');
  const hasDecimal = decimalPart !== undefined;
  const sanitizedInteger = integerPart.replace(/[^0-9]/g, '');
  const integerValue = sanitizedInteger ? Number(sanitizedInteger) : 0;
  const formattedInteger = sanitizedInteger
    ? integerValue.toLocaleString('en-US')
    : hasDecimal
    ? '0'
    : '';

  if (!hasDecimal) {
    return formattedInteger;
  }

  if (decimalPart === undefined) {
    return formattedInteger;
  }

  if (decimalPart.length === 0) {
    return `${formattedInteger}.`;
  }

  return `${formattedInteger}.${decimalPart}`;
};

export function StatusChanger({
  referralId,
  status,
  statuses,
  contractDetails,
  preApprovalAmountCents,
  referralFeeDueCents,
  onStatusChanged,
  onContractSaved,
  onPreApprovalSaved,
  onContractDraftChange,
}: Props) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [persistedStatus, setPersistedStatus] = useState(status);
  const [loading, setLoading] = useState(false);
  const [contractForm, setContractForm] = useState<ContractFormState>(() => buildInitialFormState(contractDetails));
  const [contractDirty, setContractDirty] = useState(false);
  const [preApproval, setPreApproval] = useState(() => centsToCurrencyInput(preApprovalAmountCents));
  const [preApprovalDirty, setPreApprovalDirty] = useState(false);
  const [preApprovalSaving, setPreApprovalSaving] = useState(false);

  useEffect(() => {
    setCurrentStatus(status);
    setPersistedStatus(status);
  }, [status]);

  const pipelineOptions = useMemo(() => {
    const filtered = statuses.filter((item) => item !== 'Closed' && item !== 'Terminated' && item !== 'Lost');
    const containsCurrent = filtered.some((item) => item === currentStatus);
    if (!containsCurrent) {
      return [...filtered, currentStatus];
    }
    return filtered;
  }, [statuses, currentStatus]);

  const broadcastContractState = useCallback(
    (form: ContractFormState, dirty: boolean) => {
      if (!onContractDraftChange) {
        return;
      }

      const price = form.contractPrice ? Number(form.contractPrice) : Number.NaN;
      const commission = Number(form.agentCommissionPercentage);
      const referralFee = Number(form.referralFeePercentage);
      const referralFeeAmount = calculateReferralFeeAmount(
        form.contractPrice,
        form.agentCommissionPercentage,
        form.referralFeePercentage
      );

      const trimmedCity = form.propertyCity.trim();
      const trimmedState = form.propertyState.trim().toUpperCase();
      const trimmedPostal = form.propertyPostalCode.trim();
      const displayAddress = formatFullAddress(
        form.propertyAddress,
        trimmedCity,
        trimmedState,
        trimmedPostal
      );

      onContractDraftChange({
        propertyAddress: displayAddress || undefined,
        propertyCity: trimmedCity || undefined,
        propertyState: trimmedState || undefined,
        propertyPostalCode: trimmedPostal || undefined,
        contractPriceCents:
          Number.isFinite(price) && price > 0 ? Math.round(price * 100) : undefined,
        agentCommissionBasisPoints:
          Number.isFinite(commission) && commission > 0 ? Math.round(commission * 100) : undefined,
        referralFeeBasisPoints:
          Number.isFinite(referralFee) && referralFee > 0 ? Math.round(referralFee * 100) : undefined,
        referralFeeDueCents:
          referralFeeAmount && referralFeeAmount > 0 ? Math.round(referralFeeAmount * 100) : undefined,
        hasUnsavedChanges: dirty,
      });
    },
    [onContractDraftChange]
  );

  useEffect(() => {
    if (contractDirty) {
      return;
    }

    const nextForm = buildInitialFormState(contractDetails);
    setContractForm((previous) => {
      const hasChanged =
        previous.propertyAddress !== nextForm.propertyAddress ||
        previous.propertyCity !== nextForm.propertyCity ||
        previous.propertyState !== nextForm.propertyState ||
        previous.propertyPostalCode !== nextForm.propertyPostalCode ||
        previous.contractPrice !== nextForm.contractPrice ||
        previous.agentCommissionPercentage !== nextForm.agentCommissionPercentage ||
        previous.referralFeePercentage !== nextForm.referralFeePercentage;

      if (!hasChanged) {
        return previous;
      }

      setContractDirty(false);
      broadcastContractState(nextForm, false);
      return nextForm;
    });
  }, [
    broadcastContractState,
    contractDetails?.propertyAddress,
    contractDetails?.propertyCity,
    contractDetails?.propertyState,
    contractDetails?.propertyPostalCode,
    contractDetails?.contractPriceCents,
    contractDetails?.agentCommissionBasisPoints,
    contractDetails?.referralFeeBasisPoints,
    contractDetails ? 1 : 0,
    contractDirty,
  ]);

  useEffect(() => {
    setPreApproval(centsToCurrencyInput(preApprovalAmountCents));
    setPreApprovalDirty(false);
  }, [preApprovalAmountCents]);

  useEffect(() => {
    if (currentStatus === 'Under Contract') {
      broadcastContractState(contractForm, contractDirty);
    } else if (onContractDraftChange) {
      onContractDraftChange({ hasUnsavedChanges: false });
    }
  }, [broadcastContractState, contractDirty, contractForm, currentStatus, onContractDraftChange]);

  const contractFieldsValid = useMemo(() => {
    if (currentStatus !== 'Under Contract') {
      return true;
    }
    const referralFeeAmount = calculateReferralFeeAmount(
      contractForm.contractPrice,
      contractForm.agentCommissionPercentage,
      contractForm.referralFeePercentage
    );

    const hasCity = contractForm.propertyCity.trim().length > 0;
    const stateValid = /^[A-Za-z]{2}$/.test(contractForm.propertyState.trim());
    const postalValid = /^\d{5}(?:-\d{4})?$/.test(contractForm.propertyPostalCode.trim());

    return (
      contractForm.propertyAddress.trim().length > 0 &&
      hasCity &&
      stateValid &&
      postalValid &&
      contractForm.contractPrice.trim().length > 0 &&
      contractForm.agentCommissionPercentage.trim().length > 0 &&
      contractForm.referralFeePercentage.trim().length > 0 &&
      referralFeeAmount !== null
    );
  }, [contractForm, currentStatus]);

  const referralFeeAmountDisplay = useMemo(() => {
    const amount = calculateReferralFeeAmount(
      contractForm.contractPrice,
      contractForm.agentCommissionPercentage,
      contractForm.referralFeePercentage
    );

    if (amount === null) {
      return '';
    }

    return formatCurrency(Math.round(amount * 100));
  }, [contractForm.agentCommissionPercentage, contractForm.contractPrice, contractForm.referralFeePercentage]);

  const submitStatus = async (nextStatus: ReferralStatus, previousStatus: ReferralStatus) => {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === 'Under Contract') {
        if (!contractFieldsValid) {
          toast.error('Fill in all contract details before saving.');
          setLoading(false);
          return;
        }

        const contractPrice = contractForm.contractPrice
          ? Number(contractForm.contractPrice)
          : Number.NaN;
        const agentCommission = Number(contractForm.agentCommissionPercentage);
        const referralFeePercentage = Number(contractForm.referralFeePercentage);
        const referralFeeAmount = calculateReferralFeeAmount(
          contractForm.contractPrice,
          contractForm.agentCommissionPercentage,
          contractForm.referralFeePercentage
        );

        if (
          [contractPrice, agentCommission, referralFeePercentage].some((value) => Number.isNaN(value)) ||
          referralFeeAmount === null
        ) {
          toast.error('Contract amounts must be valid numbers.');
          setLoading(false);
          return;
        }

        const propertyStreet = contractForm.propertyAddress.trim();
        const propertyCity = contractForm.propertyCity.trim();
        const propertyState = contractForm.propertyState.trim().toUpperCase();
        const propertyPostalCode = contractForm.propertyPostalCode.trim();

        payload.contractDetails = {
          propertyAddress: propertyStreet,
          propertyCity,
          propertyState,
          propertyPostalCode,
          contractPrice,
          agentCommissionPercentage: agentCommission,
          referralFeePercentage,
        };
      }

      const res = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorBody = await res
          .json()
          .catch(() => undefined) as { error?: Record<string, unknown> } | undefined;
        const hasContractError = Boolean(errorBody?.error && 'contractDetails' in (errorBody.error ?? {}));
        const message = hasContractError
          ? 'Add contract details before marking this referral Under Contract.'
          : 'Failed to update status';
        throw new Error(message);
      }

      const body = (await res.json()) as Record<string, unknown>;
      const next = (body.status as ReferralStatus | undefined) ?? nextStatus;
      setCurrentStatus(next);
      setPersistedStatus(next);
      router.refresh();

      if (next === 'Under Contract' && body.contractDetails) {
        const details = body.contractDetails as {
          propertyAddress: string;
          propertyCity?: string;
          propertyState?: string;
          propertyPostalCode?: string;
          contractPriceCents: number;
          agentCommissionBasisPoints: number;
          referralFeeBasisPoints: number;
          referralFeeDueCents: number;
        };
        setContractForm({
          propertyAddress: details.propertyAddress ?? '',
          propertyCity: details.propertyCity ?? '',
          propertyState: details.propertyState ? details.propertyState.toUpperCase() : '',
          propertyPostalCode: details.propertyPostalCode ?? '',
          contractPrice: details.contractPriceCents ? (details.contractPriceCents / 100).toString() : '',
          agentCommissionPercentage: details.agentCommissionBasisPoints
            ? (details.agentCommissionBasisPoints / 100).toString()
            : '',
          referralFeePercentage: details.referralFeeBasisPoints
            ? (details.referralFeeBasisPoints / 100).toString()
            : '25',
        });
        setContractDirty(false);
        broadcastContractState(
          {
            propertyAddress: details.propertyAddress ?? '',
            propertyCity: details.propertyCity ?? '',
            propertyState: details.propertyState ? details.propertyState.toUpperCase() : '',
            propertyPostalCode: details.propertyPostalCode ?? '',
            contractPrice: details.contractPriceCents ? (details.contractPriceCents / 100).toString() : '',
            agentCommissionPercentage: details.agentCommissionBasisPoints
              ? (details.agentCommissionBasisPoints / 100).toString()
              : '',
            referralFeePercentage: details.referralFeeBasisPoints
              ? (details.referralFeeBasisPoints / 100).toString()
              : '25',
          },
          false
        );
        onContractSaved?.({
          propertyAddress: details.propertyAddress ?? '',
          propertyCity: details.propertyCity ?? '',
          propertyState: details.propertyState ?? '',
          propertyPostalCode: details.propertyPostalCode ?? '',
          contractPriceCents: details.contractPriceCents ?? 0,
          agentCommissionBasisPoints: details.agentCommissionBasisPoints ?? 0,
          referralFeeBasisPoints: details.referralFeeBasisPoints ?? 0,
          referralFeeDueCents: details.referralFeeDueCents ?? referralFeeDueCents ?? 0,
        });
      } else if (body.preApprovalAmountCents !== undefined && body.referralFeeDueCents !== undefined) {
        onPreApprovalSaved?.({
          preApprovalAmountCents: Number(body.preApprovalAmountCents) || 0,
          referralFeeDueCents: Number(body.referralFeeDueCents) || 0,
        });
      }

      const changePayload = { ...body, previousStatus };
      onStatusChanged?.(next, changePayload);
      toast.success('Referral status updated');
    } catch (error) {
      console.error(error);
      setCurrentStatus(previousStatus);
      toast.error(error instanceof Error ? error.message : 'Unable to update status');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;

    if (nextStatus === 'Under Contract') {
      setCurrentStatus(nextStatus);
      return;
    }

    void submitStatus(nextStatus, persistedStatus);
  };

  const handleContractFieldChange = (field: keyof ContractFormState) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setContractForm((previous) => {
        let nextValue = value;
        if (field === 'contractPrice') {
          const digitsOnly = value.replace(/[^0-9]/g, '');
          nextValue = digitsOnly;
        } else if (field === 'propertyState') {
          nextValue = value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
        } else if (field === 'propertyPostalCode') {
          const sanitized = value.replace(/[^0-9-]/g, '');
          nextValue = sanitized.slice(0, 10);
        }
        const next = { ...previous, [field]: nextValue };
        broadcastContractState(next, true);
        return next;
      });
      setContractDirty(true);
    };

  const handleSaveContractDetails = () => {
    void submitStatus('Under Contract', persistedStatus);
  };

  const handlePreApprovalChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeCurrencyInput(event.target.value);
    setPreApproval(sanitized);
    setPreApprovalDirty(true);
  };

  const handlePreApprovalSave = async () => {
    const amount = Number.parseFloat(preApproval);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error('Enter a valid pre-approval amount.');
      return;
    }
    setPreApprovalSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/pre-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) {
        throw new Error('Unable to save pre-approval amount');
      }
      const body = (await response.json()) as { preApprovalAmountCents: number; referralFeeDueCents: number };
      toast.success('Pre-approval updated');
      setPreApprovalDirty(false);
      onPreApprovalSaved?.({
        preApprovalAmountCents: body.preApprovalAmountCents,
        referralFeeDueCents: body.referralFeeDueCents,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update pre-approval');
    } finally {
      setPreApprovalSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div>
        <p className="text-xs uppercase text-slate-400">Pipeline Status</p>
        <select
          value={currentStatus}
          onChange={handleChange}
          className="mt-2 w-full rounded border border-slate-200 px-3 py-2 text-sm"
          disabled={loading}
        >
          {pipelineOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {currentStatus !== 'Under Contract' && (
        <div className="space-y-2">
          <p className="text-xs uppercase text-slate-400">Pre-Approval</p>
          <label className="text-sm text-slate-600">
            Amount ($)
            <input
              type="text"
              inputMode="decimal"
              value={formatCurrencyInputDisplay(preApproval)}
              onChange={handlePreApprovalChange}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="300,000"
              disabled={preApprovalSaving || loading}
            />
          </label>
          <button
            type="button"
            onClick={handlePreApprovalSave}
            disabled={preApprovalSaving || !preApprovalDirty}
            className="inline-flex w-full items-center justify-center rounded bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {preApprovalSaving ? 'Saving…' : 'Save pre-approval'}
          </button>
        </div>
      )}

      {currentStatus === 'Under Contract' && (
        <div className="space-y-3">
          <p className="text-xs uppercase text-slate-400">Contract Details</p>
          <div className="space-y-2 text-sm">
            <label className="block">
              <span className="text-slate-500">Property Address</span>
              <input
                type="text"
                value={contractForm.propertyAddress}
                onChange={handleContractFieldChange('propertyAddress')}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                placeholder="123 Main St"
                disabled={loading}
              />
            </label>
            <div className="grid gap-3 md:grid-cols-[minmax(0,2fr),repeat(2,minmax(0,1fr))]">
              <label className="block">
                <span className="text-slate-500">City</span>
                <input
                  type="text"
                  value={contractForm.propertyCity}
                  onChange={handleContractFieldChange('propertyCity')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  placeholder="Austin"
                  disabled={loading}
                />
              </label>
              <label className="block">
                <span className="text-slate-500">State</span>
                <input
                  type="text"
                  value={contractForm.propertyState}
                  onChange={handleContractFieldChange('propertyState')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 uppercase"
                  placeholder="TX"
                  maxLength={2}
                  disabled={loading}
                />
              </label>
              <label className="block">
                <span className="text-slate-500">ZIP</span>
                <input
                  type="text"
                  value={contractForm.propertyPostalCode}
                  onChange={handleContractFieldChange('propertyPostalCode')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  placeholder="73301"
                  inputMode="numeric"
                  disabled={loading}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-slate-500">Contract Price ($)</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatContractPriceDisplay(contractForm.contractPrice)}
                onChange={handleContractFieldChange('contractPrice')}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                placeholder="300,000"
                disabled={loading}
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-slate-500">Agent Commission %</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contractForm.agentCommissionPercentage}
                  onChange={handleContractFieldChange('agentCommissionPercentage')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  placeholder="3"
                  disabled={loading}
                />
              </label>
              <label className="block">
                <span className="text-slate-500">Referral Fee %</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contractForm.referralFeePercentage}
                  onChange={handleContractFieldChange('referralFeePercentage')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  placeholder="25"
                  disabled={loading}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-slate-500">Referral Fee Amount</span>
              <input
                type="text"
                value={referralFeeAmountDisplay}
                readOnly
                className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                placeholder="Calculated automatically"
                disabled={loading}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleSaveContractDetails}
            disabled={loading || !contractFieldsValid || !contractDirty}
            className="inline-flex w-full items-center justify-center rounded bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Saving…' : 'Save contract details'}
          </button>
        </div>
      )}
    </div>
  );
}
