'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { toast } from 'sonner';

import { DEAL_STATUS_LABELS, DEAL_STATUS_OPTIONS, type DealStatus } from '@/constants/deals';
import { formatCurrency } from '@/utils/formatters';
import type { ReferralPayment } from '@/types/referral-payment';

interface ReferralDealsProps {
  referralId: string;
  deals: ReferralPayment[];
  onDealCreated: (deal: ReferralPayment) => void;
  viewerRole?: string;
}

const toCents = (value: string): number => {
  const numeric = Number.parseFloat(value.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 100);
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
};

export function ReferralDeals({ referralId, deals, onDealCreated, viewerRole }: ReferralDealsProps) {
  const [status, setStatus] = useState<DealStatus>('under_contract');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canCreate = viewerRole !== 'viewer';

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
    if (!canCreate) return;

    const expectedAmountCents = toCents(expectedAmount);
    const receivedAmountCents = toCents(receivedAmount);

    if (!expectedAmountCents) {
      toast.error('Enter an expected amount');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralId,
          status,
          expectedAmountCents,
          receivedAmountCents,
        }),
      });

      if (!response.ok) {
        toast.error('Unable to save deal');
        return;
      }

      const payload = (await response.json()) as { id: string; createdAt?: string };
      onDealCreated({
        _id: payload.id,
        status,
        expectedAmountCents,
        receivedAmountCents,
        createdAt: payload.createdAt ?? new Date().toISOString(),
        updatedAt: payload.createdAt ?? new Date().toISOString(),
        paidDate: null,
        invoiceDate: null,
      });
      setExpectedAmount('');
      setReceivedAmount('');
      setStatus('under_contract');
      toast.success('Deal added');
    } catch (error) {
      console.error(error);
      toast.error('Something went wrong while saving the deal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-slate-500">Deals</p>
          <h2 className="text-lg font-semibold text-slate-900">Referral deals</h2>
        </div>
        {canCreate && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            Add new deal
          </span>
        )}
      </div>

      {canCreate && (
        <form onSubmit={handleSubmit} className="grid gap-4 rounded-md border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Expected amount</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={expectedAmount}
              onChange={(event) => setExpectedAmount(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={submitting}
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Received amount (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={receivedAmount}
              onChange={(event) => setReceivedAmount(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
              placeholder="0.00"
              disabled={submitting}
            />
          </label>
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
          sortedDeals.map((deal) => {
            const statusLabel = DEAL_STATUS_LABELS[(deal.status as DealStatus | undefined) ?? 'under_contract'];
            const expected = formatCurrency(deal.expectedAmountCents ?? 0);
            const received = deal.receivedAmountCents ? formatCurrency(deal.receivedAmountCents) : '—';

            return (
              <div
                key={deal._id}
                className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="text-xs uppercase text-slate-500">Status</p>
                  <p className="text-sm font-semibold text-slate-900">{statusLabel}</p>
                  <p className="text-xs text-slate-500">Created {formatDate(deal.createdAt)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase text-slate-500">Expected</p>
                  <p className="text-sm font-semibold text-slate-900">{expected}</p>
                  <p className="text-xs text-slate-500">Received: {received}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
