'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReferralStatus } from '@/models/referral';
import { toast } from 'sonner';

interface ContractDetails {
  propertyAddress?: string;
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
    contractPriceCents: number;
    agentCommissionBasisPoints: number;
    referralFeeBasisPoints: number;
    referralFeeDueCents: number;
  }) => void;
  onPreApprovalSaved?: (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => void;
  onContractDraftChange?: (details: {
    propertyAddress?: string;
    contractPriceCents?: number;
    agentCommissionBasisPoints?: number;
    referralFeeBasisPoints?: number;
    referralFeeDueCents?: number;
    hasUnsavedChanges: boolean;
  }) => void;
}

interface ContractFormState {
  propertyAddress: string;
  contractPrice: string;
  agentCommissionPercentage: string;
  referralFeePercentage: string;
}

const buildInitialFormState = (details?: ContractDetails): ContractFormState => ({
  propertyAddress: details?.propertyAddress ?? '',
  contractPrice: details?.contractPriceCents ? (details.contractPriceCents / 100).toString() : '',
  agentCommissionPercentage: details?.agentCommissionBasisPoints
    ? (details.agentCommissionBasisPoints / 100).toString()
    : '3',
  referralFeePercentage: details?.referralFeeBasisPoints ? (details.referralFeeBasisPoints / 100).toString() : '',
});

const calculateReferralFeeAmount = (
  priceInput: string,
  commissionInput: string,
  referralFeeInput: string
) => {
  const price = Number(priceInput);
  const commission = Number(commissionInput);
  const referralFee = Number(referralFeeInput);

  if ([price, commission, referralFee].some((value) => Number.isNaN(value) || value <= 0)) {
    return '';
  }

  const amount = price * (commission / 100) * (referralFee / 100);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '';
  }

  return amount.toFixed(2);
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
  const [preApproval, setPreApproval] = useState(
    preApprovalAmountCents ? (preApprovalAmountCents / 100).toString() : ''
  );
  const [preApprovalDirty, setPreApprovalDirty] = useState(false);
  const [preApprovalSaving, setPreApprovalSaving] = useState(false);

  useEffect(() => {
    setCurrentStatus(status);
    setPersistedStatus(status);
  }, [status]);

  const broadcastContractState = useCallback(
    (form: ContractFormState, dirty: boolean) => {
      if (!onContractDraftChange) {
        return;
      }

      const price = Number(form.contractPrice);
      const commission = Number(form.agentCommissionPercentage);
      const referralFee = Number(form.referralFeePercentage);
      const referralFeeAmount = calculateReferralFeeAmount(
        form.contractPrice,
        form.agentCommissionPercentage,
        form.referralFeePercentage
      );

      onContractDraftChange({
        propertyAddress: form.propertyAddress?.trim() ? form.propertyAddress : undefined,
        contractPriceCents:
          Number.isFinite(price) && price > 0 ? Math.round(price * 100) : undefined,
        agentCommissionBasisPoints:
          Number.isFinite(commission) && commission > 0 ? Math.round(commission * 100) : undefined,
        referralFeeBasisPoints:
          Number.isFinite(referralFee) && referralFee > 0 ? Math.round(referralFee * 100) : undefined,
        referralFeeDueCents:
          referralFeeAmount && Number(referralFeeAmount) > 0
            ? Math.round(Number(referralFeeAmount) * 100)
            : undefined,
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
    contractDetails?.contractPriceCents,
    contractDetails?.agentCommissionBasisPoints,
    contractDetails?.referralFeeBasisPoints,
    contractDetails ? 1 : 0,
    contractDirty,
  ]);

  useEffect(() => {
    setPreApproval(preApprovalAmountCents ? (preApprovalAmountCents / 100).toString() : '');
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

    return (
      contractForm.propertyAddress.trim().length > 0 &&
      contractForm.contractPrice.trim().length > 0 &&
      contractForm.agentCommissionPercentage.trim().length > 0 &&
      contractForm.referralFeePercentage.trim().length > 0 &&
      referralFeeAmount.trim().length > 0
    );
  }, [contractForm, currentStatus]);

  const referralFeeAmountDisplay = useMemo(
    () =>
      calculateReferralFeeAmount(
        contractForm.contractPrice,
        contractForm.agentCommissionPercentage,
        contractForm.referralFeePercentage
      ),
    [contractForm.agentCommissionPercentage, contractForm.contractPrice, contractForm.referralFeePercentage]
  );

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

        const contractPrice = Number(contractForm.contractPrice);
        const agentCommission = Number(contractForm.agentCommissionPercentage);
        const referralFeePercentage = Number(contractForm.referralFeePercentage);
        const referralFeeAmount = Number(referralFeeAmountDisplay);

        if ([contractPrice, agentCommission, referralFeePercentage, referralFeeAmount].some((value) => Number.isNaN(value))) {
          toast.error('Contract amounts must be valid numbers.');
          setLoading(false);
          return;
        }

        payload.contractDetails = {
          propertyAddress: contractForm.propertyAddress,
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
          contractPriceCents: number;
          agentCommissionBasisPoints: number;
          referralFeeBasisPoints: number;
          referralFeeDueCents: number;
        };
        setContractForm({
          propertyAddress: details.propertyAddress ?? '',
          contractPrice: details.contractPriceCents ? (details.contractPriceCents / 100).toString() : '',
          agentCommissionPercentage: details.agentCommissionBasisPoints
            ? (details.agentCommissionBasisPoints / 100).toString()
            : '',
          referralFeePercentage: details.referralFeeBasisPoints
            ? (details.referralFeeBasisPoints / 100).toString()
            : '',
        });
        setContractDirty(false);
        broadcastContractState(
          {
            propertyAddress: details.propertyAddress ?? '',
            contractPrice: details.contractPriceCents ? (details.contractPriceCents / 100).toString() : '',
            agentCommissionPercentage: details.agentCommissionBasisPoints
              ? (details.agentCommissionBasisPoints / 100).toString()
              : '',
            referralFeePercentage: details.referralFeeBasisPoints
              ? (details.referralFeeBasisPoints / 100).toString()
              : '',
          },
          false
        );
        onContractSaved?.({
          propertyAddress: details.propertyAddress ?? '',
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
        const next = { ...previous, [field]: value };
        broadcastContractState(next, true);
        return next;
      });
      setContractDirty(true);
    };

  const handleSaveContractDetails = () => {
    void submitStatus('Under Contract', persistedStatus);
  };

  const handlePreApprovalChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPreApproval(event.target.value);
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
          {statuses.map((item) => (
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
              type="number"
              min="0"
              step="0.01"
              value={preApproval}
              onChange={handlePreApprovalChange}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="350000"
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
                placeholder="123 Main St, City, ST 12345"
                disabled={loading}
              />
            </label>
            <label className="block">
              <span className="text-slate-500">Contract Price ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={contractForm.contractPrice}
                onChange={handleContractFieldChange('contractPrice')}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                placeholder="450000"
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
                  placeholder="1"
                  disabled={loading}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-slate-500">Referral Fee Amount ($)</span>
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
