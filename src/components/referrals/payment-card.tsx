import { formatCurrency } from '@/utils/formatters';

export function PaymentCard({ referral }: { referral: any }) {
  const payments = referral.payments || [];

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Payments</h2>
      <p className="text-sm text-slate-500">Track expected vs received revenue</p>
      <div className="mt-4 space-y-3">
        {payments.length === 0 && <p className="text-sm text-slate-500">No payments recorded.</p>}
        {payments.map((payment: any) => (
          <div key={payment._id} className="rounded border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium capitalize">{payment.status}</span>
              <span>{formatCurrency(payment.expectedAmountCents)}</span>
            </div>
            {payment.receivedAmountCents ? (
              <p className="text-xs text-slate-500">
                Received {formatCurrency(payment.receivedAmountCents)} on{' '}
                {payment.paidDate ? new Date(payment.paidDate).toLocaleDateString() : '—'}
              </p>
            ) : (
              <p className="text-xs text-slate-500">Awaiting payment</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
