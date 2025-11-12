'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ComponentProps, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';

import { ReferralHeader } from '@/components/referrals/referral-header';
import { ReferralNotes } from '@/components/referrals/referral-notes';
import { ReferralTimeline } from '@/components/referrals/referral-timeline';
import { DealCard } from '@/components/referrals/deal-card';
import type {
  AgentSelectValue,
  DealStatus,
  TerminatedReason
} from '@/components/referrals/deal-card';
import type { Contact } from '@/components/referrals/contact-assignment';
import type { ReferralStatus } from '@/constants/referrals';
import { ReferralFollowUpCard } from '@/components/referrals/referral-follow-up-card';

type ReferralSource = 'Lender' | 'MC';
type ReferralClientType = 'Seller' | 'Buyer';

interface ReferralContact {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface ReferralPayment {
  _id: string;
  status?: string | null;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  invoiceDate?: string | null;
  paidDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  terminatedReason?: string | null;
  agentAttribution?: string | null;
  usedAfc?: boolean;
}

interface ReferralDetailNote {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  hiddenFromAgent?: boolean;
  hiddenFromMc?: boolean;
  emailedTargets?: ('agent' | 'mc')[];
}

interface ReferralDetail {
  _id: string;
  loanFileNumber: string;
  source?: ReferralSource | null;
  endorser?: string | null;
  clientType?: ReferralClientType | null;
  lookingInZip?: string | null;
  borrowerCurrentAddress?: string | null;
  stageOnTransfer?: string | null;
  initialNotes?: string | null;
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
  propertyAddress?: string;
  assignedAgent?: ReferralContact | null;
  lender?: ReferralContact | null;
  payments?: ReferralPayment[];
  notes?: ReferralDetailNote[];
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  viewerRole?: string;
  ahaBucket?: 'AHA' | 'AHA_OOS' | '' | null;
  org?: string;
  audit?: unknown[];
  [key: string]: unknown;
}

interface ReferralDetailClientProps {
  referral: ReferralDetail;
  viewerRole: string;
  notes: ReferralDetailNote[];
  referralId: string;
}

type DealCardProps = ComponentProps<typeof DealCard>;
type DealCardReferral = DealCardProps['referral'];
type DealCardDeal = NonNullable<DealCardReferral['payments']>[number];
type DealCardOverrides = DealCardProps['overrides'];

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

interface DetailDraft {
  loanFileNumber: string;
  source: ReferralSource;
  endorser: string;
  clientType: ReferralClientType;
  lookingInZip: string;
  borrowerCurrentAddress: string;
  stageOnTransfer: string;
  initialNotes: string;
}

const DETAIL_FIELD_KEYS: (keyof DetailDraft)[] = [
  'loanFileNumber',
  'source',
  'endorser',
  'clientType',
  'lookingInZip',
  'borrowerCurrentAddress',
  'stageOnTransfer',
  'initialNotes',
];

const ensureString = (value: unknown) => (typeof value === 'string' ? value : '');

const normalizeSource = (value: unknown): ReferralSource => (value === 'Lender' ? 'Lender' : 'MC');

const normalizeClientType = (value: unknown): ReferralClientType => (value === 'Seller' ? 'Seller' : 'Buyer');

const createDetailDraft = (referral: ReferralDetail): DetailDraft => ({
  loanFileNumber: ensureString(referral?.loanFileNumber),
  source: normalizeSource(referral?.source),
  endorser: ensureString(referral?.endorser),
  clientType: normalizeClientType(referral?.clientType),
  lookingInZip: ensureString(referral?.lookingInZip),
  borrowerCurrentAddress: ensureString(referral?.borrowerCurrentAddress),
  stageOnTransfer: ensureString(referral?.stageOnTransfer),
  initialNotes: ensureString(referral?.initialNotes),
});

const normalizeDetailDraft = (draft: DetailDraft): DetailDraft => ({
  loanFileNumber: draft.loanFileNumber.trim(),
  source: draft.source,
  endorser: draft.endorser.trim(),
  clientType: draft.clientType,
  lookingInZip: draft.lookingInZip.trim(),
  borrowerCurrentAddress: draft.borrowerCurrentAddress.trim(),
  stageOnTransfer: draft.stageOnTransfer.trim(),
  initialNotes: draft.initialNotes.trim(),
});

const normalizeDealPayments = (
  payments: ReferralPayment[] | undefined
): DealCardReferral['payments'] => {
  if (!Array.isArray(payments)) {
    return null;
  }

  return payments.map<DealCardDeal>((payment) => ({
    _id: payment._id,
    status: (payment.status as DealStatus | undefined) ?? null,
    expectedAmountCents: payment.expectedAmountCents ?? null,
    receivedAmountCents: payment.receivedAmountCents ?? null,
    createdAt: payment.createdAt ?? null,
    updatedAt: payment.updatedAt ?? null,
    paidDate: payment.paidDate ?? null,
    terminatedReason: payment.terminatedReason
      ? (payment.terminatedReason as TerminatedReason)
      : null,
    agentAttribution: payment.agentAttribution as AgentSelectValue | undefined,
    usedAfc: payment.usedAfc ?? null,
  }));
};

export function ReferralDetailClient({ referral: initialReferral, viewerRole, notes, referralId }: ReferralDetailClientProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const activityFeedKey = `/api/referrals/${referralId}/activities`;
  const [referral, setReferral] = useState<ReferralDetail>(initialReferral);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<DetailDraft>(() => createDetailDraft(initialReferral));
  const [savingDetails, setSavingDetails] = useState(false);
  const [agentContact, setAgentContact] = useState<Contact | null>(() =>
    initialReferral.assignedAgent
      ? {
          id: initialReferral.assignedAgent._id ?? initialReferral.assignedAgent.id ?? null,
          name: initialReferral.assignedAgent.name ?? null,
          email: initialReferral.assignedAgent.email ?? null,
          phone: initialReferral.assignedAgent.phone ?? null,
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
  const [financials, setFinancials] = useState<FinancialState>({
    status: initialReferral.status,
    preApprovalAmountCents: initialReferral.preApprovalAmountCents ?? 0,
    contractPriceCents: initialReferral.estPurchasePriceCents ?? undefined,
    referralFeeDueCents: initialReferral.referralFeeDueCents ?? 0,
    commissionBasisPoints: initialReferral.commissionBasisPoints ?? undefined,
    referralFeeBasisPoints: initialReferral.referralFeeBasisPoints ?? undefined,
    propertyAddress: initialReferral.propertyAddress ?? undefined,
  });
  const [contractDraft, setContractDraft] = useState<DraftState>({ hasUnsavedChanges: false });
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
      referral.borrowerCurrentAddress,
      referral.stageOnTransfer,
      referral.initialNotes,
    ]
  );
  const detailsChanged = useMemo(
    () => DETAIL_FIELD_KEYS.some((field) => normalizedDetailDraft[field] !== normalizedCurrentDetails[field]),
    [normalizedDetailDraft, normalizedCurrentDetails]
  );

  const canDelete = viewerRole === 'admin' || viewerRole === 'manager';
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
    referral.borrowerCurrentAddress,
    referral.stageOnTransfer,
    referral.initialNotes,
  ]);

  useEffect(() => {
    setFinancials({
      status: referral.status,
      preApprovalAmountCents: referral.preApprovalAmountCents ?? 0,
      contractPriceCents: referral.estPurchasePriceCents ?? undefined,
      referralFeeDueCents: referral.referralFeeDueCents ?? 0,
      commissionBasisPoints: referral.commissionBasisPoints ?? undefined,
      referralFeeBasisPoints: referral.referralFeeBasisPoints ?? undefined,
      propertyAddress: referral.propertyAddress ?? undefined,
    });
  }, [
    referral.status,
    referral.preApprovalAmountCents,
    referral.estPurchasePriceCents,
    referral.referralFeeDueCents,
    referral.commissionBasisPoints,
    referral.referralFeeBasisPoints,
    referral.propertyAddress,
  ]);

  useEffect(() => {
    setAgentContact(
      referral.assignedAgent
        ? {
            id: referral.assignedAgent._id ?? referral.assignedAgent.id ?? null,
            name: referral.assignedAgent.name ?? null,
            email: referral.assignedAgent.email ?? null,
            phone: referral.assignedAgent.phone ?? null,
          }
        : null
    );
  }, [referral.assignedAgent]);

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
      router.push('/referrals');
      router.refresh();
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

    if (!DETAIL_FIELD_KEYS.some((field) => normalizedDraft[field] !== normalizedCurrent[field])) {
      toast.info('No changes to save');
      setIsEditingDetails(false);
      return;
    }

    if (!normalizedDraft.loanFileNumber) {
      toast.error('Loan file number is required.');
      return;
    }
    if (!normalizedDraft.endorser) {
      toast.error('Endorser is required.');
      return;
    }
    if (!normalizedDraft.lookingInZip || normalizedDraft.lookingInZip.length < 5) {
      toast.error('Looking in zip must be at least 5 characters.');
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

    const payload: Record<string, unknown> = {};
    DETAIL_FIELD_KEYS.forEach((field) => {
      if (normalizedDraft[field] !== normalizedCurrent[field]) {
        payload[field] = normalizedDraft[field];
      }
    });

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

      await response.json().catch(() => undefined);

      setReferral((previous) => ({
        ...previous,
        loanFileNumber: normalizedDraft.loanFileNumber,
        source: normalizedDraft.source,
        endorser: normalizedDraft.endorser,
        clientType: normalizedDraft.clientType,
        lookingInZip: normalizedDraft.lookingInZip,
        borrowerCurrentAddress: normalizedDraft.borrowerCurrentAddress,
        stageOnTransfer: normalizedDraft.stageOnTransfer,
        initialNotes: normalizedDraft.initialNotes,
      }));
      setDetailsDraft(normalizedDraft);
      setIsEditingDetails(false);
      toast.success('Referral details updated');
      void mutate(activityFeedKey);
      router.refresh();
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
    statusLastUpdated?: string;
    daysInStatus?: number;
  }) => {
    const statusChanged = snapshot.status !== financials.status;
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

    if (statusChanged) {
      void mutate(activityFeedKey);
    }

    if (statusChanged || snapshot.statusLastUpdated || snapshot.daysInStatus !== undefined) {
      setReferral((previous) => {
        const statusLastUpdated = snapshot.statusLastUpdated ?? previous.statusLastUpdated ?? null;
        const daysInStatus =
          snapshot.daysInStatus !== undefined ? snapshot.daysInStatus : previous.daysInStatus;

        if (
          previous.status === snapshot.status &&
          previous.statusLastUpdated === statusLastUpdated &&
          previous.daysInStatus === daysInStatus
        ) {
          return previous;
        }

        return {
          ...previous,
          status: snapshot.status ?? previous.status,
          statusLastUpdated,
          daysInStatus,
        };
      });
    }
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

  const dealReferral: DealCardReferral = {
    _id: referral._id,
    propertyAddress: financials.propertyAddress ?? referral.propertyAddress ?? undefined,
    lookingInZip: referral.lookingInZip ?? null,
    referralFeeDueCents: financials.referralFeeDueCents ?? referral.referralFeeDueCents ?? null,
    payments: normalizeDealPayments(referral.payments),
    ahaBucket:
      referral.ahaBucket === null || referral.ahaBucket === undefined
        ? null
        : (referral.ahaBucket as AgentSelectValue),
  };

  const dealOverrides: DealCardOverrides = contractDraft.hasUnsavedChanges
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

  const dealPayments = dealReferral.payments ?? [];
  const hasTerminatedDeal = dealPayments.some((payment) => payment.status === 'terminated');
  const hasAnyDeals = dealPayments.length > 0;

  const showDeals =
    financials.status === 'Under Contract' || contractDraft.hasUnsavedChanges || hasTerminatedDeal || hasAnyDeals;

  const followUpReferral = useMemo(
    () => ({
      _id: referral._id,
      createdAt: referral.createdAt,
      status: financials.status,
      statusLastUpdated: referral.statusLastUpdated,
      daysInStatus: referral.daysInStatus,
      assignedAgent: agentContact?.name
        ? { name: agentContact.name }
        : referral.assignedAgent?.name
        ? { name: referral.assignedAgent.name }
        : null,
      assignedAgentName: agentContact?.name ?? referral.assignedAgent?.name,
      borrower: referral.borrower,
      notes: referral.notes ?? [],
      payments: referral.payments ?? [],
      audit: referral.audit ?? [],
    }),
    [
      agentContact?.name,
      financials.status,
      referral._id,
      referral.audit,
      referral.borrower,
      referral.createdAt,
      referral.daysInStatus,
      referral.notes,
      referral.payments,
      referral.statusLastUpdated,
      referral.assignedAgent?.name,
    ]
  );

  return (
    <div className="space-y-8">
      <ReferralHeader
        referral={headerReferral}
        viewerRole={viewerRole}
        onFinancialsChange={handleFinancialsChange}
        onContractDraftChange={handleDraftChange}
        agentContact={agentContact}
        mcContact={mcContact}
        onAgentContactChange={setAgentContact}
        onMcContactChange={setMcContact}
      />
      <ReferralFollowUpCard referral={followUpReferral} />
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
                <span>Source</span>
                <select
                  name="source"
                  value={detailsDraft.source}
                  onChange={handleDetailInputChange('source')}
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                >
                  <option value="MC">MC</option>
                  <option value="Lender">Lender</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-600">
                <span>Endorser</span>
                <input
                  name="endorser"
                  value={detailsDraft.endorser}
                  onChange={handleDetailInputChange('endorser')}
                  required
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                />
              </label>
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
                <input
                  name="stageOnTransfer"
                  value={detailsDraft.stageOnTransfer}
                  onChange={handleDetailInputChange('stageOnTransfer')}
                  required
                  disabled={savingDetails}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
                />
              </label>
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
              <label className="space-y-1 text-sm font-medium text-slate-600 sm:col-span-2 lg:col-span-3">
                <span>Notes</span>
                <textarea
                  name="initialNotes"
                  value={detailsDraft.initialNotes}
                  onChange={handleDetailInputChange('initialNotes')}
                  rows={3}
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
              <dt className="text-xs uppercase text-slate-500">Source</dt>
              <dd className="text-sm text-slate-700">{referral.source ?? '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Endorser</dt>
              <dd className="text-sm text-slate-700">{referral.endorser?.trim() ? referral.endorser : '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Client Type</dt>
              <dd className="text-sm text-slate-700">{referral.clientType ?? '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Looking In (Zip)</dt>
              <dd className="text-sm text-slate-700">{referral.lookingInZip?.trim() ? referral.lookingInZip : '—'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase text-slate-500">Stage on Transfer</dt>
              <dd className="text-sm text-slate-700">{referral.stageOnTransfer?.trim() ? referral.stageOnTransfer : '—'}</dd>
            </div>
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <dt className="text-xs uppercase text-slate-500">Borrower Current Address</dt>
              <dd className="text-sm text-slate-700">
                {referral.borrowerCurrentAddress?.trim() ? referral.borrowerCurrentAddress : '—'}
              </dd>
            </div>
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <dt className="text-xs uppercase text-slate-500">Notes</dt>
              <dd className="text-sm text-slate-700">{referral.initialNotes?.trim() ? referral.initialNotes : '—'}</dd>
            </div>
          </dl>
        )}
      </section>
      <ReferralNotes
        referralId={referralId}
        initialNotes={notes}
        viewerRole={viewerRole}
        agentContact={{
          name: agentContact?.name ?? null,
          email: agentContact?.email ?? null
        }}
        mcContact={{
          name: mcContact?.name ?? null,
          email: mcContact?.email ?? null
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
