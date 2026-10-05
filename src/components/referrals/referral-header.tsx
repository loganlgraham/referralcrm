'use client';

import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useSWRConfig } from 'swr';
import { differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import { formatDateMST } from '@/utils/formatters';
import { Badge } from '@/components/ui/badge';
import { selectFieldClasses } from '@/components/ui/field-group';

import {
  ReferralStatus,
  REFERRAL_STATUSES,
  getReferralStatusLabel,
  normalizeReferralStatus
} from '@/constants/referrals';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import type { Contact } from '@/components/referrals/contact-assignment';
import { AdminTasksCard } from '@/components/referrals/admin-tasks-card';
import { AdminDetailHeader } from '@/components/referrals/admin-referral-detail';
import { TeamCard } from '@/components/referrals/team-card';
import { RailCard, railCardClasses, railTitleClasses } from '@/components/referrals/referral-rail';

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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const asNullableString = (value: unknown): string | null | undefined =>
  typeof value === 'string' || value == null ? value : undefined;

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
  latestDealStatus?: ReferralStatus | null;
  latestBuyDealStatus?: ReferralStatus | null;
  latestSellDealStatus?: ReferralStatus | null;
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
  buySideAgentContact?: Contact | null;
  sellSideAgentContact?: Contact | null;
  mcContact?: Contact | null;
  onBuySideAgentContactChange?: (contact: Contact | null) => void;
  onSellSideAgentContactChange?: (contact: Contact | null) => void;
  onMcContactChange?: (contact: Contact | null) => void;
  /** Where the breadcrumb's "Referrals" link points (preserves list filters). */
  backHref?: string;
  showNav?: boolean;
  prevHref?: string | null;
  nextHref?: string | null;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
  /** Main-column content rendered under the status card (notes, deals, activity). */
  children?: ReactNode;
  /** Rail content rendered after "Who's on it" (intake details). */
  railSlot?: ReactNode;
};

