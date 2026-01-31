'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';

import { ReferralHeader } from '@/components/referrals/referral-header';
import { ReferralNotes } from '@/components/referrals/referral-notes';
import { ReferralTimeline } from '@/components/referrals/referral-timeline';
import type { Contact } from '@/components/referrals/contact-assignment';
import { normalizeReferralStatus, type ReferralStatus, REFERRAL_TIMELINE_OPTIONS, REFERRAL_TIMELINE_VALUES } from '@/constants/referrals';
import { ReferralDeals } from '@/components/referrals/referral-deals';
import type { ReferralPayment } from '@/types/referral-payment';
import { formatCurrency, formatDate } from '@/utils/formatters';

type ReferralSource = string;
type ReferralClientType = 'Seller' | 'Buyer' | 'Both';
type TransferStage = 'Pre-approval TBD' | 'Pre-approved';

interface ReferralContact {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface ReferralDetailNote {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  hiddenFromAgent?: boolean;
  hiddenFromMc?: boolean;
  emailedTargets?: ('agent' | 'mc' | 'admin')[];
}

interface ReferralDetail {
  _id: string;
  createdAt: string;
  loanFileNumber: string;
  source?: ReferralSource | null;
  endorser?: string | null;
  clientType?: ReferralClientType | null;
  lookingInZip?: string | null;
  lookingInZips?: string[] | null;
  borrowerCurrentAddress?: string | null;
  stageOnTransfer?: string | null;
  loanType?: string | null;
  borrower: {
    name: string;
    email: string;
    phone: string;
  };
  status: ReferralStatus;
  preApprovalAmountCents?: number;
  estPurchasePriceCents?: number;
  referralFeeDueCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  dealSide?: 'buy' | 'sell';
  propertyAddress?: string;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyPostalCode?: string | null;
  assignedAgent?: ReferralContact | null;
  buySideAgent?: ReferralContact | null;
  sellSideAgent?: ReferralContact | null;
  lender?: ReferralContact | null;
  payments?: ReferralPayment[];
  notes?: ReferralDetailNote[];
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  viewerRole?: string;
  ahaBucket?: 'AHA' | 'AHA_OOS' | '' | null;
  org?: string;
  origin?: 'agent' | 'mc' | 'admin' | null;
  timeline?: 'asap' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months' | 'not_specified';
  adminContacts?: { name?: string | null; email?: string | null }[];
  audit?: {
    field?: string | null;
    newValue?: unknown;
    timestamp?: string | null;
  }[];
  [key: string]: unknown;
}

interface ReferralDetailClientProps {
  referral: ReferralDetail;
  viewerRole: string;
  notes: ReferralDetailNote[];
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
  propertyCity?: string;
  propertyState?: string;
  propertyPostalCode?: string;
  dealSide?: 'buy' | 'sell';
}

interface DetailDraft {
  loanFileNumber: string;
  source: ReferralSource;
  endorser: string;
  clientType: ReferralClientType;
  lookingInZip: string;
  borrowerCurrentAddress: string;
  stageOnTransfer: TransferStage;
  loanType: string;
  preApprovalAmount: string;
  timeline: 'asap' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months' | 'not_specified';
  createdAt: string;
}

const DETAIL_FIELD_KEYS: (keyof DetailDraft)[] = [
  'loanFileNumber',
  'source',
  'endorser',
  'clientType',
  'lookingInZip',
  'borrowerCurrentAddress',
  'stageOnTransfer',
  'loanType',
  'preApprovalAmount',
  'timeline',
];

const ensureString = (value: unknown) => (typeof value === 'string' ? value : '');

const normalizeSource = (value: unknown): ReferralSource =>
  typeof value === 'string' ? value.trim() : '';

const normalizeClientType = (value: unknown): ReferralClientType => {
  if (value === 'Seller' || value === 'Both') {
    return value;
  }
  return 'Buyer';
};

const normalizeStageOnTransfer = (value: unknown): TransferStage => {
  if (value === 'Pre-approved' || value === 'Pre-approval TBD') {
    return value as TransferStage;
  }

  if (value === 'Pre-Approval') {
    return 'Pre-approved';
  }

  if (value === 'Pre-Approval TBD') {
    return 'Pre-approval TBD';
  }

  return 'Pre-approval TBD';
};

const parseZipList = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((zip) => zip.trim())
        .filter((zip) => /^\d{5}$/u.test(zip))
    )
  );

const formatZipList = (values: string[]): string => values.join(', ');

const centsToCurrencyInput = (value?: number | null) => {
  if (!value) {
    return '';
  }
  const amount = value / 100;
  return Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
};

const sanitizeCurrencyInput = (value: string) => {
  if (!value) {
    return '';
  }
  const stripped = value.replace(/[^0-9.]/g, '');
  if (!stripped) {
    return '';
  }

  const [integerPart = '', ...decimalParts] = stripped.split('.');
  const decimalPart = decimalParts.join('').slice(0, 2);
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const hasDecimal = decimalParts.length > 0;
  const safeInteger = normalizedInteger || (integerPart.length > 0 ? '0' : '');

  if (!hasDecimal) {
    return safeInteger;
  }

  const integerPortion = safeInteger || '0';
  return decimalPart.length > 0 ? `${integerPortion}.${decimalPart}` : `${integerPortion}.`;
};

