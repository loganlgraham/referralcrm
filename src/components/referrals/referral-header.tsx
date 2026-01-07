'use client';

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { differenceInDays } from 'date-fns';
import { toast } from 'sonner';

import { ReferralStatus, REFERRAL_STATUSES, normalizeReferralStatus } from '@/constants/referrals';
import { StatusChanger } from '@/components/referrals/status-changer';
import { SLAWidget } from '@/components/referrals/sla-widget';
import { ContactAssignment, type Contact } from '@/components/referrals/contact-assignment';
import { EmailActivityLink } from '@/components/common/email-activity-link';
import type { ReferralLike } from '@/utils/sla-insights';
import { ReferralFollowUpCard } from '@/components/referrals/referral-follow-up-card';

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

const extractFirstName = (name?: string | null, fallback = ''): string => {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  const [first] = trimmed.split(/\s+/);
  return first || fallback;
};

const buildBorrowerFirstName = (referral: any): string => {
  const borrower = referral?.borrower ?? {};
  return (
    extractFirstName(borrower.firstName, '') ||
    extractFirstName(borrower.name, '') ||
    'there'
  );
};

const buildIntroClipboardTemplate = (
  referral: any,
  buyingAgent: Contact | null,
  sellingAgent: Contact | null,
  mcContact: Contact | null
): string => {
  const borrowerFirstName = buildBorrowerFirstName(referral);
  const isSellerOnly = referral.clientType === 'Seller';
  const buyerFullName = buyingAgent?.name ?? 'your buying agent';
  const buyerPhone = buyingAgent?.phone ?? 'Not provided';
  const buyerEmail = buyingAgent?.email ?? 'Not provided';
  const buyerFirstName = extractFirstName(buyingAgent?.name, 'your buying agent');
  const sellerFullName = sellingAgent?.name ?? 'your selling agent';
  const sellerPhone = sellingAgent?.phone ?? 'Not provided';
  const sellerEmail = sellingAgent?.email ?? 'Not provided';
  const sellerFirstName = extractFirstName(sellingAgent?.name, 'your selling agent');
  const mcFirstName = extractFirstName(mcContact?.name, 'me');

  const buyingAgentBlock = [buyerFullName, buyerPhone, buyerEmail].join('\n');
  const sellingAgentBlock = [sellerFullName, sellerPhone, sellerEmail].join('\n');

  if (isSellerOnly) {
    const agentsIntro = `${sellerFullName}, a local and trusted Real Estate Specialist who will be assisting you with selling your home.`;

    return (
      `Hi ${borrowerFirstName},\n\n` +
      'I want to thank you again for your interest in our Agent Concierge Program. This program is tailored to support clients like you as you navigate the home-selling process with American Financing and to connect you with top-tier local agents.\n\n' +
      `I'm excited to introduce you to ${agentsIntro}\n\n` +
      `Below are ${sellerFirstName}'s contact details. You can expect them to reach out to you shortly:\n\n` +
      'Selling Agent\n' +
      `${sellingAgentBlock}\n\n` +
      `If, at any point, you have trouble reaching ${sellerFirstName} or are not fully satisfied with the services provided, please don't hesitate to contact me. We are committed to supporting you every step of the way.\n\n` +
      'Thank you once again, and best of luck with your home sale!\n\n---'
    );
  }

  const agentsIntro = buyingAgent && sellingAgent
    ? `${buyerFullName} and ${sellerFullName}, both local and trusted Real Estate Specialists who will be assisting you with your home purchase.`
    : `${buyerFullName}, a local and trusted Real Estate Specialist who will be assisting you with your home purchase.`;

  const dualAgents = Boolean(buyingAgent && sellingAgent);

  return (
    `Hi ${borrowerFirstName},\n\n` +
    'I want to thank you again for your interest in our Agent Concierge Program. This program is tailored to support clients like you as you navigate the home-buying and selling process with American Financing and to connect you with top-tier local agents.\n\n' +
    `I'm excited to introduce you to ${agentsIntro}\n\n` +
    `Below are ${dualAgents ? `${buyerFirstName} and ${sellerFirstName}` : buyerFirstName}'s contact details. You can expect them to reach out to you shortly:\n\n` +
    'Buying Agent\n' +
    `${buyingAgentBlock}\n\n` +
    (dualAgents ? `Selling Agent\n${sellingAgentBlock}\n\n` : '') +
    `If, at any point, you have trouble reaching ${dualAgents ? `${buyerFirstName} or ${sellerFirstName}` : buyerFirstName} or are not fully satisfied with the services provided, please don't hesitate to contact ${mcFirstName} or me. We are committed to supporting you every step of the way.\n\n` +
    'Thank you once again, and happy home shopping!\n\n---'
  );
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
  followUpReferral: ReferralLike & { borrower?: { name?: string } };
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
};

