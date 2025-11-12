'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { differenceInDays } from 'date-fns';
import { toast } from 'sonner';

import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import { ContactAssignment, type Contact } from '@/components/referrals/contact-assignment';

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;
type AhaBucketValue = '' | 'AHA' | 'AHA_OOS';

interface FinancialSnapshot {
  status: ReferralStatus;
  preApprovalAmountCents?: number;
  contractPriceCents?: number;
  referralFeeDueCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  propertyAddress?: string;
  statusLastUpdated?: string;
  daysInStatus?: number;
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
  agentContact?: Contact | null;
  mcContact?: Contact | null;
  onAgentContactChange?: (contact: Contact | null) => void;
  onMcContactChange?: (contact: Contact | null) => void;
};

export function ReferralHeader({
  referral,
  viewerRole,
  onFinancialsChange,
  onContractDraftChange,
  agentContact,
  mcContact,
  onAgentContactChange,
  onMcContactChange,
}: ReferralHeaderProps) {
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
  const [daysInStatus, setDaysInStatus] = useState<number>(referral.daysInStatus ?? 0);
  const [auditEntries, setAuditEntries] = useState<any[]>(Array.isArray(referral.audit) ? referral.audit : []);
  const [ahaBucket, setAhaBucket] = useState<AhaBucketValue>((referral.ahaBucket as AhaBucketValue) ?? '');
  const [savingBucket, setSavingBucket] = useState(false);

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
    setDaysInStatus(referral.daysInStatus ?? 0);
  }, [referral.daysInStatus]);

  useEffect(() => {
    if (Array.isArray(referral.audit)) {
      setAuditEntries(referral.audit);
    }
  }, [referral.audit]);

  useEffect(() => {
    setAhaBucket((referral.ahaBucket as AhaBucketValue) ?? '');
  }, [referral.ahaBucket]);

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
  const fallbackAgentContact: Contact | null = referral.assignedAgent
    ? {
        id: referral.assignedAgent._id ?? referral.assignedAgent.id ?? null,
        name: referral.assignedAgent.name ?? null,
        email: referral.assignedAgent.email ?? null,
        phone: referral.assignedAgent.phone ?? null,
      }
    : null;
  const fallbackMcContact: Contact | null = referral.lender
    ? {
        id: referral.lender._id ?? referral.lender.id ?? null,
        name: referral.lender.name ?? null,
        email: referral.lender.email ?? null,
        phone: referral.lender.phone ?? null,
      }
    : null;
  const effectiveAgentContact = agentContact ?? fallbackAgentContact;
  const effectiveMcContact = mcContact ?? fallbackMcContact;
  const canEditBucket = viewerRole === 'admin' || viewerRole === 'manager';

  const propertyLabel = useMemo(() => {
    if (effectivePropertyAddress && effectivePropertyAddress.trim().length > 0) {
      return effectivePropertyAddress;
    }
    if (referral.propertyAddress) {
      return referral.propertyAddress;
    }
    return referral.lookingInZip ? `Looking in ${referral.lookingInZip}` : 'Pending location';
  }, [effectivePropertyAddress, referral.lookingInZip, referral.propertyAddress]);

  const borrowerName = referral.borrower?.name ?? 'Borrower';
  const borrowerContact = [referral.borrower?.email, referral.borrower?.phone]
    .filter((value) => Boolean(value))
    .join(' • ');

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
    const previousStatusValue =
      typeof payload?.previousStatus === 'string'
        ? (payload.previousStatus as ReferralStatus)
        : status;
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

    if (payload?.contractPriceCents !== undefined) {
      const updatedContractPrice = Number(payload.contractPriceCents) || 0;
      setContractPriceCents(updatedContractPrice);
      nextContractPrice = updatedContractPrice;
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

    const statusUpdatedAtRaw = payload?.statusLastUpdated;
    const statusUpdatedAt =
      typeof statusUpdatedAtRaw === 'string'
        ? new Date(statusUpdatedAtRaw)
        : statusUpdatedAtRaw instanceof Date
        ? statusUpdatedAtRaw
        : new Date();

    const computedDaysInStatus =
      typeof payload?.daysInStatus === 'number' && !Number.isNaN(Number(payload.daysInStatus))
        ? Number(payload.daysInStatus)
        : differenceInDays(new Date(), statusUpdatedAt);

    if (nextStatus !== previousStatusValue) {
      setDaysInStatus(computedDaysInStatus);
      setAuditEntries((previous) => [
        ...(Array.isArray(previous) ? previous : []),
        {
          field: 'status',
          newValue: nextStatus,
          timestamp: statusUpdatedAt.toISOString(),
        },
      ]);
    } else {
      setDaysInStatus(computedDaysInStatus);
    }

    onFinancialsChange?.({
      status: nextStatus,
      preApprovalAmountCents: nextPreApproval,
      contractPriceCents: nextContractPrice,
      referralFeeDueCents: nextReferralFeeDue,
      commissionBasisPoints: nextCommission,
      referralFeeBasisPoints: nextReferralFeeBasis,
      propertyAddress: nextProperty,
      statusLastUpdated: statusUpdatedAt.toISOString(),
      daysInStatus: computedDaysInStatus,
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

  const handleBucketChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value as AhaBucketValue;
    if (nextValue === ahaBucket) {
      return;
    }

    setSavingBucket(true);
    setAhaBucket(nextValue);

    try {
      const response = await fetch(`/api/referrals/${referral._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ahaBucket: nextValue || null }),
      });

      if (!response.ok) {
        throw new Error('Unable to update agent bucket');
      }

      toast.success('Agent bucket updated');
    } catch (error) {
      console.error(error);
      setAhaBucket((referral.ahaBucket as AhaBucketValue) ?? '');
      toast.error(error instanceof Error ? error.message : 'Unable to update agent bucket');
    } finally {
      setSavingBucket(false);
    }
  };

  const bucketLabel = (() => {
    if (ahaBucket === 'AHA') return 'AHA';
    if (ahaBucket === 'AHA_OOS') return 'AHA OOS';
    return 'Not set';
  })();

  const bucketDescription = canEditBucket
    ? 'Label whether this referral belongs to the AHA or AHA OOS agent bucket.'
    : 'Agent bucket indicates where this referral sits for reporting.';

  return (
    <div className="space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="grid gap-4 rounded-xl bg-gradient-to-r from-brand/5 via-white to-slate-50 p-5 lg:grid-cols-[minmax(0,1.1fr),minmax(0,1fr)] lg:items-center">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">Borrower</p>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 lg:text-3xl">{borrowerName}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {borrowerContact || 'Contact information pending'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand/70">
            <span className="rounded-full bg-brand/10 px-3 py-1 text-brand">{status}</span>
            <span className="rounded-full bg-slate-900/5 px-3 py-1 text-slate-500">{propertyLabel}</span>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-600">{daysInStatus} days in stage</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="flex h-full flex-col justify-between rounded-lg border border-brand/20 bg-white/80 p-4 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-brand">{primaryAmountLabel}</h2>
              <p className="text-2xl font-semibold text-slate-900">{formattedPrimaryAmount}</p>
            </div>
            <p className="text-xs font-medium text-slate-500">Referral Fee Due {formattedReferralFeeDue}</p>
          </section>
          <section className="flex h-full flex-col justify-between rounded-lg border border-slate-200 bg-slate-900/5 p-4">
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Agent bucket</h2>
              <p className="text-xs text-slate-500">{bucketDescription}</p>
            </div>
            {canEditBucket ? (
              <select
                value={ahaBucket}
                onChange={handleBucketChange}
                disabled={savingBucket}
                className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
              >
                <option value="">Not set</option>
                <option value="AHA">AHA</option>
                <option value="AHA_OOS">AHA OOS</option>
              </select>
            ) : (
              <p className="mt-3 text-lg font-semibold text-slate-900">{bucketLabel}</p>
            )}
          </section>
        </div>
      </div>
      <SLAWidget referral={{ ...referral, status, audit: auditEntries }} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),minmax(280px,1fr)]">
        <section className="space-y-4 rounded-xl border border-brand/20 bg-white px-5 py-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Status &amp; progress</h2>
            <p className="text-xs text-slate-500">Update borrower stage and contract information.</p>
          </div>
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
        </section>
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Team assignments</h2>
            <p className="text-xs text-slate-500">Keep the right partners aligned on this referral.</p>
          </div>
          <ContactAssignment
            referralId={referral._id}
            type="agent"
            contact={effectiveAgentContact}
            canAssign={canAssignAgent}
            onContactChange={onAgentContactChange}
          />
          <ContactAssignment
            referralId={referral._id}
            type="mc"
            contact={effectiveMcContact}
            canAssign={canAssignMc}
            onContactChange={onMcContactChange}
          />
        </section>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Financial breakdown</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <dt className="text-xs uppercase text-slate-500">Agent Commission</dt>
            <dd className="text-sm font-semibold text-slate-900">{commissionPercent}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs uppercase text-slate-500">Referral Fee %</dt>
            <dd className="text-sm font-semibold text-slate-900">{referralFeePercent}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs uppercase text-slate-500">Referral Fee Due</dt>
            <dd className="text-sm font-semibold text-slate-900">{formattedReferralFeeDue}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
