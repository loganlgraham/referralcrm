'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ReferralHeader } from '@/components/referrals/referral-header';
import { ReferralNotes } from '@/components/referrals/referral-notes';
import { ReferralTimeline } from '@/components/referrals/referral-timeline';
import { DealCard } from '@/components/referrals/deal-card';
import type { ReferralStatus } from '@/constants/referrals';

interface ReferralDetailClientProps {
  referral: any;
  viewerRole: string;
  notes: any[];
  referralId: string;
}

interface FinancialState {
  status: ReferralStatus;
  preApprovalAmountCents: number;
  contractPriceCents?: number;
  referralFeeDueCents: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  propertyAddress?: string;
}

interface DraftState {
  propertyAddress?: string;
  contractPriceCents?: number;
  agentCommissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  referralFeeDueCents?: number;
  hasUnsavedChanges: boolean;
}

export function ReferralDetailClient({ referral, viewerRole, notes, referralId }: ReferralDetailClientProps) {
  const router = useRouter();
  const [financials, setFinancials] = useState<FinancialState>({
    status: referral.status,
    preApprovalAmountCents: referral.preApprovalAmountCents ?? 0,
    contractPriceCents: referral.estPurchasePriceCents ?? undefined,
    referralFeeDueCents: referral.referralFeeDueCents ?? 0,
    commissionBasisPoints: referral.commissionBasisPoints ?? undefined,
    referralFeeBasisPoints: referral.referralFeeBasisPoints ?? undefined,
    propertyAddress: referral.propertyAddress ?? undefined,
  });
  const [contractDraft, setContractDraft] = useState<DraftState>({ hasUnsavedChanges: false });
  const [deleting, setDeleting] = useState(false);

  const canDelete = viewerRole === 'admin' || viewerRole === 'manager';

  const handleDeleteReferral = async () => {
    if (deleting) {
      return;
    }

    const confirmed = window.confirm(
      'Delete this referral and all associated deals? This action cannot be undone.'
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Unable to delete referral');
      }
      toast.success('Referral deleted');
      router.push('/referrals');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to delete referral');
    } finally {
      setDeleting(false);
    }
  };

  const handleFinancialsChange = (snapshot: {
    status: ReferralStatus;
    preApprovalAmountCents?: number;
    contractPriceCents?: number;
    referralFeeDueCents?: number;
    commissionBasisPoints?: number;
    referralFeeBasisPoints?: number;
    propertyAddress?: string;
  }) => {
    setFinancials((previous) => {
      const next = {
        status: snapshot.status ?? previous.status,
        preApprovalAmountCents:
          snapshot.preApprovalAmountCents !== undefined
            ? snapshot.preApprovalAmountCents
            : previous.preApprovalAmountCents,
        contractPriceCents:
          snapshot.contractPriceCents !== undefined
            ? snapshot.contractPriceCents
            : previous.contractPriceCents,
        referralFeeDueCents:
          snapshot.referralFeeDueCents !== undefined
            ? snapshot.referralFeeDueCents
            : previous.referralFeeDueCents,
        commissionBasisPoints:
          snapshot.commissionBasisPoints !== undefined
            ? snapshot.commissionBasisPoints
            : previous.commissionBasisPoints,
        referralFeeBasisPoints:
          snapshot.referralFeeBasisPoints !== undefined
            ? snapshot.referralFeeBasisPoints
            : previous.referralFeeBasisPoints,
        propertyAddress:
          snapshot.propertyAddress !== undefined ? snapshot.propertyAddress : previous.propertyAddress,
      };

      if (
        next.status === previous.status &&
        next.preApprovalAmountCents === previous.preApprovalAmountCents &&
        next.contractPriceCents === previous.contractPriceCents &&
        next.referralFeeDueCents === previous.referralFeeDueCents &&
        next.commissionBasisPoints === previous.commissionBasisPoints &&
        next.referralFeeBasisPoints === previous.referralFeeBasisPoints &&
        next.propertyAddress === previous.propertyAddress
      ) {
        return previous;
      }

      return next;
    });
  };

  const handleDraftChange = (draft: DraftState) => {
    setContractDraft((previous) => {
      if (
        previous.hasUnsavedChanges === draft.hasUnsavedChanges &&
        previous.propertyAddress === draft.propertyAddress &&
        previous.contractPriceCents === draft.contractPriceCents &&
        previous.agentCommissionBasisPoints === draft.agentCommissionBasisPoints &&
        previous.referralFeeBasisPoints === draft.referralFeeBasisPoints &&
        previous.referralFeeDueCents === draft.referralFeeDueCents
      ) {
        return previous;
      }
      return draft;
    });
  };

  const headerReferral = {
    ...referral,
    status: financials.status,
    preApprovalAmountCents: financials.preApprovalAmountCents,
    estPurchasePriceCents: financials.contractPriceCents,
    referralFeeDueCents: financials.referralFeeDueCents,
    commissionBasisPoints: financials.commissionBasisPoints,
    referralFeeBasisPoints: financials.referralFeeBasisPoints,
    propertyAddress: financials.propertyAddress ?? referral.propertyAddress,
  };

  const dealReferral = {
    ...referral,
    referralFeeDueCents: financials.referralFeeDueCents,
    propertyAddress: financials.propertyAddress ?? referral.propertyAddress,
  };

  const dealOverrides: {
    referralFeeDueCents?: number;
    propertyAddress?: string;
    hasUnsavedContractChanges: boolean;
  } = contractDraft.hasUnsavedChanges
    ? {
        referralFeeDueCents:
          contractDraft.referralFeeDueCents !== undefined
            ? contractDraft.referralFeeDueCents
            : financials.referralFeeDueCents,
        propertyAddress:
          contractDraft.propertyAddress ?? financials.propertyAddress ?? referral.propertyAddress,
        hasUnsavedContractChanges: true,
      }
    : {
        hasUnsavedContractChanges: false,
      };

  const hasTerminatedDeal = (referral.payments ?? []).some((payment: any) => payment.status === 'terminated');
  const hasAnyDeals = Array.isArray(referral.payments) && referral.payments.length > 0;

  const showDeals =
    financials.status === 'Under Contract' || contractDraft.hasUnsavedChanges || hasTerminatedDeal || hasAnyDeals;

  return (
    <div className="space-y-8">
      <ReferralHeader
        referral={headerReferral}
        viewerRole={viewerRole}
        onFinancialsChange={handleFinancialsChange}
        onContractDraftChange={handleDraftChange}
      />
      <ReferralNotes
        referralId={referralId}
        initialNotes={notes}
        viewerRole={viewerRole}
        agentContact={{
          name: referral.assignedAgent?.name ?? null,
          email: referral.assignedAgent?.email ?? null
        }}
        mcContact={{
          name: referral.lender?.name ?? null,
          email: referral.lender?.email ?? null
        }}
      />
      {showDeals && <DealCard referral={dealReferral} overrides={dealOverrides} />}
      <ReferralTimeline referralId={referralId} />
      {canDelete && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleDeleteReferral}
            disabled={deleting}
            className="rounded-lg border border-rose-200 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {deleting ? 'Deleting…' : 'Delete referral'}
          </button>
        </div>
      )}
    </div>
  );
}