const formatCurrencyInputDisplay = (value: string) => {
  if (!value) {
    return '';
  }

  const [integerPart = '', decimalPart] = value.split('.');
  const hasDecimal = decimalPart !== undefined;
  const sanitizedInteger = integerPart.replace(/[^0-9]/g, '');
  const integerValue = sanitizedInteger ? Number(sanitizedInteger) : 0;
  const formattedInteger = sanitizedInteger
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(integerValue)
    : '';

  if (!hasDecimal) {
    return formattedInteger;
  }

  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};

// Convert ISO date string to datetime-local format (YYYY-MM-DDTHH:mm)
const isoToDateTimeLocal = (isoString?: string | null): string => {
  if (!isoString) {
    return '';
  }
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    // Get local date components
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
};

// Convert datetime-local format (YYYY-MM-DDTHH:mm) to ISO string
const dateTimeLocalToISO = (dateTimeLocal: string): string => {
  if (!dateTimeLocal) {
    return '';
  }
  try {
    // Parse the datetime-local string and create a Date object in local timezone
    const [datePart, timePart] = dateTimeLocal.split('T');
    if (!datePart || !timePart) {
      return '';
    }
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    
    // Create date in local timezone
    const localDate = new Date(year, month - 1, day, hours, minutes);
    return localDate.toISOString();
  } catch {
    return '';
  }
};

const createDetailDraft = (referral: ReferralDetail): DetailDraft => ({
  loanFileNumber: ensureString(referral?.loanFileNumber),
  source: normalizeSource(referral?.source),
  endorser: ensureString(referral?.endorser),
  clientType: normalizeClientType(referral?.clientType),
  lookingInZip: (() => {
    const values = Array.isArray(referral?.lookingInZips)
      ? referral.lookingInZips.filter((zip): zip is string => typeof zip === 'string' && zip.trim().length > 0)
      : [];
    if (values.length > 0) {
      return formatZipList(values.map((zip) => zip.trim()));
    }
    return ensureString(referral?.lookingInZip);
  })(),
  borrowerCurrentAddress: ensureString(referral?.borrowerCurrentAddress),
  stageOnTransfer: normalizeStageOnTransfer(referral?.stageOnTransfer),
  loanType: ensureString(referral?.loanType),
  preApprovalAmount: sanitizeCurrencyInput(centsToCurrencyInput(referral?.preApprovalAmountCents)),
  timeline: (referral?.timeline && REFERRAL_TIMELINE_VALUES.includes(referral.timeline as any))
    ? (referral.timeline as DetailDraft['timeline'])
    : 'not_specified',
  createdAt: isoToDateTimeLocal(referral?.createdAt),
});

const normalizeDetailDraft = (draft: DetailDraft): DetailDraft => ({
  loanFileNumber: draft.loanFileNumber.trim(),
  source: draft.source.trim(),
  endorser: draft.endorser.trim(),
  clientType: draft.clientType,
  lookingInZip: formatZipList(parseZipList(draft.lookingInZip)),
  borrowerCurrentAddress: draft.borrowerCurrentAddress.trim(),
  stageOnTransfer: normalizeStageOnTransfer(draft.stageOnTransfer),
  loanType: draft.loanType.trim(),
  preApprovalAmount: sanitizeCurrencyInput(draft.preApprovalAmount),
  timeline: draft.timeline,
  createdAt: draft.createdAt.trim(),
});