export function ReferralHeader({
  referral,
  viewerRole,
  latestDealStatus = null,
  latestBuyDealStatus = null,
  latestSellDealStatus = null,
  onFinancialsChange,
  onContractDraftChange,
  onUnderContractIntentChange,
  onContractHandlersReady,
  buySideAgentContact,
  sellSideAgentContact,
  mcContact,
  onBuySideAgentContactChange,
  onSellSideAgentContactChange,
  onMcContactChange,
  backHref = '/referrals',
  showNav = false,
  prevHref = null,
  nextHref = null,
  canDelete = false,
  deleting = false,
  onDelete,
  children,
  railSlot,
}: ReferralHeaderProps) {
  const { mutate } = useSWRConfig();
  const isAgentOrigin = referral.origin === 'agent';
  const normalizedStatus = normalizeReferralStatus(referral.status) ?? 'New Lead';
  const [status, setStatus] = useState<ReferralStatus>(normalizedStatus);
  const [buyStatus, setBuyStatus] = useState<ReferralStatus>(
    normalizeReferralStatus(referral.buyStatus) ?? normalizedStatus
  );
  const [sellStatus, setSellStatus] = useState<ReferralStatus>(
    normalizeReferralStatus(referral.sellStatus) ?? normalizedStatus
  );
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
  const onFinancialsChangeRef = useRef(onFinancialsChange);
  onFinancialsChangeRef.current = onFinancialsChange;

  // Only status + side pipeline labels: layout sync so local `status` matches `referral.status` before the
  // useEffect below calls onFinancialsChange (avoids pushing stale status after parent updates from deal PATCH).
  // Do not layout-sync money/address here — that caused maximum update depth with onFinancialsChange → setFinancials.
  useLayoutEffect(() => {
    const nextStatus = normalizeReferralStatus(referral.status);
    if (nextStatus) {
      setStatus(nextStatus);
    }
  }, [referral.status]);

  useLayoutEffect(() => {
    const summaryStatus = normalizeReferralStatus(referral.status) ?? 'New Lead';
    setBuyStatus(normalizeReferralStatus(referral.buyStatus) ?? summaryStatus);
    setSellStatus(normalizeReferralStatus(referral.sellStatus) ?? summaryStatus);
  }, [referral.buyStatus, referral.sellStatus, referral.status]);

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
    onFinancialsChangeRef.current?.({
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

  const showSlaWidget = viewerRole !== 'agent' && referral.origin !== 'agent';
  const fallbackAgentContact: Contact | null = referral.assignedAgent
    ? {
        id: referral.assignedAgent._id ?? referral.assignedAgent.id ?? null,
        name: referral.assignedAgent.name ?? null,
        email: referral.assignedAgent.email ?? null,
        phone: referral.assignedAgent.phone ?? null,
      }
    : null;
  const fallbackBuySideContact: Contact | null = referral.buySideAgent
    ? {
        id: referral.buySideAgent._id ?? referral.buySideAgent.id ?? null,
        name: referral.buySideAgent.name ?? null,
        email: referral.buySideAgent.email ?? null,
        phone: referral.buySideAgent.phone ?? null,
      }
    : null;
  const fallbackSellSideContact: Contact | null = referral.sellSideAgent
    ? {
        id: referral.sellSideAgent._id ?? referral.sellSideAgent.id ?? null,
        name: referral.sellSideAgent.name ?? null,
        email: referral.sellSideAgent.email ?? null,
        phone: referral.sellSideAgent.phone ?? null,
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
  const allowAssignedFallback = !fallbackBuySideContact && !fallbackSellSideContact;
  const canUseAssignedForBuySide = allowAssignedFallback && referral.clientType !== 'Seller';
  const canUseAssignedForSellSide = allowAssignedFallback && referral.clientType !== 'Buyer';
  const primarySide = useMemo<'buy' | 'sell'>(() => {
    // Prioritize clientType over dealSide for Seller referrals
    if (referral.clientType === 'Seller') {
      return 'sell';
    }
    if (referral.clientType === 'Buyer') {
      return 'buy';
    }
    if (dealSide === 'sell') {
      return 'sell';
    }
    if (dealSide === 'buy') {
      if (buySideAgentContact || fallbackBuySideContact) {
        return 'buy';
      }
      if (!buySideAgentContact && !fallbackBuySideContact && (sellSideAgentContact || fallbackSellSideContact)) {
        return 'sell';
      }
      return 'buy';
    }
    if (!buySideAgentContact && !fallbackBuySideContact && (sellSideAgentContact || fallbackSellSideContact)) {
      return 'sell';
    }
    return 'buy';
  }, [
    buySideAgentContact,
    dealSide,
    fallbackBuySideContact,
    fallbackSellSideContact,
    referral.clientType,
    sellSideAgentContact,
  ]);
  const effectiveBuySideContact =
    buySideAgentContact ??
    fallbackBuySideContact ??
    (canUseAssignedForBuySide ? fallbackAgentContact : null);
  const effectiveSellSideContact =
    sellSideAgentContact ??
    fallbackSellSideContact ??
    (canUseAssignedForSellSide ? fallbackAgentContact : null);
  const effectiveMcContact = mcContact ?? fallbackMcContact;
  const nonAgentRolesCanAssignReferralAgent =
    viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'mc';
  const canAssignBuyAgent =
    nonAgentRolesCanAssignReferralAgent ||
    (viewerRole === 'agent' && !fallbackBuySideContact);
  const canAssignSellAgent =
    nonAgentRolesCanAssignReferralAgent ||
    (viewerRole === 'agent' && !fallbackSellSideContact);
  const canAssignPrimaryAgent =
    nonAgentRolesCanAssignReferralAgent ||
    (viewerRole === 'agent' &&
      (primarySide === 'buy' ? !fallbackBuySideContact : !fallbackSellSideContact));
  const canAssignMc = viewerRole === 'admin';
  const canEditBucket = viewerRole === 'admin' || viewerRole === 'manager';
  const showBucketSummary =
    viewerRole !== 'agent' && viewerRole !== 'admin' && viewerRole !== 'mc';
  const pendingMcHelper =
    viewerRole === 'agent' && isAgentOrigin
      ? 'AFC has received your intro — thank you! You’ll get an email once you’re paired with a mortgage consultant.'
      : undefined;

  const locationLabel = useMemo(() => {
    const zips = Array.isArray(referral.lookingInZips)
      ? referral.lookingInZips.filter(isNonEmptyString)
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

  const showAgentCcField = !isAgentOrigin;
  const showMcCcField = referral.clientType !== 'Seller';

  const borrowerName = referral.borrower?.name ?? 'Borrower';
  const borrowerEmail = referral.borrower?.email?.trim() ?? '';
  const borrowerPhone = referral.borrower?.phone?.trim() ?? '';

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

  const handleStatusChanged = (
    nextStatus: ReferralStatus,
    payload?: Record<string, unknown>,
    sideOverride?: 'buy' | 'sell'
  ) => {
    const previousStatusValue =
      typeof payload?.previousStatus === 'string'
        ? (payload.previousStatus as ReferralStatus)
        : status;
    const payloadSummaryStatus = normalizeReferralStatus(asNullableString(payload?.status));
    const resolvedSummaryStatus = payloadSummaryStatus ?? nextStatus;
    const payloadBuyStatus = normalizeReferralStatus(asNullableString(payload?.buyStatus));
    const payloadSellStatus = normalizeReferralStatus(asNullableString(payload?.sellStatus));
    const resolvedSide =
      sideOverride ??
      (payload?.side === 'sell' || payload?.side === 'buy' ? (payload.side as 'buy' | 'sell') : undefined);

    setStatus(resolvedSummaryStatus);
    setBuyStatus((previous) => {
      if (payloadBuyStatus) return payloadBuyStatus;
      if (resolvedSide === 'buy') return nextStatus;
      return previous;
    });
    setSellStatus((previous) => {
      if (payloadSellStatus) return payloadSellStatus;
      if (resolvedSide === 'sell') return nextStatus;
      return previous;
    });
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

    if (resolvedSummaryStatus !== previousStatusValue) {
      setDaysInStatus(computedDaysInStatus);
      setAuditEntries((previous) => [
        ...(Array.isArray(previous) ? previous : []),
        {
          field: 'status',
          newValue: resolvedSummaryStatus,
          timestamp: statusUpdatedAt.toISOString(),
        },
      ]);
    } else {
      setDaysInStatus(computedDaysInStatus);
    }

    onFinancialsChange?.({
      status: resolvedSummaryStatus,
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
      dealSide: resolvedSide ?? dealSide,
    });

    const referralIdStr = String(referral._id);
    void mutate(
      (key: unknown) =>
        typeof key === 'string' &&
        key.startsWith('/api/admin/tasks') &&
        key.includes(`referralId=${referralIdStr}`)
    );
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
  const isBothClientType = referral.clientType === 'Both';
  const buyStatusLabel: ReferralStatus = buyStatus;
  const sellStatusLabel: ReferralStatus = sellStatus;
  const viewerAssignedSide =
    referral.viewerAssignedSide === 'sell' || referral.viewerAssignedSide === 'buy'
      ? referral.viewerAssignedSide
      : primarySide;
  const viewerAssignedStatus = viewerAssignedSide === 'sell' ? sellStatusLabel : buyStatusLabel;
  const oppositeSide = viewerAssignedSide === 'sell' ? 'buy' : 'sell';
  const oppositeSideStatus = oppositeSide === 'sell' ? sellStatusLabel : buyStatusLabel;
  const buyStatusDisplay = getReferralStatusLabel(buyStatusLabel, { isAgentOrigin });
  const sellStatusDisplay = getReferralStatusLabel(sellStatusLabel, { isAgentOrigin });
  const oppositeSideStatusDisplay = getReferralStatusLabel(oppositeSideStatus, { isAgentOrigin });
  const latestDealStatusLabel = latestDealStatus ?? 'No deals yet';
  const latestBuyDealStatusLabel = latestBuyDealStatus ?? 'No deals yet';
  const latestSellDealStatusLabel = latestSellDealStatus ?? 'No deals yet';
  const showSplitStatus = isBothClientType && viewerRole === 'admin';

  const statusCardMeta = (
    <p className="text-[13px] text-foreground-subtle">
      {!showSplitStatus ? <>Latest deal: {latestDealStatusLabel}</> : null}
      {referral.statusLastUpdated ? (
        <>
          {!showSplitStatus ? ' · ' : ''}
          Updated <span className="text-numeric">{formatDateMST(referral.statusLastUpdated)}</span>
        </>
      ) : null}
    </p>
  );

  return (
    <>
      <AdminDetailHeader
        referralId={String(referral._id)}
        borrowerName={borrowerName}
        clientType={referral.clientType ?? 'Buyer'}
        showAgentOriginMarker={isAgentOrigin && (viewerRole === 'admin' || viewerRole === 'manager')}
        referredAt={referral.referralDate ?? referral.createdAt}
        propertyLabel={propertyLabel}
        loanFileNumber={referral.loanFileNumber}
        borrowerEmail={borrowerEmail}
        borrowerPhone={borrowerPhone}
        backHref={backHref}
        showNav={showNav}
        prevHref={prevHref}
        nextHref={nextHref}
        canDelete={canDelete}
        deleting={deleting}
        onDelete={onDelete}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={railCardClasses}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className={railTitleClasses}>Where are they now?</h2>
              {statusCardMeta}
            </div>
            <div className="mt-3.5">
              {showSplitStatus ? (
                <div className="space-y-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-eyebrow text-info">Buy side</p>
                        <p className="text-xs text-foreground-subtle">Latest deal: {latestBuyDealStatusLabel}</p>
                      </div>
                      <StatusChanger
                        referralId={referral._id}
                        status={buyStatusLabel}
                        statuses={REFERRAL_STATUSES}
                        includeTerminalStatuses
                        isAgentOrigin={isAgentOrigin}
                        side="buy"
                        statusLabel="Buy side stage"
                        mode="track"
                        compactTrack
                        borrowerName={borrowerName}
                        showPreApproval={false}
                        onStatusChanged={(next, payload) => handleStatusChanged(next, payload, 'buy')}
                        onUnderContractIntentChange={onUnderContractIntentChange}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-eyebrow text-accent">Sell side</p>
                        <p className="text-xs text-foreground-subtle">Latest deal: {latestSellDealStatusLabel}</p>
                      </div>
                      <StatusChanger
                        referralId={referral._id}
                        status={sellStatusLabel}
                        statuses={REFERRAL_STATUSES}
                        includeTerminalStatuses
                        isAgentOrigin={isAgentOrigin}
                        side="sell"
                        statusLabel="Sell side stage"
                        mode="track"
                        compactTrack
                        borrowerName={borrowerName}
                        showPreApproval={false}
                        onStatusChanged={(next, payload) => handleStatusChanged(next, payload, 'sell')}
                        onUnderContractIntentChange={onUnderContractIntentChange}
                      />
                    </div>
                  </div>
                </div>
              ) : isBothClientType && viewerRole === 'agent' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Badge variant="info" className="justify-center">
                      Buy: {buyStatusDisplay}
                    </Badge>
                    <Badge variant="accent" className="justify-center">
                      Sell: {sellStatusDisplay}
                    </Badge>
                  </div>
                  <p className="text-xs text-foreground-subtle">
                    Latest deal on my side ({viewerAssignedSide.toUpperCase()}):{' '}
                    {viewerAssignedSide === 'sell' ? latestSellDealStatusLabel : latestBuyDealStatusLabel}
                  </p>
                  <StatusChanger
                    referralId={referral._id}
                    status={viewerAssignedStatus}
                    statuses={REFERRAL_STATUSES}
                    isAgentOrigin={isAgentOrigin}
                    side={viewerAssignedSide}
                    statusLabel={`My side (${viewerAssignedSide})`}
                    borrowerName={borrowerName}
                    preApprovalAmountCents={preApprovalAmountCents}
                    onStatusChanged={(next, payload) =>
                      handleStatusChanged(next, payload, viewerAssignedSide)
                    }
                    onPreApprovalSaved={handlePreApprovalSaved}
                    onUnderContractIntentChange={onUnderContractIntentChange}
                  />
                  <p className="text-xs text-foreground-subtle">
                    {oppositeSide.toUpperCase()} side status: {oppositeSideStatusDisplay}
                  </p>
                </div>
              ) : (
                <StatusChanger
                  referralId={referral._id}
                  status={status}
                  statuses={REFERRAL_STATUSES}
                  includeTerminalStatuses={viewerRole === 'admin'}
                  isAgentOrigin={isAgentOrigin}
                  side={primarySide}
                  statusLabel="Status"
                  mode="track"
                  daysInStatus={daysInStatus}
                  borrowerName={borrowerName}
                  showPreApproval={false}
                  onStatusChanged={handleStatusChanged}
                  onUnderContractIntentChange={onUnderContractIntentChange}
                />
              )}
            </div>
          </section>

          {viewerRole === 'admin' && <AdminTasksCard referralId={String(referral._id)} viewerRole={viewerRole} />}

          {children}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <TeamCard
            referral={referral}
            viewerRole={viewerRole}
            isBothClientType={isBothClientType}
            primarySide={primarySide}
            buySideContact={effectiveBuySideContact}
            sellSideContact={effectiveSellSideContact}
            mcContact={effectiveMcContact}
            canAssignBuyAgent={canAssignBuyAgent}
            canAssignSellAgent={canAssignSellAgent}
            canAssignPrimaryAgent={canAssignPrimaryAgent}
            canAssignMc={canAssignMc}
            onBuySideAgentContactChange={onBuySideAgentContactChange}
            onSellSideAgentContactChange={onSellSideAgentContactChange}
            onMcContactChange={onMcContactChange}
            pendingMcHelper={pendingMcHelper}
            showAgentCcField={showAgentCcField}
            showMcCcField={showMcCcField}
          />

          {railSlot}

          {showSlaWidget && <SLAWidget referral={{ ...referral, status, audit: auditEntries }} />}

          {showBucketSummary && (
            <RailCard title="Agent bucket" description={bucketDescription}>
              {canEditBucket ? (
                <select
                  value={ahaBucket}
                  onChange={handleBucketChange}
                  disabled={savingBucket}
                  className={selectFieldClasses}
                >
                  <option value="">Not set</option>
                  <option value="AHA">AHA</option>
                  <option value="AHA_OOS">AHA OOS</option>
                </select>
              ) : (
                <p className="text-sm font-semibold text-foreground">{bucketLabel}</p>
              )}
            </RailCard>
          )}
        </aside>
      </div>

    </>
  );
}
