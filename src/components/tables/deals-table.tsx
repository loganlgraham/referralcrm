'use client';

import useSWR from 'swr';
import { useSession } from 'next-auth/react';

import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency } from '@/utils/formatters';

interface DealRow {
  _id: string;
  referralId: string;
  status: 'under_contract' | 'closed' | 'paid';
  expectedAmountCents: number;
  receivedAmountCents: number;
  invoiceDate?: string | null;
  paidDate?: string | null;
  referral?: {
    borrowerName?: string | null;
    propertyAddress?: string | null;
    propertyZip?: string | null;
    commissionBasisPoints?: number | null;
    referralFeeBasisPoints?: number | null;
    estPurchasePriceCents?: number | null;
    preApprovalAmountCents?: number | null;
    referralFeeDueCents?: number | null;
  } | null;
}

export function DealsTable() {
  const { data: session } = useSession();
  const { data } = useSWR<DealRow[]>('/api/payments', fetcher);
  if (!data)
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading deals…</div>;

  const calculateCommission = (row: DealRow) => {
    const commissionBps = row.referral?.commissionBasisPoints ?? DEFAULT_AGENT_COMMISSION_BPS;
    const baseAmountCents =
      row.referral?.estPurchasePriceCents && row.referral.estPurchasePriceCents > 0
        ? row.referral.estPurchasePriceCents
        : row.referral?.preApprovalAmountCents ?? 0;

    if (!baseAmountCents || !commissionBps) {
      return 0;
    }

    return Math.round((baseAmountCents * commissionBps) / 10000);
  };

  const totals = data.reduce(
    (acc, row) => {
      const paidAmountCents =
        row.status === 'paid'
          ? row.receivedAmountCents || row.expectedAmountCents || 0
          : row.receivedAmountCents || 0;
      acc.referralFeesPaid += paidAmountCents;
      const commissionEarned = calculateCommission(row);
      acc.commissionEarned += commissionEarned;
      return acc;
    },
    { referralFeesPaid: 0, commissionEarned: 0 }
  );
  const totalCommission = totals.commissionEarned - totals.referralFeesPaid;

  const isAgentView = session?.user?.role === 'agent';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs uppercase text-slate-400">Referral Fees Paid</p>
          <p className="text-lg font-semibold text-slate-900">{formatCurrency(totals.referralFeesPaid)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs uppercase text-slate-400">Commission Earned</p>
          <p className="text-lg font-semibold text-slate-900">{formatCurrency(totals.commissionEarned)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs uppercase text-slate-400">Total Commission</p>
          <p className="text-lg font-semibold text-slate-900">{formatCurrency(totalCommission)}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral Fee</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {isAgentView ? 'Referral Fee Paid' : 'Paid'}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Commission</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Net Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((deal) => {
              const commission = calculateCommission(deal);
              const paidAmount =
                deal.status === 'paid'
                  ? deal.receivedAmountCents || deal.expectedAmountCents
                  : deal.receivedAmountCents;
              const referralFee = deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents;
              const netCommission = commission - paidAmount;
              const statusLabel = deal.status.replace('_', ' ');

              return (
                <tr key={deal._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">
                        {deal.referral?.borrowerName || 'Referral'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {deal.referral?.propertyAddress || deal.referral?.propertyZip || deal.referralId}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm capitalize text-slate-700">{statusLabel}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(referralFee)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(paidAmount)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(commission)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(netCommission)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
