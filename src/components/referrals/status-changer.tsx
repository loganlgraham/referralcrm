'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function StatusChanger({ referralId, status, statuses, contractDetails }: Props) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [persistedStatus, setPersistedStatus] = useState(status);
  const [loading, setLoading] = useState(false);
  const [contractForm, setContractForm] = useState<ContractFormState>(() => buildInitialFormState(contractDetails));

  useEffect(() => {
    setCurrentStatus(status);
    setPersistedStatus(status);
  }, [status]);

  useEffect(() => {
    setContractForm(buildInitialFormState(contractDetails));
  }, [contractDetails]);

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
          propertyAddress: contractForm.propertyAddress.trim(),
          contractPrice,
          agentCommissionPercentage: agentCommission,
          referralFeePercentage
        };
      }

      const res = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
        const errorBody = await res
          .json()
          .catch(() => undefined) as { error?: Record<string, unknown> } | undefined;
        const hasContractError = Boolean(errorBody?.error && 'contractDetails' in (errorBody.error ?? {}));
        const message = hasContractError ? 'Add contract details before marking this referral Under Contract.' : 'Failed to update status';
        throw new Error(message);
      }

      setCurrentStatus(nextStatus);
      setPersistedStatus(nextStatus);
      if (nextStatus === 'Under Contract' && payload.contractDetails) {
        const details = payload.contractDetails as {
          propertyAddress: string;
          contractPrice: number;
          agentCommissionPercentage: number;
          referralFeePercentage: number;
        };
        setContractForm({
          propertyAddress: details.propertyAddress,
          contractPrice: String(details.contractPrice ?? ''),
          agentCommissionPercentage: String(details.agentCommissionPercentage ?? ''),
          referralFeePercentage: String(details.referralFeePercentage ?? '')
        });
      }
      toast.success('Referral status updated');
    } catch (error) {
      console.error(error);
      setCurrentStatus(previousStatus);
      toast.error(error instanceof Error ? error.message : 'Unable to update status');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;

    if (nextStatus === 'Under Contract') {
      setCurrentStatus(nextStatus);
      return;
    }

    void submitStatus(nextStatus, persistedStatus);
  };

  const handleContractFieldChange = (field: keyof ContractFormState) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setContractForm((previous) => ({ ...previous, [field]: event.target.value }));
    };

  const handleSaveContractDetails = () => {
    void submitStatus('Under Contract', persistedStatus);
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
            disabled={loading || !contractFieldsValid}
            className="inline-flex w-full items-center justify-center rounded bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Saving…' : 'Save Contract Details'}
          </button>
        </div>
      )}
    </div>
  );
}
