'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency } from '@/utils/formatters';

type DealStatus = 'under_contract' | 'closed' | 'paid' | 'terminated';

const STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'paid', label: 'Paid' },
  { value: 'terminated', label: 'Terminated' }
];

interface DealRow {
  _id: string;
  referralId: string;
  status: DealStatus;
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function DealsTable() {
  const { data: session } = useSession();
  const { data, mutate } = useSWR<DealRow[]>('/api/payments', fetcher);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading deals…</div>;
  }

  const role = session?.user?.role;
  const isAgentView = role === 'agent';
  const isMcView = role === 'mc';
  const isAdminView = role === 'admin' || role === 'manager';

  const calculateCommission = (row: DealRow) => {
    if (row.status === 'terminated') {
      return 0;
    }

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

  const aggregates = data.reduce(
    (acc, row) => {
      const isTerminated = row.status === 'terminated';

      if (row.status === 'under_contract') {
        acc.totalUnderContract += 1;
      }
      if (isTerminated) {
        acc.totalTerminated += 1;
      }

      const expectedBase = row.expectedAmountCents ?? row.referral?.referralFeeDueCents ?? 0;
      const expected = isTerminated ? 0 : expectedBase;
      const paidAmount =
        row.status === 'paid'
          ? row.receivedAmountCents || row.expectedAmountCents || 0
          : row.receivedAmountCents || 0;
      const effectivePaid = isTerminated ? 0 : paidAmount;
      const commission = calculateCommission(row);

      acc.expectedRevenue += expected;
      acc.receivedRevenue += effectivePaid;
      acc.referralFeesPaid += effectivePaid;
      acc.commissionEarned += commission;

      return acc;
    },
    {
      expectedRevenue: 0,
      receivedRevenue: 0,
      referralFeesPaid: 0,
      commissionEarned: 0,
      totalUnderContract: 0,
      totalTerminated: 0,
    }
  );

  const totalCommission = aggregates.commissionEarned - aggregates.referralFeesPaid;

  const summarySection = (() => {
    if (isAdminView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Expected Revenue" value={formatCurrency(aggregates.expectedRevenue)} />
          <SummaryCard label="Received Revenue" value={formatCurrency(aggregates.receivedRevenue)} />
        </div>
      );
    }

    if (isMcView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Total Deals Under Contract" value={aggregates.totalUnderContract.toLocaleString()} />
          <SummaryCard label="Total Deals Terminated" value={aggregates.totalTerminated.toLocaleString()} />
        </div>
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Referral Fees Paid" value={formatCurrency(aggregates.referralFeesPaid)} />
        <SummaryCard label="Commission Earned" value={formatCurrency(aggregates.commissionEarned)} />
        <SummaryCard label="Total Commission" value={formatCurrency(totalCommission)} />
      </div>
    );
  })();

  const handleStatusChange = async (deal: DealRow, nextStatus: DealStatus) => {
    const previousSnapshot = [...data];
    const optimistic = data.map((row) => (row._id === deal._id ? { ...row, status: nextStatus } : row));

    setUpdatingId(deal._id);
    await mutate(optimistic, false);

    try {
      const payload: Record<string, unknown> = {
        id: deal._id,
        status: nextStatus,
      };

      if (nextStatus === 'terminated') {
        payload.expectedAmountCents = 0;
      } else {
        const fallbackExpected = deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
        if (fallbackExpected > 0) {
          payload.expectedAmountCents = fallbackExpected;
        }
      }

      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Unable to update deal status');
      }

      toast.success('Deal status updated');
      await mutate();
    } catch (error) {
      console.error(error);
      await mutate(previousSnapshot, false);
      toast.error(error instanceof Error ? error.message : 'Unable to update deal status');
      await mutate();
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {summarySection}
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
              const isTerminated = deal.status === 'terminated';
              const paidAmount = isTerminated
                ? 0
                : deal.status === 'paid'
                  ? deal.receivedAmountCents || deal.expectedAmountCents || 0
                  : deal.receivedAmountCents || 0;
              const referralFee = isTerminated
                ? 0
                : deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents;
              const netCommission = isTerminated ? 0 : commission - paidAmount;

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
                  <td className="px-4 py-3 text-sm text-slate-700">
                    <select
                      value={deal.status}
                      onChange={(event) => handleStatusChange(deal, event.target.value as DealStatus)}
                      className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
                      disabled={updatingId === deal._id}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {isTerminated ? '—' : formatCurrency(referralFee || 0)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {isTerminated ? '—' : formatCurrency(paidAmount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {isTerminated ? '—' : formatCurrency(commission)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {isTerminated ? '—' : formatCurrency(netCommission)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
