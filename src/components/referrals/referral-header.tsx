'use client';

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInDays } from 'date-fns';
import { toast } from 'sonner';

import { ReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import { ContactAssignment, type Contact } from '@/components/referrals/contact-assignment';
import { EmailActivityLink } from '@/components/common/email-activity-link';

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;
type AhaBucketValue = '' | 'AHA' | 'AHA_OOS';

const formatFullAddress = (
  street?: string,
  city?: string,
  state?: string,
  postal?: string
) => {
  const trimmedStreet = street?.trim();
  const trimmedCity = city?.trim();
  const trimmedState = state?.trim();
  const trimmedPostal = postal?.trim();

  const localityParts: string[] = [];
  if (trimmedCity) {
    localityParts.push(trimmedCity);
  }
  const statePostal = [trimmedState, trimmedPostal].filter((part) => part && part.length > 0).join(' ');
  if (statePostal) {
    localityParts.push(statePostal);
  }

  return [trimmedStreet, localityParts.join(', ')].filter((part) => part && part.length > 0).join(', ');
};

interface FinancialSnapshot {
  status: ReferralStatus;
  preApprovalAmountCents?: number;
  contractPriceCents?: number;
  referralFeeDueCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyPostalCode?: string;
  statusLastUpdated?: string;
  daysInStatus?: number;
  dealSide?: 'buy' | 'sell';
}

interface ContractDraftSnapshot {
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyPostalCode?: string;
  contractPriceCents?: number;
  agentCommissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  referralFeeDueCents?: number;
  dealSide?: 'buy' | 'sell';
  hasUnsavedChanges: boolean;
}

type ReferralHeaderProps = {
  referral: any;
  viewerRole: ViewerRole;
  onFinancialsChange?: (snapshot: FinancialSnapshot) => void;
  onContractDraftChange?: (draft: ContractDraftSnapshot) => void;
  onUnderContractIntentChange?: (isPreparing: boolean) => void;
  onContractHandlersReady?: (handlers: {
    onContractSaved: (details: {
      propertyAddress: string;
      propertyCity: string;
      propertyState: string;
      propertyPostalCode: string;
      contractPriceCents: number;
      agentCommissionBasisPoints: number;
      referralFeeBasisPoints: number;
      referralFeeDueCents: number;
      dealSide: 'buy' | 'sell';
    }) => void;
    onContractDraftChange: (draft: ContractDraftSnapshot) => void;
  }) => void;
  onCreateDealRequest?: () => void;
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
  onUnderContractIntentChange,
  onContractHandlersReady,
  onCreateDealRequest,
  agentContact,
  mcContact,
  onAgentContactChange,
  onMcContactChange,
}: ReferralHeaderProps) {
  const isAgentOrigin = referral.origin === 'agent';
  const [status, setStatus] = useState<ReferralStatus>(referral.status as ReferralStatus);
  const [preApprovalAmountCents, setPreApprovalAmountCents] = useState<number>(
    referral.preApprovalAmountCents ?? 0
  );
  const [contractPriceCents, setContractPriceCents] = useState<number | undefined>(
    referral.estPurchasePriceCents
  );
  const [referralFeeDueCents, setReferralFeeDueCents] = useState<number>(
    referral.referralFeeDueCents ?? 0
  );
  const [commissionBasisPoints, setCommissionBasisPoints] = useState<number | undefined>(
    referral.commissionBasisPoints
  );
  const [referralFeeBasisPoints, setReferralFeeBasisPoints] = useState<number | undefined>(
    referral.referralFeeBasisPoints
  );
  const [dealSide, setDealSide] = useState<'buy' | 'sell'>(
    referral.dealSide === 'sell' ? 'sell' : 'buy'
  );
  const [propertyAddress, setPropertyAddress] = useState<string | undefined>(referral.propertyAddress);
  const [propertyCity, setPropertyCity] = useState<string | undefined>(referral.propertyCity);
  const [propertyState, setPropertyState] = useState<string | undefined>(
    referral.propertyState ? String(referral.propertyState).toUpperCase() : undefined
  );
  const [propertyPostalCode, setPropertyPostalCode] = useState<string | undefined>(
    referral.propertyPostalCode
  );
  const [draftContract, setDraftContract] = useState<ContractDraftSnapshot>({ hasUnsavedChanges: false });
  const [daysInStatus, setDaysInStatus] = useState<number>(referral.daysInStatus ?? 0);
  const [auditEntries, setAuditEntries] = useState<any[]>(Array.isArray(referral.audit) ? referral.audit : []);
  const [ahaBucket, setAhaBucket] = useState<AhaBucketValue>((referral.ahaBucket as AhaBucketValue) ?? '');
  const [savingBucket, setSavingBucket] = useState(false);

  useEffect(() => {
    setStatus(referral.status as ReferralStatus);
  }, [referral.status]);

  useEffect(() => {
    setPreApprovalAmountCents(referral.preApprovalAmountCents ?? 0);
  }, [referral.preApprovalAmountCents]);

  useEffect(() => {
    setContractPriceCents(referral.estPurchasePriceCents);
  }, [referral.estPurchasePriceCents]);

  useEffect(() => {
    setReferralFeeDueCents(referral.referralFeeDueCents ?? 0);
  }, [referral.referralFeeDueCents]);

  useEffect(() => {
    setCommissionBasisPoints(referral.commissionBasisPoints);
  }, [referral.commissionBasisPoints]);

  useEffect(() => {
    setReferralFeeBasisPoints(referral.referralFeeBasisPoints);
  }, [referral.referralFeeBasisPoints]);

  useEffect(() => {
    setDealSide(referral.dealSide === 'sell' ? 'sell' : 'buy');
  }, [referral.dealSide]);

  useEffect(() => {
    setPropertyAddress(referral.propertyAddress);
  }, [referral.propertyAddress]);

  useEffect(() => {
    setPropertyCity(referral.propertyCity);
  }, [referral.propertyCity]);

  useEffect(() => {
    setPropertyState(referral.propertyState ? String(referral.propertyState).toUpperCase() : undefined);
  }, [referral.propertyState]);

  useEffect(() => {
    setPropertyPostalCode(referral.propertyPostalCode);
  }, [referral.propertyPostalCode]);

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
    const normalizedState = propertyState
      ? propertyState
      : referral.propertyState
      ? String(referral.propertyState).toUpperCase()
      : '';
    onFinancialsChange?.({
      status,
      preApprovalAmountCents: preApprovalAmountCents ?? 0,
      contractPriceCents,
      referralFeeDueCents: referralFeeDueCents ?? 0,
      commissionBasisPoints,
      referralFeeBasisPoints,
      propertyAddress: propertyAddress ?? referral.propertyAddress ?? undefined,
      propertyCity: propertyCity ?? referral.propertyCity ?? undefined,
      propertyState: normalizedState || undefined,
      propertyPostalCode: propertyPostalCode ?? referral.propertyPostalCode ?? undefined,
      dealSide,
    });
  }, [
    commissionBasisPoints,
    contractPriceCents,
    onFinancialsChange,
    preApprovalAmountCents,
    propertyAddress,
    propertyCity,
    propertyPostalCode,
    propertyState,
    dealSide,
    referral.propertyAddress,
    referral.propertyCity,
    referral.propertyPostalCode,
    referral.propertyState,
    referralFeeBasisPoints,
    referralFeeDueCents,
    status,
  ]);

  const allowDraftPreview = draftContract.hasUnsavedChanges && status === 'Under Contract';
  const normalizedReferralState = referral.propertyState
    ? String(referral.propertyState).toUpperCase()
    : '';
  const savedStreet = propertyAddress ?? referral.propertyAddress ?? '';
  const savedCity = propertyCity ?? referral.propertyCity ?? '';
  const savedState = propertyState ?? normalizedReferralState;
  const savedPostal = propertyPostalCode ?? referral.propertyPostalCode ?? '';
  const savedDisplayAddress = formatFullAddress(savedStreet, savedCity, savedState, savedPostal);
  const draftDisplayAddress = allowDraftPreview
    ? (() => {
        if (draftContract.propertyAddress && draftContract.propertyAddress.trim().length > 0) {
          return draftContract.propertyAddress;
        }
        const draftCity = draftContract.propertyCity ?? savedCity;
        const draftState = draftContract.propertyState ?? savedState;
        const draftPostal = draftContract.propertyPostalCode ?? savedPostal;
        return formatFullAddress(savedStreet, draftCity, draftState, draftPostal);
      })()
    : null;
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
    draftDisplayAddress && draftDisplayAddress.trim().length > 0
      ? draftDisplayAddress
      : savedDisplayAddress && savedDisplayAddress.trim().length > 0
      ? savedDisplayAddress
      : propertyAddress ?? referral.propertyAddress;

  const primaryAmountValue = preApprovalAmountCents ?? 0;
  const primaryAmountLabel = 'Pre-Approval Amount';
  const formattedPrimaryAmount = primaryAmountValue ? formatCurrency(primaryAmountValue) : '—';
  const derivedReferralFeeDueCents = (() => {
    if (
      effectiveContractPriceCents &&
      effectiveCommissionBasisPoints &&
      effectiveReferralFeeBasisPoints
    ) {
      const computed =
        (effectiveContractPriceCents * effectiveCommissionBasisPoints * effectiveReferralFeeBasisPoints) /
        100_000_000;
      if (Number.isFinite(computed) && computed > 0) {
        return Math.round(computed);
      }
    }
    if (effectiveReferralFeeDueCents != null) {
      return effectiveReferralFeeDueCents;
    }
    return null;
  })();
  const formattedReferralFeeDue =
    derivedReferralFeeDueCents != null ? formatCurrency(derivedReferralFeeDueCents) : '—';
  const commissionPercent = effectiveCommissionBasisPoints
    ? `${(effectiveCommissionBasisPoints / 100).toFixed(2)}%`
    : '—';
  const referralFeePercent = effectiveReferralFeeBasisPoints
    ? `${(effectiveReferralFeeBasisPoints / 100).toFixed(2)}%`
    : '—';
  const dealSideLabel = dealSide === 'sell' ? 'Sell-side' : 'Buy-side';
  const isAgentView = viewerRole === 'agent';
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
  const showBucketSummary = viewerRole !== 'agent';

  const locationLabel = useMemo(() => {
    const zips = Array.isArray(referral.lookingInZips)
      ? referral.lookingInZips.filter(
          (zip): zip is string => typeof zip === 'string' && zip.trim().length > 0,
        )
      : [];
    if (zips.length > 0) {
      return zips.join(', ');
    }
    return referral.lookingInZip ?? '';
  }, [referral.lookingInZip, referral.lookingInZips]);

  const propertyLabel = useMemo(() => {
    if (effectivePropertyAddress && effectivePropertyAddress.trim().length > 0) {
      return effectivePropertyAddress;
    }
    const savedFallback =
      savedDisplayAddress && savedDisplayAddress.trim().length > 0 ? savedDisplayAddress : savedStreet;
    if (savedFallback && savedFallback.trim().length > 0) {
      return savedFallback;
    }
    return locationLabel ? `Looking in ${locationLabel}` : 'Pending location';
  }, [effectivePropertyAddress, locationLabel, savedDisplayAddress, savedStreet]);

  const borrowerName = referral.borrower?.name ?? 'Borrower';
  const borrowerEmail = referral.borrower?.email?.trim() ?? '';
  const borrowerPhone = referral.borrower?.phone?.trim() ?? '';
  const hasBorrowerContact = Boolean(borrowerEmail || borrowerPhone);

  const handleContractDraftChangeInternal = useCallback(
    (draft: ContractDraftSnapshot) => {
      setDraftContract((previous) => {
        if (
          previous.hasUnsavedChanges === draft.hasUnsavedChanges &&
          previous.propertyAddress === draft.propertyAddress &&
          previous.propertyCity === draft.propertyCity &&
          previous.propertyState === draft.propertyState &&
          previous.propertyPostalCode === draft.propertyPostalCode &&
          previous.contractPriceCents === draft.contractPriceCents &&
          previous.agentCommissionBasisPoints === draft.agentCommissionBasisPoints &&
          previous.referralFeeBasisPoints === draft.referralFeeBasisPoints &&
          previous.referralFeeDueCents === draft.referralFeeDueCents &&
          previous.dealSide === draft.dealSide
        ) {
          return previous;
        }
        return draft;
      });
      onContractDraftChange?.(draft);
    },
    [onContractDraftChange]
  );

  const handleContractSaved = useCallback(
    (details: {
      propertyAddress: string;
      propertyCity: string;
      propertyState: string;
      propertyPostalCode: string;
      contractPriceCents: number;
      agentCommissionBasisPoints: number;
      referralFeeBasisPoints: number;
      referralFeeDueCents: number;
      dealSide: 'buy' | 'sell';
    }) => {
      setPropertyAddress(details.propertyAddress);
      setPropertyCity(details.propertyCity || undefined);
      setPropertyState(details.propertyState ? details.propertyState.toUpperCase() : undefined);
      setPropertyPostalCode(details.propertyPostalCode || undefined);
      setContractPriceCents(details.contractPriceCents);
      setCommissionBasisPoints(details.agentCommissionBasisPoints);
      setReferralFeeBasisPoints(details.referralFeeBasisPoints);
      setReferralFeeDueCents(details.referralFeeDueCents ?? 0);
      setDealSide(details.dealSide);
      setDraftContract({ hasUnsavedChanges: false });
      onFinancialsChange?.({
        status: 'Under Contract',
        preApprovalAmountCents: preApprovalAmountCents ?? 0,
        contractPriceCents: details.contractPriceCents,
        referralFeeDueCents: details.referralFeeDueCents,
        commissionBasisPoints: details.agentCommissionBasisPoints,
        referralFeeBasisPoints: details.referralFeeBasisPoints,
        propertyAddress: details.propertyAddress,
        propertyCity: details.propertyCity,
        propertyState: details.propertyState,
        propertyPostalCode: details.propertyPostalCode,
        dealSide: details.dealSide,
      });
    },
    [
      onFinancialsChange,
      preApprovalAmountCents,
    ]
  );

  useEffect(() => {
    onContractHandlersReady?.({
      onContractSaved: handleContractSaved,
      onContractDraftChange: handleContractDraftChangeInternal,
    });
  }, [handleContractDraftChangeInternal, handleContractSaved, onContractHandlersReady]);

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
    let nextPropertyStreet = propertyAddress ?? referral.propertyAddress ?? '';
    let nextPropertyCity = propertyCity ?? referral.propertyCity ?? '';
    let nextPropertyState = propertyState ?? normalizedReferralState;
    let nextPropertyPostal = propertyPostalCode ?? referral.propertyPostalCode ?? '';

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
        propertyCity?: string;
        propertyState?: string;
        propertyPostalCode?: string;
        contractPriceCents?: number;
        agentCommissionBasisPoints?: number;
        referralFeeBasisPoints?: number;
        referralFeeDueCents?: number;
      };
      if (details.propertyAddress) {
        setPropertyAddress(details.propertyAddress);
        nextPropertyStreet = details.propertyAddress;
      }
      if (typeof details.propertyCity === 'string') {
        setPropertyCity(details.propertyCity || undefined);
        nextPropertyCity = details.propertyCity ?? '';
      }
      if (typeof details.propertyState === 'string') {
        const normalizedState = details.propertyState ? details.propertyState.toUpperCase() : '';
        setPropertyState(normalizedState || undefined);
        nextPropertyState = normalizedState;
      }
      if (typeof details.propertyPostalCode === 'string') {
        setPropertyPostalCode(details.propertyPostalCode || undefined);
        nextPropertyPostal = details.propertyPostalCode ?? '';
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
        const detailsReferralFee = details.referralFeeDueCents ?? 0;
        setReferralFeeDueCents(detailsReferralFee);
        nextReferralFeeDue = detailsReferralFee;
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
      propertyAddress: nextPropertyStreet,
      propertyCity: nextPropertyCity || undefined,
      propertyState: nextPropertyState || undefined,
      propertyPostalCode: nextPropertyPostal || undefined,
      statusLastUpdated: statusUpdatedAt.toISOString(),
      daysInStatus: computedDaysInStatus,
    });
  };

  const handlePreApprovalSaved = (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => {
    setPreApprovalAmountCents(details.preApprovalAmountCents);
    setReferralFeeDueCents(details.referralFeeDueCents ?? 0);
    onFinancialsChange?.({
      status,
      preApprovalAmountCents: details.preApprovalAmountCents,
      contractPriceCents: contractPriceCents,
      referralFeeDueCents: details.referralFeeDueCents,
      commissionBasisPoints: commissionBasisPoints,
      referralFeeBasisPoints: referralFeeBasisPoints,
      propertyAddress: propertyAddress ?? referral.propertyAddress,
      propertyCity: propertyCity ?? referral.propertyCity ?? undefined,
      propertyState:
        propertyState
          ? propertyState
          : referral.propertyState
          ? String(referral.propertyState).toUpperCase()
          : undefined,
      propertyPostalCode: propertyPostalCode ?? referral.propertyPostalCode ?? undefined,
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
            {hasBorrowerContact ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                {borrowerEmail && (
                  <EmailActivityLink
                    referralId={referral._id}
                    email={borrowerEmail}
                    recipient="Borrower"
                    recipientName={borrowerName}
                    className="text-sm"
                  >
                    {borrowerEmail}
                  </EmailActivityLink>
                )}
                {borrowerEmail && borrowerPhone && <span className="text-slate-300">•</span>}
                {borrowerPhone && (
                  <a className="text-brand hover:underline" href={`tel:${borrowerPhone}`}>
                    {borrowerPhone}
                  </a>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-600">Contact information pending</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand/70">
            <span className="rounded-full bg-brand/10 px-3 py-1 text-brand">{status}</span>
            <span className="rounded-full bg-slate-900/5 px-3 py-1 text-slate-500">{propertyLabel}</span>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-600">{daysInStatus} days in stage</span>
          </div>
        </div>
        <div
          className={`grid gap-3 ${showBucketSummary ? 'sm:grid-cols-2' : ''} ${
            isAgentView ? 'lg:justify-items-end' : ''
          }`}
        >
          <section
            className={`flex h-full flex-col justify-between rounded-lg border border-brand/20 bg-white/80 p-4 shadow-sm ${
              isAgentView ? 'self-end sm:max-w-sm lg:max-w-xs lg:ml-auto' : ''
            }`}
          >
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-brand">{primaryAmountLabel}</h2>
              <p className="text-2xl font-semibold text-slate-900">{formattedPrimaryAmount}</p>
            </div>
          </section>
          {showBucketSummary && (
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
          )}
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
            preApprovalAmountCents={preApprovalAmountCents}
            onStatusChanged={handleStatusChanged}
            onPreApprovalSaved={handlePreApprovalSaved}
            onUnderContractIntentChange={onUnderContractIntentChange}
            onCreateDealRequest={onCreateDealRequest}
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

      {!isAgentOrigin && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Financial breakdown</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Deal Side</dt>
              <dd className="text-sm font-semibold text-slate-900">{dealSideLabel}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