export function ReferralHeader({
  referral,
  viewerRole,
  followUpReferral,
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
}: ReferralHeaderProps) {
  const { mutate } = useSWRConfig();
  const isAgentOrigin = referral.origin === 'agent';
  const normalizedStatus = normalizeReferralStatus(referral.status) ?? 'New Lead';
  const [status, setStatus] = useState<ReferralStatus>(normalizedStatus);
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
  const [sendingIntroductions, setSendingIntroductions] = useState(false);
  const [introNotes, setIntroNotes] = useState('');
  const [cleanedNotes, setCleanedNotes] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [cleaningNotes, setCleaningNotes] = useState(false);
  const [introEmailStatus, setIntroEmailStatus] = useState<{
    summary: string;
    sentAt: Date;
  } | null>(null);
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
  const activityFeedKey = `/api/referrals/${referral._id}/activities`;

  useEffect(() => {
    const nextStatus = normalizeReferralStatus(referral.status);
    if (nextStatus) {
      setStatus(nextStatus);
    }
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

  const isAgentView = viewerRole === 'agent';
  const canAssignAgent =
    viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'mc' || viewerRole === 'agent';
  const canAssignMc = viewerRole === 'admin' || viewerRole === 'manager' || viewerRole === 'agent';
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
  const effectiveAgentContact = primarySide === 'sell' ? effectiveSellSideContact : effectiveBuySideContact;
  const effectiveMcContact = mcContact ?? fallbackMcContact;
  const canEditBucket = viewerRole === 'admin' || viewerRole === 'manager';
  const showBucketSummary =
    viewerRole !== 'agent' && viewerRole !== 'admin' && viewerRole !== 'mc';

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

  const borrowerName = referral.borrower?.name ?? 'Borrower';
  const borrowerEmail = referral.borrower?.email?.trim() ?? '';
  const borrowerPhone = referral.borrower?.phone?.trim() ?? '';
  const hasBorrowerContact = Boolean(borrowerEmail || borrowerPhone);

  const handlePreviewIntroductions = async () => {
    if (!introNotes.trim()) {
      // No notes to clean up, show preview with empty notes
      setCleanedNotes('');
      setShowPreview(true);
      return;
    }

    setCleaningNotes(true);
    try {
      const response = await fetch(`/api/referrals/${referral._id}/cleanup-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: introNotes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // If cleanup fails, use original notes
        setCleanedNotes(introNotes);
        toast.error('Could not clean up notes, using original text.');
      } else {
        setCleanedNotes(payload.cleanedNotes || introNotes);
      }
      setShowPreview(true);
    } catch (error) {
      console.error('Failed to clean up notes', error);
      setCleanedNotes(introNotes);
      setShowPreview(true);
    } finally {
      setCleaningNotes(false);
    }
  };

  const handleConfirmSend = async () => {
    setSendingIntroductions(true);
    setShowPreview(false);
    try {
      const response = await fetch(`/api/referrals/${referral._id}/send-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: cleanedNotes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to send intro emails right now.';
        throw new Error(message);
      }

      const sent = Array.isArray(payload?.sent) ? payload.sent : [];
      const skipped = Array.isArray(payload?.skipped) ? payload.skipped : [];
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];

      const summaryParts: string[] = [];
      if (sent.length > 0) {
        summaryParts.push(`Sent to ${sent.join(', ')}`);
      }
      if (skipped.length > 0) {
        summaryParts.push(`Skipped ${skipped.join(', ')} (missing email)`);
      }
      if (errors.length > 0) {
        summaryParts.push(`Failed for ${errors.join(', ')}`);
      }

      const summary = summaryParts.join('. ');
      if (errors.length > 0) {
        toast.error(summary || 'Some emails could not be sent.');
      } else if (sent.length > 0) {
        toast.success(summary || 'Intro emails sent.');
      } else {
        toast.info(summary || 'No emails were sent.');
      }

      void mutate(activityFeedKey);

      const clipboardContent = buildIntroClipboardTemplate(
        referral,
        effectiveBuySideContact,
        effectiveSellSideContact,
        effectiveMcContact
      );

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(clipboardContent).catch((error) => {
          console.error('Failed to copy intro email to clipboard', error);
        });
      }

      setIntroEmailStatus({
        summary: summary || 'Intro emails sent.',
        sentAt: new Date(),
      });
      setIntroNotes('');
      setCleanedNotes('');
    } catch (error) {
      console.error('Failed to send intro emails', error);
      toast.error(error instanceof Error ? error.message : 'Unable to send intro emails right now.');
    } finally {
      setSendingIntroductions(false);
    }
  };

  const handleCancelPreview = () => {
    setShowPreview(false);
    setCleanedNotes('');
  };

  const handleRecopyIntroEmail = async () => {
    try {
      const clipboardContent = buildIntroClipboardTemplate(
        referral,
        effectiveBuySideContact,
        effectiveSellSideContact,
        effectiveMcContact
      );

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardContent);
        toast.success('Intro email template copied to clipboard');
      } else {
        toast.error('Clipboard access is not available');
      }
    } catch (error) {
      console.error('Failed to copy intro email to clipboard', error);
      toast.error('Failed to copy intro email template to clipboard');
    }
  };

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
          className={`flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end ${
            isAgentView ? 'lg:justify-end' : ''
          }`}
        >
          <section className="h-full min-w-[280px] w-full max-w-xl rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm sm:max-w-md lg:max-w-[440px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Status &amp; progress</h2>
              <span className="text-[11px] uppercase tracking-wide text-slate-400">Pipeline</span>
            </div>
            <div className="mt-2">
              <StatusChanger
                referralId={referral._id}
                status={status}
                statuses={REFERRAL_STATUSES}
                preApprovalAmountCents={preApprovalAmountCents}
                onStatusChanged={handleStatusChanged}
                onPreApprovalSaved={handlePreApprovalSaved}
                onUnderContractIntentChange={onUnderContractIntentChange}
              />
            </div>
          </section>
          {showBucketSummary && (
            <section className="flex h-full flex-col justify-between rounded-lg border border-slate-200 bg-slate-900/5 p-4 sm:col-span-2">
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
      {referral.origin !== 'agent' && <SLAWidget referral={{ ...referral, status, audit: auditEntries }} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),minmax(280px,1fr)]">
        <ReferralFollowUpCard referral={followUpReferral} />
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Team assignments</h2>
            <p className="text-xs text-slate-500">Keep the right partners aligned on this referral.</p>
          </div>
          {referral.clientType === 'Both' ? (
            <>
              <ContactAssignment
                referralId={referral._id}
                type="agent"
                side="buy"
                contact={effectiveBuySideContact}
                canAssign={canAssignAgent}
                onContactChange={onBuySideAgentContactChange}
              />
              <ContactAssignment
                referralId={referral._id}
                type="agent"
                side="sell"
                contact={effectiveSellSideContact}
                canAssign={canAssignAgent}
                onContactChange={onSellSideAgentContactChange}
              />
            </>
          ) : (
            <ContactAssignment
              referralId={referral._id}
              type="agent"
              side={primarySide}
              contact={effectiveAgentContact}
              canAssign={canAssignAgent}
              onContactChange={
                primarySide === 'sell'
                  ? onSellSideAgentContactChange
                  : onBuySideAgentContactChange
              }
            />
          )}
          {referral.clientType !== 'Seller' && (
            <ContactAssignment
              referralId={referral._id}
              type="mc"
              contact={effectiveMcContact}
              canAssign={canAssignMc}
              onContactChange={onMcContactChange}
            />
          )}
          {viewerRole === 'admin' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5 text-xs text-slate-600">
                  <p className="font-semibold uppercase tracking-wide text-slate-700">Intro emails</p>
                  <p>Send friendly updates to the agent and MC.</p>
                </div>
                <button
                  type="button"
                  onClick={handlePreviewIntroductions}
                  disabled={sendingIntroductions || cleaningNotes}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {sendingIntroductions ? 'Sending…' : cleaningNotes ? 'Preparing…' : 'Send now'}
                </button>
              </div>
              <textarea
                value={introNotes}
                onChange={(event) => setIntroNotes(event.target.value)}
                rows={2}
                className="mt-2 w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand focus:outline-none"
                placeholder="Add a note to include in the agent email (optional)"
                disabled={sendingIntroductions || cleaningNotes}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Agent emails include the MC's contact info, and the MC email highlights the agent's details.
              </p>
              {introEmailStatus && (
                <div className="mt-2 space-y-2">
                  <div className="text-[11px] text-slate-600">
                    <p>{introEmailStatus.summary}</p>
                    <p>
                      Copied intro email for Gmail and sent at{' '}
                      {introEmailStatus.sentAt.toLocaleString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      .
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRecopyIntroEmail}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Re-copy intro email
                  </button>
                </div>
              )}
              {showPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                  <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
                    <h3 className="text-lg font-semibold text-slate-900">Preview Email Notes</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Review the cleaned-up notes before sending to the agent.
                    </p>
                    {cleanedNotes ? (
                      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes (cleaned up)</p>
                        <textarea
                          value={cleanedNotes}
                          onChange={(event) => setCleanedNotes(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none"
                        />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm text-slate-600">No notes will be included in the email.</p>
                      </div>
                    )}
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={handleCancelPreview}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmSend}
                        disabled={sendingIntroductions}
                        className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-dark hover:shadow disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {sendingIntroductions ? 'Sending…' : 'Confirm & Send'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

    </div>
  );
}
