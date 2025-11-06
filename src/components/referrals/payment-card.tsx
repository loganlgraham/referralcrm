'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { formatCurrency } from '@/utils/formatters';

type PaymentStatus = 'under_contract' | 'closed' | 'paid';

interface PaymentRecord {
  _id?: string;
  status?: string;
  expectedAmountCents?: number;
}

interface ReferralPaymentProps {
  referral: {
    _id: string;
    propertyAddress?: string;
    propertyZip?: string;
    referralFeeDueCents?: number;
    payments?: PaymentRecord[];
  };
}

const STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'paid', label: 'Paid' }
];

export function PaymentCard({ referral }: ReferralPaymentProps) {
  const existingPayment = referral.payments?.[0];
  const initialStatus = STATUS_OPTIONS.find((option) => option.value === existingPayment?.status)?.value ?? 'under_contract';
  const [status, setStatus] = useState<PaymentStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [paymentId, setPaymentId] = useState<string | undefined>(existingPayment?._id);

  const expectedAmountCents = useMemo(() => {
    if (existingPayment?.expectedAmountCents && existingPayment.expectedAmountCents > 0) {
      return existingPayment.expectedAmountCents;
    }
    return referral.referralFeeDueCents ?? 0;
  }, [existingPayment?.expectedAmountCents, referral.referralFeeDueCents]);

  const formattedAmount = expectedAmountCents > 0 ? formatCurrency(expectedAmountCents) : '—';
  const propertyLabel = referral.propertyAddress || (referral.propertyZip ? `Zip ${referral.propertyZip}` : 'Pending address');

  const handleStatusChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as PaymentStatus;
    setStatus(nextStatus);

    if (expectedAmountCents <= 0) {
      toast.error('Add contract details before updating payment status.');
      return;
    }

    setSaving(true);
    try {
      if (paymentId) {
        const response = await fetch('/api/payments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: paymentId, status: nextStatus })
        });
        if (!response.ok) {
          throw new Error('Unable to update payment');
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
          throw new Error('Unable to create payment record');
        }
        const body = (await response.json()) as { id: string };
        setPaymentId(body.id);
      }
      toast.success('Payment status saved');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Payments</h2>
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
        </div>
        <div className="rounded border border-slate-200 p-3">
          <label className="flex flex-col gap-2 text-xs uppercase text-slate-400">
            Payment Status
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
              Enter contract details to calculate the referral fee before updating payment status.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
