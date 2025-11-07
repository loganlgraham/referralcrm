'use client';

import { useEffect, useMemo, useState } from 'react';

import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import { ContactAssignment } from '@/components/referrals/contact-assignment';

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

interface FinancialSnapshot {
  status: ReferralStatus;
  preApprovalAmountCents?: number;
  contractPriceCents?: number;
  referralFeeDueCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  propertyAddress?: string;
}

interface ContractDraftSnapshot {
  propertyAddress?: string;
  contractPriceCents?: number;
  agentCommissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  referralFeeDueCents?: number;
  hasUnsavedChanges: boolean;
}

type ReferralHeaderProps = {
  referral: any;
  viewerRole: ViewerRole;
  onFinancialsChange?: (snapshot: FinancialSnapshot) => void;
  onContractDraftChange?: (draft: ContractDraftSnapshot) => void;
};

export function ReferralHeader({ referral, viewerRole, onFinancialsChange, onContractDraftChange }: ReferralHeaderProps) {
  const [status, setStatus] = useState<ReferralStatus>(referral.status as ReferralStatus);
  const [preApprovalAmountCents, setPreApprovalAmountCents] = useState<number | undefined>(
    referral.preApprovalAmountCents
  );
  const [contractPriceCents, setContractPriceCents] = useState<number | undefined>(
    referral.estPurchasePriceCents
  );
  const [referralFeeDueCents, setReferralFeeDueCents] = useState<number | undefined>(
    referral.referralFeeDueCents
  );
  const [commissionBasisPoints, setCommissionBasisPoints] = useState<number | undefined>(
    referral.commissionBasisPoints
  );
  const [referralFeeBasisPoints, setReferralFeeBasisPoints] = useState<number | undefined>(
    referral.referralFeeBasisPoints
  );
  const [propertyAddress, setPropertyAddress] = useState<string | undefined>(referral.propertyAddress);
  const [draftContract, setDraftContract] = useState<ContractDraftSnapshot>({ hasUnsavedChanges: false });

  useEffect(() => {
    setStatus(referral.status as ReferralStatus);
  }, [referral.status]);

  useEffect(() => {
    setPreApprovalAmountCents(referral.preApprovalAmountCents);
  }, [referral.preApprovalAmountCents]);

  useEffect(() => {
    setContractPriceCents(referral.estPurchasePriceCents);
  }, [referral.estPurchasePriceCents]);

  useEffect(() => {
    setReferralFeeDueCents(referral.referralFeeDueCents);
  }, [referral.referralFeeDueCents]);

  useEffect(() => {
    setCommissionBasisPoints(referral.commissionBasisPoints);
  }, [referral.commissionBasisPoints]);

  useEffect(() => {
    setReferralFeeBasisPoints(referral.referralFeeBasisPoints);
  }, [referral.referralFeeBasisPoints]);

  useEffect(() => {
    setPropertyAddress(referral.propertyAddress);
  }, [referral.propertyAddress]);

  useEffect(() => {
    onFinancialsChange?.({
      status,
      preApprovalAmountCents: preApprovalAmountCents ?? 0,
      contractPriceCents,
      referralFeeDueCents: referralFeeDueCents ?? 0,
      commissionBasisPoints,
      referralFeeBasisPoints,
      propertyAddress: (propertyAddress ?? referral.propertyAddress) as string | undefined,
    });
  }, [
    commissionBasisPoints,
    contractPriceCents,
    onFinancialsChange,
    preApprovalAmountCents,
    propertyAddress,
    referral.propertyAddress,
    referralFeeBasisPoints,
    referralFeeDueCents,
    status,
  ]);

  const allowDraftPreview = draftContract.hasUnsavedChanges && status === 'Under Contract';
  const effectiveContractPriceCents = allowDraftPreview && draftContract.contractPriceCents !== undefined
    ? draftContract.contractPriceCents
    : contractPriceCents;
  const effectiveReferralFeeDueCents = allowDraftPreview && draftContract.referralFeeDueCents !== undefined
    ? draftContract.referralFeeDueCents
    : referralFeeDueCents;
  const effectiveCommissionBasisPoints =
    allowDraftPreview && draftContract.agentCommissionBasisPoints !== undefined
      ? draftContract.agentCommissionBasisPoints
      : commissionBasisPoints;
  const effectiveReferralFeeBasisPoints =
    allowDraftPreview && draftContract.referralFeeBasisPoints !== undefined
      ? draftContract.referralFeeBasisPoints
      : referralFeeBasisPoints;
  const effectivePropertyAddress =
    allowDraftPreview && draftContract.propertyAddress
      ? draftContract.propertyAddress
      : propertyAddress ?? referral.propertyAddress;

  const isUnderContract = status === 'Under Contract' || status === 'Closed';
  const primaryAmountValue = isUnderContract ? effectiveContractPriceCents : preApprovalAmountCents;
  const primaryAmountLabel = isUnderContract ? 'Contract Price' : 'Pre-Approval Amount';
  const formattedPrimaryAmount = primaryAmountValue ? formatCurrency(primaryAmountValue) : '—';
  const formattedReferralFeeDue = effectiveReferralFeeDueCents ? formatCurrency(effectiveReferralFeeDueCents) : '—';
  const commissionPercent = effectiveCommissionBasisPoints
    ? `${(effectiveCommissionBasisPoints / 100).toFixed(2)}%`
    : '—';
  const referralFeePercent = effectiveReferralFeeBasisPoints
    ? `${(effectiveReferralFeeBasisPoints / 100).toFixed(2)}%`
    : '—';
  const canAssignAgent = viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'mc';
  const canAssignMc = viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'agent';

  const propertyLabel = useMemo(() => {
    if (effectivePropertyAddress && effectivePropertyAddress.trim().length > 0) {
      return effectivePropertyAddress;
    }
    if (referral.propertyAddress) {
      return referral.propertyAddress;
    }
    return `Zip ${referral.propertyZip}`;
  }, [effectivePropertyAddress, referral.propertyAddress, referral.propertyZip]);

  const handleContractDraftChangeInternal = (draft: ContractDraftSnapshot) => {
    setDraftContract((previous) => {
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
    onContractDraftChange?.(draft);
  };

  const handleContractSaved = (details: {
    propertyAddress: string;
    contractPriceCents: number;
    agentCommissionBasisPoints: number;
    referralFeeBasisPoints: number;
    referralFeeDueCents: number;
  }) => {
    setPropertyAddress(details.propertyAddress);
    setContractPriceCents(details.contractPriceCents);
    setCommissionBasisPoints(details.agentCommissionBasisPoints);
    setReferralFeeBasisPoints(details.referralFeeBasisPoints);
    setReferralFeeDueCents(details.referralFeeDueCents);
    setStatus('Under Contract');
    setDraftContract({ hasUnsavedChanges: false });
    onFinancialsChange?.({
      status: 'Under Contract',
      preApprovalAmountCents: preApprovalAmountCents ?? 0,
      contractPriceCents: details.contractPriceCents,
      referralFeeDueCents: details.referralFeeDueCents,
      commissionBasisPoints: details.agentCommissionBasisPoints,
      referralFeeBasisPoints: details.referralFeeBasisPoints,
      propertyAddress: details.propertyAddress,
    });
  };

  const handleStatusChanged = (nextStatus: ReferralStatus, payload?: Record<string, unknown>) => {
    setStatus(nextStatus);
    let nextPreApproval = preApprovalAmountCents ?? 0;
    let nextContractPrice = contractPriceCents;
    let nextReferralFeeDue = referralFeeDueCents ?? 0;
    let nextCommission = commissionBasisPoints;
    let nextReferralFeeBasis = referralFeeBasisPoints;
    let nextProperty = propertyAddress ?? referral.propertyAddress;

    if (payload?.preApprovalAmountCents !== undefined) {
      nextPreApproval = Number(payload.preApprovalAmountCents) || 0;
      setPreApprovalAmountCents(nextPreApproval);
    }
    if (payload?.referralFeeDueCents !== undefined) {
      nextReferralFeeDue = Number(payload.referralFeeDueCents) || 0;
      setReferralFeeDueCents(nextReferralFeeDue);
    }

    if (nextStatus === 'Under Contract' && payload?.contractDetails) {
      const details = payload.contractDetails as {
        propertyAddress?: string;
        contractPriceCents?: number;
        agentCommissionBasisPoints?: number;
        referralFeeBasisPoints?: number;
        referralFeeDueCents?: number;
      };
      if (details.propertyAddress) {
        setPropertyAddress(details.propertyAddress);
        nextProperty = details.propertyAddress;
      }
      if (typeof details.contractPriceCents === 'number') {
        setContractPriceCents(details.contractPriceCents);
        nextContractPrice = details.contractPriceCents;
      }
      if (typeof details.agentCommissionBasisPoints === 'number') {
        setCommissionBasisPoints(details.agentCommissionBasisPoints);
        nextCommission = details.agentCommissionBasisPoints;
      }
      if (typeof details.referralFeeBasisPoints === 'number') {
        setReferralFeeBasisPoints(details.referralFeeBasisPoints);
        nextReferralFeeBasis = details.referralFeeBasisPoints;
      }
      if (typeof details.referralFeeDueCents === 'number') {
        setReferralFeeDueCents(details.referralFeeDueCents);
        nextReferralFeeDue = details.referralFeeDueCents;
      }
      setDraftContract({ hasUnsavedChanges: false });
    } else {
      setDraftContract({ hasUnsavedChanges: false });
    }

    onFinancialsChange?.({
      status: nextStatus,
      preApprovalAmountCents: nextPreApproval,
      contractPriceCents: nextContractPrice,
      referralFeeDueCents: nextReferralFeeDue,
      commissionBasisPoints: nextCommission,
      referralFeeBasisPoints: nextReferralFeeBasis,
      propertyAddress: nextProperty,
    });
  };

  const handlePreApprovalSaved = (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => {
    setPreApprovalAmountCents(details.preApprovalAmountCents);
    setReferralFeeDueCents(details.referralFeeDueCents);
    onFinancialsChange?.({
      status,
      preApprovalAmountCents: details.preApprovalAmountCents,
      contractPriceCents: contractPriceCents,
      referralFeeDueCents: details.referralFeeDueCents,
      commissionBasisPoints: commissionBasisPoints,
      referralFeeBasisPoints: referralFeeBasisPoints,
      propertyAddress: propertyAddress ?? referral.propertyAddress,
    });
  };

  return (
    <div className="space-y-6 rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{referral.borrower.name}</h1>
          <p className="text-sm text-slate-500">
            {referral.borrower.email} • {referral.borrower.phone}
          </p>
          <p className="text-xs uppercase tracking-wide text-slate-400">{propertyLabel}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 px-4 py-3 text-right">
            <p className="text-xs uppercase text-slate-400">Status</p>
            <p className="text-lg font-semibold text-brand">{status}</p>
            <p className="text-xs text-slate-400">Days in status: {referral.daysInStatus ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 px-4 py-3 text-right">
            <p className="text-xs uppercase text-slate-400">{primaryAmountLabel}</p>
            <p className="text-lg font-semibold text-slate-900">{formattedPrimaryAmount}</p>
            <p className="text-xs text-slate-400">Referral Fee Due: {formattedReferralFeeDue}</p>
          </div>
        </div>
      </div>

      <SLAWidget referral={{ ...referral, status }} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),minmax(280px,1fr)]">
        <StatusChanger
          referralId={referral._id}
          status={status}
          statuses={REFERRAL_STATUSES}
          contractDetails={{
            propertyAddress: propertyAddress ?? referral.propertyAddress,
            contractPriceCents: contractPriceCents,
            agentCommissionBasisPoints: commissionBasisPoints,
            referralFeeBasisPoints: referralFeeBasisPoints,
          }}
          preApprovalAmountCents={preApprovalAmountCents}
          referralFeeDueCents={referralFeeDueCents}
          onStatusChanged={handleStatusChanged}
          onContractSaved={handleContractSaved}
          onPreApprovalSaved={handlePreApprovalSaved}
          onContractDraftChange={handleContractDraftChangeInternal}
        />
        <div className="space-y-4">
          <ContactAssignment
            referralId={referral._id}
            type="agent"
            contact={{
              id: referral.assignedAgent?._id,
              name: referral.assignedAgent?.name,
              email: referral.assignedAgent?.email,
              phone: referral.assignedAgent?.phone,
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
              phone: referral.lender?.phone,
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
            Referral Fee Due: <strong>{formattedReferralFeeDue}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
