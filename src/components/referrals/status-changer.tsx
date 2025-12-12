'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { normalizeReferralStatus } from '@/constants/referrals';
import { ReferralStatus } from '@/models/referral';
import { toast } from 'sonner';

interface Props {
  referralId: string;
  status: ReferralStatus;
  statuses: readonly ReferralStatus[];
  preApprovalAmountCents?: number;
  onStatusChanged?: (status: ReferralStatus, payload?: Record<string, unknown>) => void;
  onPreApprovalSaved?: (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => void;
  onUnderContractIntentChange?: (isPreparing: boolean) => void;
}

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
  preApprovalAmountCents,
  onStatusChanged,
  onPreApprovalSaved,
  onUnderContractIntentChange,
}: Props) {
  const router = useRouter();
  const normalizedStatus = useMemo(() => normalizeReferralStatus(status) ?? status, [status]);
  const [currentStatus, setCurrentStatus] = useState<ReferralStatus>(normalizedStatus);
  const [persistedStatus, setPersistedStatus] = useState<ReferralStatus>(normalizedStatus);
  const [loading, setLoading] = useState(false);
  const [preApproval, setPreApproval] = useState(() => centsToCurrencyInput(preApprovalAmountCents));
  const [preApprovalDirty, setPreApprovalDirty] = useState(false);
  const [preApprovalSaving, setPreApprovalSaving] = useState(false);
  const [editingPreApproval, setEditingPreApproval] = useState(false);

  useEffect(() => {
    setCurrentStatus(normalizedStatus);
    setPersistedStatus(normalizedStatus);
  }, [normalizedStatus]);

  useEffect(() => {
    onUnderContractIntentChange?.(currentStatus === 'Under Contract');
  }, [currentStatus, onUnderContractIntentChange]);

  useEffect(() => {
    setPreApproval(centsToCurrencyInput(preApprovalAmountCents));
    setPreApprovalDirty(false);
  }, [preApprovalAmountCents]);

  const pipelineOptions = useMemo(() => {
    const filtered = statuses.filter((item) => item !== 'Closed' && item !== 'Terminated' && item !== 'Lost');
    const containsCurrent = filtered.some((item) => item === currentStatus);
    if (!containsCurrent) {
      return [...filtered, currentStatus];
    }
    return filtered;
  }, [statuses, currentStatus]);

  const submitStatus = async (nextStatus: ReferralStatus, previousStatus: ReferralStatus) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      const body = (await res.json()) as Record<string, unknown>;
      const resolvedStatus = (body.status as ReferralStatus | undefined) ?? nextStatus;
      setCurrentStatus(resolvedStatus);
      setPersistedStatus(resolvedStatus);
      router.refresh();

      onStatusChanged?.(resolvedStatus, { ...body, previousStatus });
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

    setCurrentStatus(nextStatus);
    onUnderContractIntentChange?.(nextStatus === 'Under Contract');
    void submitStatus(nextStatus, persistedStatus);
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
      setEditingPreApproval(false);
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

  const formattedPreApprovalDisplay = preApproval
    ? `$${formatCurrencyInputDisplay(preApproval)}`
    : 'No pre-approval';

  const handlePreApprovalCancel = () => {
    setPreApproval(centsToCurrencyInput(preApprovalAmountCents));
    setPreApprovalDirty(false);
    setEditingPreApproval(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Pipeline Status</p>
          <select
            value={currentStatus}
            onChange={handleChange}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            disabled={loading}
          >
            {pipelineOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Pre-approval</div>
          {editingPreApproval ? (
            <div className="space-y-2">
              <input
                type="text"
                inputMode="decimal"
                value={formatCurrencyInputDisplay(preApproval)}
                onChange={handlePreApprovalChange}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                placeholder="300,000"
                disabled={preApprovalSaving || loading}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreApprovalSave}
                  disabled={preApprovalSaving || !preApprovalDirty}
                  className="inline-flex flex-1 items-center justify-center rounded bg-brand-accent px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-accent-dark disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {preApprovalSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={handlePreApprovalCancel}
                  disabled={preApprovalSaving || loading}
                  className="inline-flex items-center justify-center rounded border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
              <span>{formattedPreApprovalDisplay}</span>
              <button
                type="button"
                onClick={() => setEditingPreApproval(true)}
                className="inline-flex items-center justify-center rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Edit pre-approval"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