const formatFullAddress = (
  street?: string | null,
  city?: string | null,
  state?: string | null,
  postal?: string | null
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

export function ReferralDetailClient({ referral: initialReferral, viewerRole, notes, referralId }: ReferralDetailClientProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [isPending, startTransition] = useTransition();
  const activityFeedKey = `/api/referrals/${referralId}/activities`;
  const [referral, setReferral] = useState<ReferralDetail>(initialReferral);
  const origin = referral.origin ?? initialReferral.origin ?? null;
  const isAgentOrigin = origin === 'agent';
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<DetailDraft>(() => createDetailDraft(initialReferral));
  const [savingDetails, setSavingDetails] = useState(false);
  const [buySideAgentContact, setBuySideAgentContact] = useState<Contact | null>(() =>
    initialReferral.buySideAgent
      ? {
          id: initialReferral.buySideAgent._id ?? initialReferral.buySideAgent.id ?? null,
          name: initialReferral.buySideAgent.name ?? null,
          email: initialReferral.buySideAgent.email ?? null,
          phone: initialReferral.buySideAgent.phone ?? null,
        }
      : null
  );
  const [sellSideAgentContact, setSellSideAgentContact] = useState<Contact | null>(() =>
    initialReferral.sellSideAgent
      ? {
          id: initialReferral.sellSideAgent._id ?? initialReferral.sellSideAgent.id ?? null,
          name: initialReferral.sellSideAgent.name ?? null,
          email: initialReferral.sellSideAgent.email ?? null,
          phone: initialReferral.sellSideAgent.phone ?? null,
        }
      : null
  );
  const [mcContact, setMcContact] = useState<Contact | null>(() =>
    initialReferral.lender
      ? {
          id: initialReferral.lender._id ?? initialReferral.lender.id ?? null,
          name: initialReferral.lender.name ?? null,
          email: initialReferral.lender.email ?? null,
          phone: initialReferral.lender.phone ?? null,
        }
      : null
  );
  const handleBuySideAgentContactChange = (contact: Contact | null) => {
    setBuySideAgentContact(contact);
    setReferral((previous) => {
      const nextBuySideAgent = contact
        ? {
            _id: contact.id ?? undefined,
            id: contact.id ?? undefined,
            name: contact.name ?? undefined,
            email: contact.email ?? undefined,
            phone: contact.phone ?? undefined,
          }
        : null;

      const nextReferral: ReferralDetail = {
        ...previous,
        buySideAgent: nextBuySideAgent,
        assignedAgent: nextBuySideAgent ?? previous.sellSideAgent ?? previous.assignedAgent ?? null,
      };

      return nextReferral;
    });
    void mutate(activityFeedKey);
  };

  const handleSellSideAgentContactChange = (contact: Contact | null) => {
    setSellSideAgentContact(contact);
    setReferral((previous) => {
      const nextSellSideAgent = contact
        ? {
            _id: contact.id ?? undefined,
            id: contact.id ?? undefined,
            name: contact.name ?? undefined,
            email: contact.email ?? undefined,
            phone: contact.phone ?? undefined,
          }
        : null;

      const nextReferral: ReferralDetail = {
        ...previous,
        sellSideAgent: nextSellSideAgent,
        assignedAgent: previous.buySideAgent ?? nextSellSideAgent ?? previous.assignedAgent ?? null,
      };

      return nextReferral;
    });
    void mutate(activityFeedKey);
  };

  const mapReferralContact = (contact: ReferralContact | null | undefined): Contact | null => {
    if (!contact) return null;
    return {
      id: contact._id ?? contact.id ?? null,
      name: contact.name ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
    };
  };

  const hasSideAssignments = Boolean(
    buySideAgentContact ||
      sellSideAgentContact ||
      referral.buySideAgent ||
      referral.sellSideAgent
  );

  const handleMcContactChange = (contact: Contact | null) => {
    setMcContact(contact);
    router.refresh();
    void mutate(activityFeedKey);
  };
  const initialPropertyState = initialReferral.propertyState
    ? String(initialReferral.propertyState).toUpperCase()
    : undefined;
  const [financials, setFinancials] = useState<FinancialState>({
    status: initialReferral.status,
    preApprovalAmountCents: initialReferral.preApprovalAmountCents ?? 0,
    contractPriceCents: initialReferral.estPurchasePriceCents ?? undefined,
    referralFeeDueCents: initialReferral.referralFeeDueCents ?? 0,
    commissionBasisPoints: initialReferral.commissionBasisPoints ?? undefined,
    referralFeeBasisPoints: initialReferral.referralFeeBasisPoints ?? undefined,
    propertyAddress: initialReferral.propertyAddress ?? undefined,
    propertyCity: initialReferral.propertyCity ?? undefined,
    propertyState: initialPropertyState,
    propertyPostalCode: initialReferral.propertyPostalCode ?? undefined,
    dealSide:
      initialReferral.dealSide === 'sell' || initialReferral.dealSide === 'buy'
        ? initialReferral.dealSide
        : 'buy',
  });
  const primarySide = useMemo<'buy' | 'sell'>(() => {
    if (financials.dealSide === 'sell') {
      return 'sell';
    }
    if (financials.dealSide === 'buy') {
      if (buySideAgentContact || referral.buySideAgent) {
        return 'buy';
      }
      if (!buySideAgentContact && !referral.buySideAgent && (sellSideAgentContact || referral.sellSideAgent)) {
        return 'sell';
      }
      return 'buy';
    }
    if (referral.dealSide === 'sell') {
      return 'sell';
    }
    if (referral.dealSide === 'buy') {
      return 'buy';
    }
    if (referral.clientType === 'Seller') {
      return 'sell';
    }
    if (referral.clientType === 'Buyer') {
      return 'buy';
    }
    if (!buySideAgentContact && !referral.buySideAgent && (sellSideAgentContact || referral.sellSideAgent)) {
      return 'sell';
    }
    return 'buy';
  }, [
    buySideAgentContact,
    financials.dealSide,
    referral.buySideAgent,
    referral.clientType,
    referral.dealSide,
    referral.sellSideAgent,
    sellSideAgentContact,
  ]);

  const primaryAgentContact = useMemo(() => {
    const buyContact = buySideAgentContact ?? mapReferralContact(referral.buySideAgent);
    const sellContact = sellSideAgentContact ?? mapReferralContact(referral.sellSideAgent);
    const preferred = primarySide === 'sell' ? sellContact : buyContact;
    if (preferred) {
      return preferred;
    }
    const alternate = primarySide === 'sell' ? buyContact : sellContact;
    if (alternate) {
      return alternate;
    }
    if (!hasSideAssignments) {
      return mapReferralContact(referral.assignedAgent);
    }
    return null;
  }, [
    buySideAgentContact,
    hasSideAssignments,
    primarySide,
    referral.assignedAgent,
    referral.buySideAgent,
    referral.sellSideAgent,
    sellSideAgentContact,
  ]);
  const handleDealCreated = useCallback((deal: ReferralPayment) => {
    if (!deal?._id) {
      return;
    }

    setReferral((previous) => {
      const existingPayments = Array.isArray(previous.payments) ? previous.payments : [];
      if (existingPayments.some((payment) => payment._id === deal._id)) {
        return previous;
      }

      return {
        ...previous,
        payments: [deal, ...existingPayments],
      };
    });
    void mutate(activityFeedKey);
  }, [activityFeedKey, mutate]);
  const handleDealUpdated = useCallback((deal: ReferralPayment) => {
    if (!deal?._id) {
      return;
    }

    setReferral((previous) => {
      const existingPayments = Array.isArray(previous.payments) ? previous.payments : [];
      const updatedPayments = existingPayments.map((payment) =>
        payment._id === deal._id ? { ...payment, ...deal } : payment
      );

      return {
        ...previous,
        payments: updatedPayments,
      };
    });
  }, []);

  const handleDealDeleted = useCallback((id: string) => {
    if (!id) return;
    setReferral((previous) => {
      const existingPayments = Array.isArray(previous.payments) ? previous.payments : [];
      return {
        ...previous,
        payments: existingPayments.filter((payment) => payment._id !== id),
      };
    });
  }, []);
  const [deleting, setDeleting] = useState(false);

  const normalizedDetailDraft = useMemo(() => normalizeDetailDraft(detailsDraft), [detailsDraft]);
  const normalizedCurrentDetails = useMemo(
    () => normalizeDetailDraft(createDetailDraft(referral)),
    [
      referral.loanFileNumber,
      referral.source,
      referral.endorser,
      referral.clientType,
      referral.lookingInZip,
      referral.lookingInZips,
      referral.borrowerCurrentAddress,
      referral.stageOnTransfer,
      referral.loanType,
      referral.preApprovalAmountCents,
      referral.timeline,
      referral.createdAt,
    ]
  );
  const detailsChanged = useMemo(
    () => {
      const standardFieldsChanged = DETAIL_FIELD_KEYS.some((field) => normalizedDetailDraft[field] !== normalizedCurrentDetails[field]);
      const createdAtChanged = viewerRole === 'admin' && normalizedDetailDraft.createdAt !== normalizedCurrentDetails.createdAt;
      return standardFieldsChanged || createdAtChanged;
    },
    [normalizedDetailDraft, normalizedCurrentDetails, viewerRole]
  );

  const lookingInZipDisplay = useMemo(() => {
    const values = Array.isArray(referral.lookingInZips)
      ? referral.lookingInZips.filter((zip) => typeof zip === 'string' && zip.trim().length > 0)
      : [];
    if (values.length > 0) {
      return values.join(', ');
    }
    return referral.lookingInZip ?? '';
  }, [referral.lookingInZips, referral.lookingInZip]);

  const canDelete =
    (viewerRole === 'admin' && referral.origin === 'admin') ||
    (viewerRole === 'agent' && referral.origin === 'agent');
  const canEditDetails = viewerRole !== 'viewer';

  useEffect(() => {
    setReferral(initialReferral);
  }, [initialReferral]);

  useEffect(() => {
    if (!isEditingDetails) {
      setDetailsDraft(createDetailDraft(referral));
    }
  }, [
    isEditingDetails,
    referral.loanFileNumber,
    referral.source,
    referral.endorser,
    referral.clientType,
    referral.lookingInZip,
    referral.lookingInZips,
    referral.borrowerCurrentAddress,
    referral.stageOnTransfer,
    referral.timeline,
    referral.createdAt,
  ]);

  useEffect(() => {
    setFinancials((previous) => {
      const nextReferralFeeDue =
        referral.referralFeeDueCents != null ? referral.referralFeeDueCents : previous.referralFeeDueCents ?? 0;
      const nextPreApproval =
        referral.preApprovalAmountCents != null
          ? referral.preApprovalAmountCents
          : previous.preApprovalAmountCents ?? 0;
      const nextContractPrice =
        referral.estPurchasePriceCents != null
          ? referral.estPurchasePriceCents
          : previous.contractPriceCents;
      const nextCommission =
        referral.commissionBasisPoints != null
          ? referral.commissionBasisPoints
          : previous.commissionBasisPoints;
      const nextReferralFeeBasis =
        referral.referralFeeBasisPoints != null
          ? referral.referralFeeBasisPoints
          : previous.referralFeeBasisPoints;
      const nextDealSide =
        referral.dealSide === 'sell' || referral.dealSide === 'buy'
          ? referral.dealSide
          : previous.dealSide ?? 'buy';
      const nextPropertyAddress =
        referral.propertyAddress !== undefined
          ? referral.propertyAddress ?? undefined
          : previous.propertyAddress;
      const nextPropertyCity =
        referral.propertyCity !== undefined ? referral.propertyCity ?? undefined : previous.propertyCity;
      const nextPropertyState = referral.propertyState
        ? String(referral.propertyState).toUpperCase()
        : previous.propertyState;
      const nextPropertyPostal =
        referral.propertyPostalCode !== undefined
          ? referral.propertyPostalCode ?? undefined
          : previous.propertyPostalCode;

      if (
        previous.status === referral.status &&
        previous.preApprovalAmountCents === nextPreApproval &&
        previous.contractPriceCents === nextContractPrice &&
        previous.referralFeeDueCents === nextReferralFeeDue &&
        previous.commissionBasisPoints === nextCommission &&
        previous.referralFeeBasisPoints === nextReferralFeeBasis &&
        previous.propertyAddress === nextPropertyAddress &&
        previous.propertyCity === nextPropertyCity &&
        previous.propertyState === nextPropertyState &&
        previous.propertyPostalCode === nextPropertyPostal &&
        previous.dealSide === nextDealSide
      ) {
        return previous;
      }

      return {
        status: referral.status,
        preApprovalAmountCents: nextPreApproval,
        contractPriceCents: nextContractPrice,
        referralFeeDueCents: nextReferralFeeDue,
        commissionBasisPoints: nextCommission,
        referralFeeBasisPoints: nextReferralFeeBasis,
        propertyAddress: nextPropertyAddress,
        propertyCity: nextPropertyCity,
        propertyState: nextPropertyState,
        propertyPostalCode: nextPropertyPostal,
        dealSide: nextDealSide,
      };
    });
  }, [
    referral.status,
    referral.preApprovalAmountCents,
    referral.estPurchasePriceCents,
    referral.referralFeeDueCents,
    referral.commissionBasisPoints,
    referral.referralFeeBasisPoints,
    referral.propertyAddress,
    referral.propertyCity,
    referral.propertyState,
    referral.propertyPostalCode,
    referral.dealSide,
  ]);

  useEffect(() => {
    setBuySideAgentContact(mapReferralContact(referral.buySideAgent));
  }, [referral.buySideAgent]);

  useEffect(() => {
    setSellSideAgentContact(mapReferralContact(referral.sellSideAgent));
  }, [referral.sellSideAgent]);

  useEffect(() => {
    setMcContact(
      referral.lender
        ? {
            id: referral.lender._id ?? referral.lender.id ?? null,
            name: referral.lender.name ?? null,
            email: referral.lender.email ?? null,
            phone: referral.lender.phone ?? null,
          }
        : null
    );
  }, [referral.lender]);

  const handleDetailInputChange =
    <K extends keyof DetailDraft>(field: K) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { value } = event.target;
      setDetailsDraft((previous) => ({ ...previous, [field]: value as DetailDraft[K] }));
    };

  const handlePreApprovalChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeCurrencyInput(event.target.value);
    setDetailsDraft((previous) => ({ ...previous, preApprovalAmount: sanitized }));
  };

  const startEditingDetails = () => {
    setDetailsDraft(createDetailDraft(referral));
    setIsEditingDetails(true);
  };

  const cancelEditingDetails = () => {
    setDetailsDraft(createDetailDraft(referral));
    setIsEditingDetails(false);
    setSavingDetails(false);
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
      const response = await fetch(`/api/referrals/${referralId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Unable to delete referral');
      }
      toast.success('Referral deleted');
      router.replace('/referrals');
      router.refresh();
      void mutate('/api/referrals?summary=true');
      void mutate('/api/referrals?leaderboard=true');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to delete referral');
    } finally {
      setDeleting(false);
    }
  };

  const handleDetailsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedDraft = normalizeDetailDraft(detailsDraft);
    const normalizedCurrent = normalizedCurrentDetails;
    const hasExistingPreApproval = Boolean(normalizedCurrent.preApprovalAmount);
    let preApprovalAmountValue: number | undefined;

    const standardFieldsChanged = DETAIL_FIELD_KEYS.some((field) => normalizedDraft[field] !== normalizedCurrent[field]);
    const createdAtChanged = viewerRole === 'admin' && normalizedDraft.createdAt !== normalizedCurrent.createdAt;
    
    if (!standardFieldsChanged && !createdAtChanged) {
      toast.info('No changes to save');
      setIsEditingDetails(false);
      return;
    }

    if (!normalizedDraft.loanFileNumber && !isAgentOrigin) {
      toast.error('Loan file number is required.');
      return;
    }
    if (!isAgentOrigin && !normalizedDraft.endorser) {
      toast.error('Endorser is required.');
      return;
    }
    const parsedZips = parseZipList(normalizedDraft.lookingInZip);
    if (parsedZips.length === 0) {
      toast.error('Add at least one 5-digit ZIP code.');
      return;
    }
    if (!normalizedDraft.borrowerCurrentAddress) {
      toast.error('Borrower current address is required.');
      return;
    }
    if (!normalizedDraft.stageOnTransfer) {
      toast.error('Stage on transfer is required.');
      return;
    }

    if (normalizedDraft.preApprovalAmount) {
      preApprovalAmountValue = Number.parseFloat(normalizedDraft.preApprovalAmount);
      if (Number.isNaN(preApprovalAmountValue) || preApprovalAmountValue < 0) {
        toast.error('Enter a valid pre-approval amount.');
        return;
      }
    } else if (hasExistingPreApproval) {
      preApprovalAmountValue = 0;
    }

    const payload: Record<string, unknown> = {};
    DETAIL_FIELD_KEYS.forEach((field) => {
      if (normalizedDraft[field] !== normalizedCurrent[field]) {
        if (field === 'preApprovalAmount') {
          payload.preApprovalAmount = preApprovalAmountValue;
        } else {
          payload[field] = normalizedDraft[field];
        }
      }
    });

    // Handle createdAt separately - only for admin users
    if (viewerRole === 'admin' && createdAtChanged) {
      const isoDate = dateTimeLocalToISO(normalizedDraft.createdAt);
      if (isoDate) {
        payload.createdAt = isoDate;
      }
    }

    if (payload.lookingInZip) {
      payload.lookingInZips = parsedZips;
      payload.lookingInZip = parsedZips[0];
    }

    if (isAgentOrigin) {
      delete payload.source;
      delete payload.endorser;
    }

    if (Object.keys(payload).length === 0) {
      toast.info('No changes to save');
      setIsEditingDetails(false);
      return;
    }

    setSavingDetails(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => undefined)) as
          | { error?: unknown }
          | undefined;
        let message = 'Unable to update referral details';
        if (errorBody) {
          if (typeof errorBody.error === 'string') {
            message = errorBody.error;
          } else if (
            errorBody.error &&
            typeof errorBody.error === 'object' &&
            errorBody.error !== null &&
            'fieldErrors' in errorBody.error
          ) {
            const fieldErrors = (errorBody.error as {
              fieldErrors?: Record<string, string[]>;
            }).fieldErrors;
            if (fieldErrors) {
              const firstField = Object.keys(fieldErrors)[0];
              if (firstField && Array.isArray(fieldErrors[firstField]) && fieldErrors[firstField].length > 0) {
                message = fieldErrors[firstField][0];
              }
            }
            if (
              message === 'Unable to update referral details' &&
              'formErrors' in (errorBody.error as Record<string, unknown>)
            ) {
              const candidateFormErrors = (errorBody.error as Record<string, unknown>).formErrors;
              const formErrors = Array.isArray(candidateFormErrors) ? candidateFormErrors : undefined;
              if (formErrors?.length) {
                const first = formErrors[0];
                if (typeof first === 'string') {
                  message = first;
                }
              }
            }
          }
        }
        throw new Error(message);
      }

      const updatedReferral = (await response.json().catch(() => undefined)) as ReferralDetail | undefined;

      setReferral((previous) => {
        const baseUpdate = {
          ...previous,
          loanFileNumber: normalizedDraft.loanFileNumber,
          source: normalizedDraft.source,
          endorser: normalizedDraft.endorser,
          clientType: normalizedDraft.clientType,
          lookingInZip: parsedZips[0] ?? '',
          lookingInZips: parsedZips,
          borrowerCurrentAddress: normalizedDraft.borrowerCurrentAddress,
          stageOnTransfer: normalizedDraft.stageOnTransfer,
          loanType: normalizedDraft.loanType,
          timeline: normalizedDraft.timeline,
          preApprovalAmountCents:
            preApprovalAmountValue === undefined
              ? previous.preApprovalAmountCents
              : Math.round(preApprovalAmountValue * 100),
          estPurchasePriceCents:
            preApprovalAmountValue === undefined
              ? previous.estPurchasePriceCents
              : Math.round(preApprovalAmountValue * 100),
        };

        // Update createdAt from response if it was changed
        if (createdAtChanged) {
          if (updatedReferral?.createdAt) {
            // API response will have createdAt as ISO string after JSON serialization
            const responseCreatedAt = updatedReferral.createdAt;
            if (typeof responseCreatedAt === 'string') {
              baseUpdate.createdAt = responseCreatedAt;
            } else {
              // Fallback: try to parse as date (shouldn't happen with JSON, but just in case)
              try {
                baseUpdate.createdAt = new Date(responseCreatedAt as unknown as string | number | Date).toISOString();
              } catch {
                // If response parsing fails, use the ISO date we sent
                const isoDate = dateTimeLocalToISO(normalizedDraft.createdAt);
                if (isoDate) {
                  baseUpdate.createdAt = isoDate;
                }
              }
            }
          } else {
            // If response doesn't include createdAt, use the ISO date we sent
            const isoDate = dateTimeLocalToISO(normalizedDraft.createdAt);
            if (isoDate) {
              baseUpdate.createdAt = isoDate;
            }
          }
        }

        return baseUpdate;
      });
      
      // Update details draft with the normalized draft (which includes updated createdAt)
      setDetailsDraft(normalizedDraft);
      setIsEditingDetails(false);
      toast.success('Referral details updated');
      
      // Mutate activity feed in background
      void mutate(activityFeedKey);
      
      // Delay router.refresh() slightly to allow state update to render first
      // This prevents the flicker of old data before new data loads
      // Use startTransition to prevent navigation blocking
      setTimeout(() => {
        startTransition(() => {
          router.refresh();
        });
      }, 100);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update referral details');
    } finally {
      setSavingDetails(false);
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
    propertyCity?: string;
    propertyState?: string;
    propertyPostalCode?: string;
    statusLastUpdated?: string;
    daysInStatus?: number;
    dealSide?: 'buy' | 'sell';
  }) => {
    const statusChanged = snapshot.status !== financials.status;
    const preApprovalChanged =
      snapshot.preApprovalAmountCents !== undefined &&
      snapshot.preApprovalAmountCents !== financials.preApprovalAmountCents;
    const contractValueChanged =
      snapshot.contractPriceCents !== undefined &&
      snapshot.contractPriceCents !== financials.contractPriceCents;
    const referralFeeChanged =
      snapshot.referralFeeDueCents !== undefined &&
      snapshot.referralFeeDueCents !== financials.referralFeeDueCents;
    const commissionChanged =
      snapshot.commissionBasisPoints !== undefined &&
      snapshot.commissionBasisPoints !== financials.commissionBasisPoints;
    const referralFeeBasisChanged =
      snapshot.referralFeeBasisPoints !== undefined &&
      snapshot.referralFeeBasisPoints !== financials.referralFeeBasisPoints;
    const dealSideChanged =
      snapshot.dealSide !== undefined && snapshot.dealSide !== financials.dealSide;
    const propertyFieldsTouched =
      snapshot.propertyAddress !== undefined ||
      snapshot.propertyCity !== undefined ||
      snapshot.propertyState !== undefined ||
      snapshot.propertyPostalCode !== undefined;
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
        propertyCity:
          snapshot.propertyCity !== undefined
            ? snapshot.propertyCity ?? undefined
            : previous.propertyCity,
        propertyState:
          snapshot.propertyState !== undefined
            ? snapshot.propertyState
              ? snapshot.propertyState.toUpperCase()
              : undefined
            : previous.propertyState,
        propertyPostalCode:
          snapshot.propertyPostalCode !== undefined
            ? snapshot.propertyPostalCode ?? undefined
            : previous.propertyPostalCode,
        dealSide:
          snapshot.dealSide !== undefined
            ? snapshot.dealSide
            : previous.dealSide,
      };

      if (
        next.status === previous.status &&
        next.preApprovalAmountCents === previous.preApprovalAmountCents &&
        next.contractPriceCents === previous.contractPriceCents &&
        next.referralFeeDueCents === previous.referralFeeDueCents &&
        next.commissionBasisPoints === previous.commissionBasisPoints &&
        next.referralFeeBasisPoints === previous.referralFeeBasisPoints &&
        next.propertyAddress === previous.propertyAddress &&
        next.propertyCity === previous.propertyCity &&
        next.propertyState === previous.propertyState &&
        next.propertyPostalCode === previous.propertyPostalCode &&
        next.dealSide === previous.dealSide
      ) {
        return previous;
      }

      return next;
    });

    const shouldRefreshActivityFeed = Boolean(
      snapshot.statusLastUpdated || snapshot.daysInStatus !== undefined
    );
    if (
      shouldRefreshActivityFeed &&
      (statusChanged || snapshot.statusLastUpdated || snapshot.daysInStatus !== undefined)
    ) {
      void mutate(activityFeedKey);
    }

    const propertyChanged =
      snapshot.propertyAddress !== undefined ||
      snapshot.propertyCity !== undefined ||
      snapshot.propertyState !== undefined ||
      snapshot.propertyPostalCode !== undefined;

    if (statusChanged || snapshot.statusLastUpdated || snapshot.daysInStatus !== undefined || propertyChanged) {
      setReferral((previous) => {
        const statusLastUpdated = snapshot.statusLastUpdated ?? previous.statusLastUpdated ?? null;
        const daysInStatus =
          snapshot.daysInStatus !== undefined ? snapshot.daysInStatus : previous.daysInStatus;

        const nextStatusValue = snapshot.status ?? previous.status;
        const nextPropertyAddress =
          snapshot.propertyAddress !== undefined
            ? snapshot.propertyAddress ?? previous.propertyAddress ?? null
            : previous.propertyAddress ?? null;
        const nextPropertyCity =
          snapshot.propertyCity !== undefined
            ? snapshot.propertyCity ?? previous.propertyCity ?? null
            : previous.propertyCity ?? null;
        const nextPropertyState =
          snapshot.propertyState !== undefined
            ? snapshot.propertyState
              ? snapshot.propertyState.toUpperCase()
              : null
            : previous.propertyState
            ? String(previous.propertyState).toUpperCase()
            : null;
        const nextPropertyPostal =
          snapshot.propertyPostalCode !== undefined
            ? snapshot.propertyPostalCode ?? previous.propertyPostalCode ?? null
            : previous.propertyPostalCode ?? null;
        const nextDealSide =
          snapshot.dealSide !== undefined
            ? snapshot.dealSide
            : previous.dealSide === 'sell' || previous.dealSide === 'buy'
            ? previous.dealSide
            : 'buy';

        if (
          previous.status === nextStatusValue &&
          previous.statusLastUpdated === statusLastUpdated &&
          previous.daysInStatus === daysInStatus &&
          (previous.propertyAddress ?? null) === nextPropertyAddress &&
          (previous.propertyCity ?? null) === nextPropertyCity &&
          (previous.propertyState ? String(previous.propertyState).toUpperCase() : null) === nextPropertyState &&
          (previous.propertyPostalCode ?? null) === nextPropertyPostal &&
          previous.dealSide === nextDealSide
        ) {
          return previous;
        }

        return {
          ...previous,
          status: nextStatusValue,
          statusLastUpdated,
          daysInStatus,
          propertyAddress: nextPropertyAddress ?? undefined,
          propertyCity: nextPropertyCity ?? undefined,
          propertyState: nextPropertyState ?? undefined,
          propertyPostalCode: nextPropertyPostal ?? undefined,
          dealSide: nextDealSide,
        };
      });
    }
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
    propertyCity: financials.propertyCity ?? referral.propertyCity,
    propertyState: financials.propertyState ?? referral.propertyState,
    propertyPostalCode: financials.propertyPostalCode ?? referral.propertyPostalCode,
    dealSide: financials.dealSide ?? referral.dealSide ?? 'buy',
  };

  const referralDeals = useMemo(
    () =>
      Array.isArray(referral.payments)
        ? [...referral.payments].sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
          })
        : [],
    [referral.payments]
  );

  return (
    <div className="space-y-8">
      <ReferralHeader
        referral={headerReferral}
        viewerRole={viewerRole}
        onFinancialsChange={handleFinancialsChange}
        buySideAgentContact={buySideAgentContact}
        sellSideAgentContact={sellSideAgentContact}
        mcContact={mcContact}
        onBuySideAgentContactChange={handleBuySideAgentContactChange}
        onSellSideAgentContactChange={handleSellSideAgentContactChange}
        onMcContactChange={handleMcContactChange}
      />
      <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Referral details</h2>
            <p className="text-xs text-slate-500">Key context provided at intake.</p>
          </div>
          {canEditDetails && !isEditingDetails && (
            <button
              type="button"
              onClick={startEditingDetails}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Edit details
            </button>
          )}
        </div>
        {isEditingDetails ? (
          <form onSubmit={handleDetailsSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Loan File #</span>
                <input
                  name="loanFileNumber"
                  value={detailsDraft.loanFileNumber}
                  onChange={handleDetailInputChange('loanFileNumber')}
                  required
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Loan Type</span>
                <input
                  name="loanType"
                  value={detailsDraft.loanType}
                  onChange={handleDetailInputChange('loanType')}
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Pre-approval Amount</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                    $
                  </span>
                  <input
                    name="preApprovalAmount"
                    value={formatCurrencyInputDisplay(detailsDraft.preApprovalAmount)}
                    onChange={handlePreApprovalChange}
                    disabled={savingDetails}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 pl-7 text-sm shadow-sm focus:border-brand focus:outline-none"
                    inputMode="decimal"
                    placeholder="300,000"
                  />
                </div>
              </label>
              {!isAgentOrigin && (
                <>
                  <label className="space-y-1 text-sm font-medium text-slate-600">
                    <span>Source</span>
                    <input
                      name="source"
                      value={detailsDraft.source}
                      onChange={handleDetailInputChange('source')}
                      disabled={savingDetails}
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-600">
                    <span>Endorser</span>
                    <input
                      name="endorser"
                      value={detailsDraft.endorser}
                      onChange={handleDetailInputChange('endorser')}
                      disabled={savingDetails}
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                    />
                  </label>
                </>
              )}
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Client Type</span>
                <select
                  name="clientType"
                  value={detailsDraft.clientType}
                  onChange={handleDetailInputChange('clientType')}
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                >
                  <option value="Buyer">Buyer</option>
                  <option value="Seller">Seller</option>
                  <option value="Both">Both</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Looking In (Zip)</span>
                <input
                  name="lookingInZip"
                  value={detailsDraft.lookingInZip}
                  onChange={handleDetailInputChange('lookingInZip')}
                  required
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Stage on Transfer</span>
                <select
                  name="stageOnTransfer"
                  value={detailsDraft.stageOnTransfer}
                  onChange={handleDetailInputChange('stageOnTransfer')}
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                >
                  <option value="Pre-approval TBD">Pre-approval TBD</option>
                  <option value="Pre-approved">Pre-approved</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Timeline</span>
                <select
                  name="timeline"
                  value={detailsDraft.timeline}
                  onChange={handleDetailInputChange('timeline')}
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                >
                  {REFERRAL_TIMELINE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {viewerRole === 'admin' && (
                <label className="space-y-1 text-sm font-medium text-slate-600">
                  <span>Created Date</span>
                  <input
                    type="datetime-local"
                    name="createdAt"
                    value={detailsDraft.createdAt}
                    onChange={handleDetailInputChange('createdAt')}
                    disabled={savingDetails}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                  />
                </label>
              )}
              <label className="space-y-1 text-sm font-medium text-slate-600 sm:col-span-2 lg:col-span-3">
                <span>Borrower Current Address</span>
                <input
                  name="borrowerCurrentAddress"
                  value={detailsDraft.borrowerCurrentAddress}
                  onChange={handleDetailInputChange('borrowerCurrentAddress')}
                  required
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                />
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelEditingDetails}
                disabled={savingDetails}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingDetails || !detailsChanged}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
              >
                {savingDetails ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Loan File #</dt>
              <dd className="text-sm font-semibold text-slate-900">{referral.loanFileNumber || '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Loan Type</dt>
              <dd className="text-sm text-slate-700">{referral.loanType?.trim() ? referral.loanType : '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Pre-approval Amount</dt>
              <dd className="text-sm text-slate-700">
                {referral.preApprovalAmountCents ? formatCurrency(referral.preApprovalAmountCents) : '—'}
              </dd>
            </div>
            {!isAgentOrigin && (
              <>
                <div className="space-y-1">
                  <dt className="text-xs uppercase text-slate-500">Source</dt>
                  <dd className="text-sm text-slate-700">{referral.source ?? '—'}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase text-slate-500">Endorser</dt>
                  <dd className="text-sm text-slate-700">{referral.endorser?.trim() ? referral.endorser : '—'}</dd>
                </div>
              </>
            )}
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Client Type</dt>
              <dd className="text-sm text-slate-700">{referral.clientType ?? '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Looking In (Zip)</dt>
              <dd className="text-sm text-slate-700">{lookingInZipDisplay ? lookingInZipDisplay : '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Stage on Transfer</dt>
              <dd className="text-sm text-slate-700">{referral.stageOnTransfer?.trim() ? referral.stageOnTransfer : '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Timeline</dt>
              <dd className="text-sm text-slate-700">
                {referral.timeline && REFERRAL_TIMELINE_OPTIONS.find((opt) => opt.value === referral.timeline)
                  ? REFERRAL_TIMELINE_OPTIONS.find((opt) => opt.value === referral.timeline)?.label
                  : '—'}
              </dd>
            </div>
            {viewerRole === 'admin' && (
              <div className="space-y-1">
                <dt className="text-xs uppercase text-slate-500">Created Date</dt>
                <dd className="text-sm text-slate-700">{formatDate(referral.createdAt)}</dd>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <dt className="text-xs uppercase text-slate-500">Borrower Current Address</dt>
              <dd className="text-sm text-slate-700">
                {referral.borrowerCurrentAddress?.trim() ? referral.borrowerCurrentAddress : '—'}
              </dd>
            </div>
          </dl>
        )}
      </section>
      <ReferralNotes
        referralId={referralId}
        initialNotes={notes}
        viewerRole={viewerRole}
        agentContact={{
          name: primaryAgentContact?.name ?? null,
          email: primaryAgentContact?.email ?? null
        }}
        mcContact={{
          name: mcContact?.name ?? null,
          email: mcContact?.email ?? null
        }}
        adminContacts={referral.adminContacts ?? []}
      />
      <ReferralDeals
        referralId={referralId}
        deals={referralDeals}
        onDealCreated={handleDealCreated}
        onDealUpdated={handleDealUpdated}
        onDealDeleted={handleDealDeleted}
        viewerRole={viewerRole}
        referralOrigin={referral.origin}
      />
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
