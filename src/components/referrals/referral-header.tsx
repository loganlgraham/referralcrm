import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';

function ContactDetails({
  label,
  contact
}: {
  label: string;
  contact?: { name?: string; email?: string; phone?: string } | null;
}) {
  if (!contact?.name) {
    return (
      <details className="rounded border border-dashed border-slate-200 p-3 text-sm">
        <summary className="cursor-not-allowed text-slate-400">{label}: Unassigned</summary>
      </details>
    );
  }

  return (
    <details className="rounded border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-brand hover:underline">
        {label}: {contact.name}
      </summary>
      <div className="mt-2 space-y-1 text-slate-600">
        {contact.email && (
          <p>
            Email:{' '}
            <a href={`mailto:${contact.email}`} className="text-brand hover:underline">
              {contact.email}
            </a>
          </p>
        )}
        {contact.phone && (
          <p>
            Phone:{' '}
            <a href={`tel:${contact.phone}`} className="text-brand hover:underline">
              {contact.phone}
            </a>
          </p>
        )}
      </div>
    </details>
  );
}

export function ReferralHeader({ referral }: { referral: any }) {
  const contractPrice = referral.estPurchasePriceCents ? formatCurrency(referral.estPurchasePriceCents) : '—';
  const referralFeeDue = referral.referralFeeDueCents ? formatCurrency(referral.referralFeeDueCents) : '—';
  const commissionPercent = referral.commissionBasisPoints
    ? `${(referral.commissionBasisPoints / 100).toFixed(2)}%`
    : '—';
  const referralFeePercent = referral.referralFeeBasisPoints
    ? `${(referral.referralFeeBasisPoints / 100).toFixed(2)}%`
    : '—';

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{referral.borrower.name}</h1>
          <p className="text-sm text-slate-500">
            {referral.borrower.email} • {referral.borrower.phone}
          </p>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {referral.propertyAddress ? referral.propertyAddress : `Zip ${referral.propertyZip}`}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 px-4 py-3 text-right">
            <p className="text-xs uppercase text-slate-400">Status</p>
            <p className="text-lg font-semibold text-brand">{referral.status}</p>
            <p className="text-xs text-slate-400">Days in status: {referral.daysInStatus ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 px-4 py-3 text-right">
            <p className="text-xs uppercase text-slate-400">Contract</p>
            <p className="text-lg font-semibold text-slate-900">{contractPrice}</p>
            <p className="text-xs text-slate-400">Referral Fee Due: {referralFeeDue}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <StatusChanger
          referralId={referral._id}
          status={referral.status as ReferralStatus}
          statuses={REFERRAL_STATUSES}
          contractDetails={{
            propertyAddress: referral.propertyAddress,
            contractPriceCents: referral.estPurchasePriceCents,
            agentCommissionBasisPoints: referral.commissionBasisPoints,
            referralFeeBasisPoints: referral.referralFeeBasisPoints,
            referralFeeDueCents: referral.referralFeeDueCents
          }}
        />
        <SLAWidget referral={referral} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ContactDetails
          label="Agent"
          contact={{
            name: referral.assignedAgent?.name,
            email: referral.assignedAgent?.email,
            phone: referral.assignedAgent?.phone
          }}
        />
        <ContactDetails
          label="Mortgage Consultant"
          contact={{
            name: referral.lender?.name,
            email: referral.lender?.email,
            phone: referral.lender?.phone
          }}
        />
      </div>

      <div className="mt-4 rounded border border-slate-200 px-4 py-3 text-sm text-slate-600">
        <div className="flex flex-wrap gap-4">
          <span>
            Agent Commission: <strong>{commissionPercent}</strong>
          </span>
          <span>
            Referral Fee %: <strong>{referralFeePercent}</strong>
          </span>
          <span>
            Referral Fee Due: <strong>{referralFeeDue}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
