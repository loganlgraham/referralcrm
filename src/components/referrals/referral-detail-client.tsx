'use client';

import { useState } from 'react';

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
    </div>
  );
}
