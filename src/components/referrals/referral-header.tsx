'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { differenceInDays } from 'date-fns';
import { toast } from 'sonner';

import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import { ContactAssignment } from '@/components/referrals/contact-assignment';

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
  const router = useRouter();
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
  const [deleting, setDeleting] = useState(false);
  const [ahaBucket, setAhaBucket] = useState<AhaBucketValue>((referral.ahaBucket as AhaBucketValue) ?? '');
  const [savingBucket, setSavingBucket] = useState(false);
  const canDelete = viewerRole === 'admin' || viewerRole === 'manager';

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
  const canEditBucket = viewerRole === 'admin' || viewerRole === 'manager';

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
      const response = await fetch(`/api/referrals/${referral._id}`, { method: 'DELETE' });
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
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 px-4 py-3 text-right">
              <p className="text-xs uppercase text-slate-400">Status</p>
              <p className="text-lg font-semibold text-brand">{status}</p>
              <p className="text-xs text-slate-400">Days in status: {daysInStatus}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3 text-right">
              <p className="text-xs uppercase text-slate-400">{primaryAmountLabel}</p>
              <p className="text-lg font-semibold text-slate-900">{formattedPrimaryAmount}</p>
              <p className="text-xs text-slate-400">Referral Fee Due: {formattedReferralFeeDue}</p>
            </div>
          </div>
          <div className="w-full rounded-lg border border-slate-200 px-4 py-3 text-right">
            <p className="text-xs uppercase text-slate-400">Agent Bucket</p>
            {canEditBucket ? (
              <select
                value={ahaBucket}
                onChange={handleBucketChange}
                disabled={savingBucket}
                className="mt-2 w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none"
              >
                <option value="">Not set</option>
                <option value="AHA">AHA</option>
                <option value="AHA_OOS">AHA OOS</option>
              </select>
            ) : (
              <p className="mt-2 text-lg font-semibold text-slate-900">{bucketLabel}</p>
            )}
            {canEditBucket ? (
              <p className="mt-2 text-xs text-slate-400">Label whether this referral belongs to the AHA or AHA OOS agent bucket.</p>
            ) : null}
          </div>
          {canDelete && (
            <button
              type="button"
              onClick={handleDeleteReferral}
              disabled={deleting}
              className="self-start rounded border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 sm:self-end"
            >
              {deleting ? 'Deleting…' : 'Delete referral'}
            </button>
          )}
        </div>
      </div>

      <SLAWidget referral={{ ...referral, status, audit: auditEntries }} />

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
