import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';

export function ReferralHeader({ referral }: { referral: any }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{referral.borrower.name}</h1>
          <p className="text-sm text-slate-500">
            {referral.borrower.email} • {referral.borrower.phone}
          </p>
          <p className="text-xs uppercase tracking-wide text-slate-400">Zip {referral.propertyZip}</p>
        </div>
        <div className="flex gap-4">
          <div className="rounded-lg border border-slate-200 px-4 py-2 text-right">
            <p className="text-xs uppercase text-slate-400">Status</p>
            <p className="text-lg font-semibold text-brand">{referral.status}</p>
            <p className="text-xs text-slate-400">Days in status: {referral.daysInStatus}</p>
          </div>
          <div className="rounded-lg border border-slate-200 px-4 py-2 text-right">
            <p className="text-xs uppercase text-slate-400">Referral Fee Due</p>
            <p className="text-lg font-semibold text-slate-900">{formatCurrency(referral.referralFeeDueCents)}</p>
            <p className="text-xs text-slate-400">Commission {referral.commissionBasisPoints / 100}%</p>
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <StatusChanger referralId={referral._id} status={referral.status as ReferralStatus} statuses={REFERRAL_STATUSES} />
        <SLAWidget referral={referral} />
      </div>
    </div>
  );
}
