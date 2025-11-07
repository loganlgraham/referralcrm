'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { formatCurrency } from '@/utils/formatters';

type DealStatus = 'under_contract' | 'closed' | 'paid';

interface DealRecord {
  _id?: string;
  status?: string;
  expectedAmountCents?: number;
}

interface DealOverrides {
  referralFeeDueCents?: number;
  propertyAddress?: string;
  hasUnsavedContractChanges?: boolean;
}

interface ReferralDealProps {
  referral: {
    _id: string;
    propertyAddress?: string;
    propertyZip?: string;
    referralFeeDueCents?: number;
    payments?: DealRecord[];
  };
  overrides?: DealOverrides;
}

const STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'paid', label: 'Paid' }
];

export function DealCard({ referral, overrides }: ReferralDealProps) {
  const existingDeal = referral.payments?.[0];
  const initialStatus = STATUS_OPTIONS.find((option) => option.value === existingDeal?.status)?.value ?? 'under_contract';
  const [status, setStatus] = useState<DealStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [dealRecordId, setDealRecordId] = useState<string | undefined>(existingDeal?._id);

  const expectedAmountCents = useMemo(() => {
    if (overrides?.referralFeeDueCents !== undefined) {
      return overrides.referralFeeDueCents;
    }
    if (existingDeal?.expectedAmountCents && existingDeal.expectedAmountCents > 0) {
      return existingDeal.expectedAmountCents;
    }
    return referral.referralFeeDueCents ?? 0;
  }, [existingDeal?.expectedAmountCents, overrides?.referralFeeDueCents, referral.referralFeeDueCents]);

  const formattedAmount = expectedAmountCents > 0 ? formatCurrency(expectedAmountCents) : '—';
  const propertyLabel =
    overrides?.propertyAddress ||
    referral.propertyAddress ||
    (referral.propertyZip ? `Zip ${referral.propertyZip}` : 'Pending address');

  const handleStatusChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as DealStatus;
    setStatus(nextStatus);

    if (expectedAmountCents <= 0) {
      toast.error('Add contract details before updating deal status.');
      return;
    }

    setSaving(true);
    try {
      if (dealRecordId) {
        const response = await fetch('/api/payments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: dealRecordId, status: nextStatus })
        });
        if (!response.ok) {
          throw new Error('Unable to update deal');
        }
      } else {
        const response = await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referralId: referral._id,
            status: nextStatus,
            expectedAmountCents
          })
        });
        if (!response.ok) {
          throw new Error('Unable to create deal record');
        }
        const body = (await response.json()) as { id: string };
        setDealRecordId(body.id);
      }
      toast.success('Deal status saved');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Deals</h2>
        <p className="text-sm text-slate-500">Track referral revenue from contract through payout</p>
      </div>
      <div className="grid gap-3 text-sm">
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-400">Property</p>
          <p className="font-medium text-slate-900">{propertyLabel}</p>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-400">Referral Fee Due</p>
          <p className="font-medium text-slate-900">{formattedAmount}</p>
          {overrides?.hasUnsavedContractChanges && (
            <p className="mt-2 text-xs text-amber-600">Save contract details to lock in this referral fee.</p>
          )}
        </div>
        <div className="rounded border border-slate-200 p-3">
          <label className="flex flex-col gap-2 text-xs uppercase text-slate-400">
            Deal Status
            <select
              value={status}
              onChange={handleStatusChange}
              className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-700"
              disabled={saving || expectedAmountCents <= 0}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {expectedAmountCents <= 0 && (
            <p className="mt-2 text-xs text-amber-600">
              Enter contract details to calculate the referral fee before updating deal status.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
