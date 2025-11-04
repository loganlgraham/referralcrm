'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency } from '@/utils/formatters';

interface PaymentRow {
  _id: string;
  referralId: string;
  status: string;
  expectedAmountCents: number;
  receivedAmountCents?: number;
  invoiceDate?: string;
  paidDate?: string;
}

export function PaymentsTable() {
  const { data } = useSWR<PaymentRow[]>('/api/payments', fetcher);
  if (!data) return <div className="rounded-lg bg-white p-4 shadow-sm">Loading payments…</div>;

  const totals = data.reduce(
    (acc, item) => {
      acc.expected += item.expectedAmountCents || 0;
      acc.received += item.receivedAmountCents || 0;
      return acc;
    },
    { expected: 0, received: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs uppercase text-slate-400">Expected</p>
          <p className="text-lg font-semibold text-slate-900">{formatCurrency(totals.expected)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs uppercase text-slate-400">Received</p>
          <p className="text-lg font-semibold text-slate-900">{formatCurrency(totals.received)}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Expected</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Received</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((payment) => (
              <tr key={payment._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">{payment.referralId}</td>
                <td className="px-4 py-3 text-sm capitalize text-slate-700">{payment.status}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(payment.expectedAmountCents)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(payment.receivedAmountCents || 0)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {payment.invoiceDate ? new Date(payment.invoiceDate).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {payment.paidDate ? new Date(payment.paidDate).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
