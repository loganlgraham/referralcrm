import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import { ContactAssignment } from '@/components/referrals/contact-assignment';

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

export function ReferralHeader({ referral, viewerRole }: { referral: any; viewerRole: ViewerRole }) {
  const isUnderContract = referral.status === 'Under Contract' || referral.status === 'Closed';
  const primaryAmountLabel = isUnderContract ? 'Contract Price' : 'Pre-Approval Amount';
  const primaryAmountValue = isUnderContract
    ? referral.estPurchasePriceCents
    : referral.preApprovalAmountCents;
  const formattedPrimaryAmount = primaryAmountValue ? formatCurrency(primaryAmountValue) : '—';
  const referralFeeDue = referral.referralFeeDueCents ? formatCurrency(referral.referralFeeDueCents) : '—';
  const commissionPercent = referral.commissionBasisPoints
    ? `${(referral.commissionBasisPoints / 100).toFixed(2)}%`
    : '—';
  const referralFeePercent = referral.referralFeeBasisPoints
    ? `${(referral.referralFeeBasisPoints / 100).toFixed(2)}%`
    : '—';
  const canAssignAgent = viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'mc';
  const canAssignMc = viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'agent';

  return (
    <div className="space-y-6 rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
            <p className="text-xs uppercase text-slate-400">{primaryAmountLabel}</p>
            <p className="text-lg font-semibold text-slate-900">{formattedPrimaryAmount}</p>
            <p className="text-xs text-slate-400">Referral Fee Due: {referralFeeDue}</p>
          </div>
        </div>
      </div>

      <SLAWidget referral={referral} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),minmax(280px,1fr)]">
        <StatusChanger
          referralId={referral._id}
          status={referral.status as ReferralStatus}
          statuses={REFERRAL_STATUSES}
          contractDetails={{
            propertyAddress: referral.propertyAddress,
            contractPriceCents: referral.estPurchasePriceCents,
            agentCommissionBasisPoints: referral.commissionBasisPoints,
            referralFeeBasisPoints: referral.referralFeeBasisPoints
          }}
        />
        <div className="space-y-4">
          <ContactAssignment
            referralId={referral._id}
            type="agent"
            contact={{
              id: referral.assignedAgent?._id,
              name: referral.assignedAgent?.name,
              email: referral.assignedAgent?.email,
              phone: referral.assignedAgent?.phone
            }}
            canAssign={canAssignAgent}
          />
          <ContactAssignment
            referralId={referral._id}
            type="mc"
            contact={{
              id: referral.lender?._id,
              name: referral.lender?.name,
              email: referral.lender?.email,
              phone: referral.lender?.phone
            }}
            canAssign={canAssignMc}
          />
        </div>
      </div>

      <div className="rounded border border-slate-200 px-4 py-3 text-sm text-slate-600">
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
