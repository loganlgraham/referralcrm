'use client';

import {
  ReactNode,
  useMemo,
  useState,
  useTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
} from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Clock } from 'lucide-react';

import {
  REFERRAL_STATUSES,
  ReferralStatus,
  getLostReasonOptions,
  getReferralStatusLabel,
  type LostReason,
  type ReferralTimeline
} from '@/constants/referrals';
import { type DealStatus } from '@/constants/deals';
import { formatNumber, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { calculateTimelineDaysRemaining, formatTimelineCountdown } from '@/utils/timeline-countdown';
import { mapDealStatusToReferralStatusDisplay } from '@/lib/latest-deal-referral-status';
import type {
  ReferralCounterparty,
  ReferralLastActivity,
  ReferralLatestDeal
} from '@/lib/referral-activity';
import { confirmCloseStatusDate } from '@/components/referrals/status-date-confirmation-toast';
import { confirmReferralTermination } from '@/components/referrals/terminate-confirmation-toast';
import {
  collectUnderContractDeal,
  submitUnderContractDeal,
} from '@/components/referrals/deal-details-toast';
import { StatusPill } from '@/components/ui/status-pill';
import { AgentOriginMarker } from '@/components/referrals/agent-origin-marker';
import { Button } from '@/components/ui/button';

export interface ReferralRow {
  _id: string;
  createdAt: string;
  updatedAt?: string | null;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  endorser?: string;
  clientType: 'Seller' | 'Buyer' | 'Both';
  dealSide?: 'buy' | 'sell' | null;
  buyStatus?: ReferralStatus | null;
  sellStatus?: ReferralStatus | null;
  viewerAssignedSide?: 'buy' | 'sell' | null;
  lookingInZip: string;
  lookingInZips?: string[];
  borrowerCurrentAddress?: string;
  propertyAddress?: string;
  stageOnTransfer?: string;
  initialNotes?: string;
  loanFileNumber: string;
  loanType?: string;
  status: ReferralStatus;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  assignedAgentEmail?: string;
  assignedAgentPhone?: string;
  lenderName?: string;
  lenderEmail?: string;
  lenderPhone?: string;
  referralFeeDueCents?: number;
  preApprovalAmountCents?: number;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
  origin?: 'agent' | 'mc' | 'admin';
  timeline?: ReferralTimeline;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  hasAhaOosAgentAttached?: boolean;
  hasAhaDesignatedAgentAttached?: boolean;
  hasAhaAgentAttached?: boolean;
  urgentTaskCount?: number;
  autoUpdateRemindersEnabled?: boolean;
  hasAnyPayments?: boolean;
  hasAnyUsedAfcTrue?: boolean;
  needsUpdate?: boolean;
  statusChangedAt?: string | null;
  referredAt?: string | null;
  lastActivity?: ReferralLastActivity | null;
  latestDeal?: ReferralLatestDeal | null;
  counterparty?: ReferralCounterparty | null;
}

type TableMode = 'admin' | 'mc' | 'agent';

type DeliveryFailureReason = 'missing_configuration' | 'no_recipients' | 'unknown';

interface NoteActivityResponse {
  id: string;
  emailedTargets?: ('mc')[];
  deliveryFailed?: boolean;
  deliveryFailureReason?: DeliveryFailureReason;
}

type ReferralTableProps = {
  data: ReferralRow[] | undefined | null;
  mode: TableMode;
  showAgentOriginIndicator?: boolean;
  hideAgentColumn?: boolean;
  /** Below `md`, render stacked cards instead of a horizontal-scroll table (single subtree; no duplicate controls). */
  stackOnMobile?: boolean;
};

interface StatusSelectProps {
  referralId: string;
  value: ReferralStatus;
  dealStatusLabel?: string | null;
  defaultSide?: 'buy' | 'sell';
  side?: 'buy' | 'sell';
  compact?: boolean;
  roleMode?: TableMode;
  borrowerName?: string;
  /** Agent-created (agent→AFC) referrals collect no referral fee. */
  isAgentOrigin?: boolean;
  onStatusResolved?: (nextStatus: ReferralStatus) => void;
}

type StatusUpdateResponse = {
  status?: ReferralStatus | null;
  currentStatus?: ReferralStatus | null;
  deal?: {
    status?: DealStatus | null;
  } | null;
  error?:
    | string
    | {
        message?: string;
        general?: string[];
        status?: string[];
      };
};

const isReferralStatus = (value: unknown): value is ReferralStatus =>
  typeof value === 'string' && REFERRAL_STATUSES.includes(value as ReferralStatus);

const extractStatusErrorMessage = (payload: StatusUpdateResponse | null): string => {
  if (!payload?.error) {
    return 'Unable to update status';
  }

  if (typeof payload.error === 'string') {
    return payload.error;
  }

  const firstFieldError = payload.error.status?.[0] ?? payload.error.general?.[0];
  return payload.error.message ?? firstFieldError ?? 'Unable to update status';
};

function StatusSelect({
  referralId,
  value,
  dealStatusLabel,
  defaultSide = 'buy',
  side,
  roleMode,
  borrowerName = 'this referral',
  isAgentOrigin = false,
  onStatusResolved,
}: StatusSelectProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ReferralStatus>(value);
  const [loading, setLoading] = useState(false);
  const [pendingLostSelection, setPendingLostSelection] = useState(false);
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [hideDealStage, setHideDealStage] = useState(false);
  const lostReasonOptions = getLostReasonOptions({ isAgentOrigin });

  useEffect(() => {
    setStatus(value);
    setHideDealStage(false);
  }, [value]);

  const applyResolvedStatus = useCallback(
    (nextStatus: ReferralStatus) => {
      setStatus(nextStatus);
      onStatusResolved?.(nextStatus);
    },
    [onStatusResolved]
  );

  const resetLostPanel = () => {
    setPendingLostSelection(false);
    setLostReason('');
  };

  const openUnderContractDealModal = () => {
    void collectUnderContractDeal({
      defaultSide,
      isAgentOrigin,
      onSubmit: async (result) => {
        await submitUnderContractDeal(referralId, result, 'referral_table');
        applyResolvedStatus('Under Contract');
        router.refresh();
        toast.success('Deal saved and referral moved to Under Contract');
      },
    });
  };

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;
    let closingDateIso: string | undefined;

    if (nextStatus === 'Under Contract') {
      openUnderContractDealModal();
      return;
    }
    if (nextStatus === 'Terminated') {
      const confirmation = await confirmReferralTermination({
        borrowerName,
        isAgentOrigin,
      });
      if (!confirmation.confirmed || !confirmation.resolvedStatus || !confirmation.terminatedReason) {
        applyResolvedStatus(value);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(`/api/referrals/${referralId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: confirmation.resolvedStatus,
            source: 'referral_table',
            side,
            terminatedReason: confirmation.terminatedReason,
            lostReason: confirmation.resolvedStatus === 'Lost' ? confirmation.lostReason : null,
            terminateDeal: true,
          }),
        });
        const payload = (await response.json().catch(() => null)) as StatusUpdateResponse | null;
        if (!response.ok) {
          if (isReferralStatus(payload?.currentStatus)) {
            applyResolvedStatus(payload.currentStatus);
          } else {
            applyResolvedStatus(value);
          }
          toast.error(extractStatusErrorMessage(payload));
          router.refresh();
          return;
        }
        const resolved = isReferralStatus(payload?.status)
          ? payload.status
          : confirmation.resolvedStatus;
        applyResolvedStatus(resolved);
        setHideDealStage(true);
        toast.success('Referral status updated');
        router.refresh();
      } catch (error) {
        console.error(error);
        toast.error('Unable to update status');
        applyResolvedStatus(value);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (nextStatus === 'Lost') {
      // Keep the prior status in the select while collecting the loss reason.
      setPendingLostSelection(true);
      setLostReason('');
      return;
    }

    let closedUsedAfc: boolean | undefined;
    if (nextStatus === 'Closed' && roleMode === 'agent') {
      const askUsedAfc = side !== 'sell';
      const confirmation = await confirmCloseStatusDate({
        initialDateIso: null,
        canSendClosedEmails: false,
        defaultSendClosedEmails: false,
        canSendAgentNpsEmail: false,
        defaultSendAgentNpsEmail: false,
        showEmailPreference: false,
        askUsedAfc,
        defaultUsedAfc: true,
      });
      if (!confirmation.confirmed) {
        applyResolvedStatus(value);
        return;
      }
      closingDateIso = confirmation.closingDateIso;
      if (askUsedAfc && typeof confirmation.usedAfc === 'boolean') {
        closedUsedAfc = confirmation.usedAfc;
      }
    }

    applyResolvedStatus(nextStatus);
    setLoading(true);

    try {
      const response = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          source: 'referral_table',
          side,
          terminatedReason: null,
          closingDate: closingDateIso,
          sendClosedEmails: nextStatus === 'Closed' && roleMode === 'agent',
          sendAgentNpsEmail: nextStatus === 'Closed' && roleMode === 'agent',
          ...(typeof closedUsedAfc === 'boolean' ? { usedAfc: closedUsedAfc } : {}),
        })
      });

      const payload = (await response.json().catch(() => null)) as StatusUpdateResponse | null;
      if (!response.ok) {
        if (isReferralStatus(payload?.currentStatus)) {
          applyResolvedStatus(payload.currentStatus);
        } else {
          applyResolvedStatus(value);
        }
        toast.error(extractStatusErrorMessage(payload));
        router.refresh();
        return;
      }

      const dealMappedStatus = mapDealStatusToReferralStatusDisplay(payload?.deal?.status);
      if (dealMappedStatus) {
        applyResolvedStatus(dealMappedStatus);
      } else if (isReferralStatus(payload?.status)) {
        applyResolvedStatus(payload.status);
      } else {
        applyResolvedStatus(nextStatus);
      }
      toast.success('Referral status updated');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error('Unable to update status');
      applyResolvedStatus(value);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <select
        value={status}
        onChange={handleChange}
        disabled={loading}
        className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1 text-sm text-foreground-muted shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
      >
        {REFERRAL_STATUSES.map((item) => (
          <option key={item} value={item}>
            {getReferralStatusLabel(item, { isAgentOrigin })}
          </option>
        ))}
      </select>
      {pendingLostSelection && (
        <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-2">
          <label className="block text-xs font-semibold text-foreground-muted">
            Why was this lost?
            <select
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value as LostReason | '')}
              className="mt-1 w-full rounded-lg border border-border-strong/70 px-2 py-1 text-xs shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
              disabled={loading}
            >
              <option value="">Select reason</option>
              {lostReasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {!isAgentOrigin && (
            <p className="text-xs text-foreground-subtle">
              Losses that happened before the agent could reach the borrower are not counted against
              the agent.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-primary hover:bg-primary-hover px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
              disabled={loading}
              onClick={async () => {
                if (!lostReason) {
                  toast.error('Please choose why this referral was lost.');
                  return;
                }
                setLoading(true);
                try {
                  const response = await fetch(`/api/referrals/${referralId}/status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      status: 'Lost',
                      source: 'referral_table',
                      side,
                      lostReason,
                    }),
                  });
                  const payload = (await response.json().catch(() => null)) as StatusUpdateResponse | null;
                  if (!response.ok) {
                    if (isReferralStatus(payload?.currentStatus)) {
                      applyResolvedStatus(payload.currentStatus);
                    } else {
                      applyResolvedStatus(value);
                    }
                    toast.error(extractStatusErrorMessage(payload));
                    resetLostPanel();
                    router.refresh();
                    return;
                  }
                  const nextStatus = isReferralStatus(payload?.status) ? payload.status : 'Lost';
                  applyResolvedStatus(nextStatus);
                  resetLostPanel();
                  toast.success('Referral status updated');
                  router.refresh();
                } catch (error) {
                  console.error(error);
                  toast.error('Unable to update status');
                  applyResolvedStatus(value);
                  resetLostPanel();
                } finally {
                  setLoading(false);
                }
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="rounded-lg border border-border-strong/70 px-2 py-1 text-xs font-semibold text-foreground-muted"
              disabled={loading}
              onClick={() => {
                resetLostPanel();
                applyResolvedStatus(value);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!pendingLostSelection &&
        !hideDealStage &&
        dealStatusLabel &&
        dealStatusLabel !== status &&
        dealStatusLabel !== 'Terminated' && (
        <p className="text-xs text-foreground-subtle">Deal stage: {dealStatusLabel}</p>
      )}
    </div>
  );
}

function SideStatusPill({
  label,
  status,
  isAgentOrigin = false,
}: {
  label: string;
  status?: ReferralStatus | null;
  isAgentOrigin?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-2 py-1">
      <p className="text-eyebrow text-foreground-subtle">{label}</p>
      <p className="text-xs font-medium text-foreground-muted">
        {status ? getReferralStatusLabel(status, { isAgentOrigin }) : '—'}
      </p>
    </div>
  );
}

function NoteComposer({
  referralId,
  mcEmail,
}: {
  referralId: string;
  mcEmail?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const hasMcEmail = Boolean(mcEmail);
  const [emailMc, setEmailMc] = useState(() => hasMcEmail);

  const reset = () => {
    setNote('');
    setEmailMc(hasMcEmail);
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!note.trim()) {
      toast.error('Add a note before saving');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: note.trim(),
          emailTargets: emailMc && hasMcEmail ? ['mc'] : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save note');
      }

      const payload = (await response.json()) as NoteActivityResponse;
      const emailSummary =
        Array.isArray(payload.emailedTargets) && payload.emailedTargets.length > 0
          ? ' Email sent to MC.'
          : '';
      toast.success(`Note saved.${emailSummary}`.trim());

      if (payload.deliveryFailed && emailMc && hasMcEmail) {
        const message = (() => {
          switch (payload.deliveryFailureReason) {
            case 'missing_configuration':
              return 'Note saved, but email delivery is disabled. Set RESEND_API_KEY and EMAIL_FROM environment variables to enable email notifications.';
            case 'no_recipients':
              return 'Note saved, but no MC recipient with a valid email address was available.';
            default:
              return 'Note was saved, but the email could not be delivered.';
          }
        })();
        toast.error(message);
      }
      reset();
    } catch (error) {
      console.error(error);
      toast.error('Unable to save note');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-primary hover:underline"
      >
        Add note
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        className="w-full rounded-lg border border-border px-2 py-1 text-sm text-foreground-muted shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
        placeholder="Capture quick context for this referral"
        disabled={saving}
      />
      <button
        type="button"
        role="switch"
        aria-checked={emailMc}
        aria-label="Email MC"
        onClick={() => {
          if (!saving && hasMcEmail) {
            setEmailMc((prev) => !prev);
          }
        }}
        disabled={saving || !hasMcEmail}
        className={`inline-flex items-center gap-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          saving || !hasMcEmail
            ? 'cursor-not-allowed text-foreground-subtle'
            : 'cursor-pointer text-foreground-muted'
        }`}
      >
        <span
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
            saving || !hasMcEmail
              ? 'bg-surface-subtle'
              : emailMc
                ? 'bg-primary'
                : 'bg-surface-subtle'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface-raised shadow transition ${
              emailMc ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </span>
        <span>Email MC</span>
      </button>
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center rounded bg-primary px-3 py-1 font-semibold text-white shadow-sm transition hover:bg-primary-hover-dark disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="inline-flex items-center rounded-lg border border-border px-3 py-1 font-semibold text-foreground-muted transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AgentBothStatusCell({ row }: { row: ReferralRow }) {
  const assignedSide = row.viewerAssignedSide ?? 'buy';
  const isAgentOrigin = row.origin === 'agent';
  const [buyStatus, setBuyStatus] = useState<ReferralStatus>(row.buyStatus ?? row.status);
  const [sellStatus, setSellStatus] = useState<ReferralStatus>(row.sellStatus ?? row.status);

  useEffect(() => {
    setBuyStatus(row.buyStatus ?? row.status);
    setSellStatus(row.sellStatus ?? row.status);
  }, [row.buyStatus, row.sellStatus, row.status, row._id]);

  const assignedStatus = assignedSide === 'sell' ? sellStatus : buyStatus;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <SideStatusPill label="Buy" status={buyStatus} isAgentOrigin={isAgentOrigin} />
        <SideStatusPill label="Sell" status={sellStatus} isAgentOrigin={isAgentOrigin} />
      </div>
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-2">
        <p className="text-eyebrow mb-1 text-primary">My side: {assignedSide}</p>
        <StatusSelect
          referralId={row._id}
          value={assignedStatus}
          defaultSide={assignedSide}
          side={assignedSide}
          compact
          roleMode="agent"
          borrowerName={row.borrowerName}
          isAgentOrigin={isAgentOrigin}
          onStatusResolved={(nextStatus) => {
            if (assignedSide === 'sell') {
              setSellStatus(nextStatus);
              return;
            }
            setBuyStatus(nextStatus);
          }}
        />
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  'New Lead': 'New Lead',
  Paired: 'Paired',
  'In Communication': 'Communicating',
  'Active Lead': 'Active Lead',
  'Showing Homes': 'Active Lead',
  'Under Contract': 'Under Contract',
  Closed: 'Closed',
  Lost: 'Lost',
  Terminated: 'Terminated',
  'Past Inspection': 'Past Inspection',
  'Past Appraisal': 'Past Appraisal',
  'Clear to Close': 'Clear to Close',
  'Payment Sent': 'Payment Sent',
  'Payment Received': 'Payment Received'
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return <StatusPill kind="auto" status={status} label={label} />;
}

function normalizeStatusForSort({
  status,
  dealStatusLabel,
}: Pick<ReferralRow, 'status' | 'dealStatusLabel'>) {
  const label = dealStatusLabel ?? STATUS_LABELS[status] ?? status;
  return label.toLocaleLowerCase();
}

function SortButton({ 
  sortKey, 
  label, 
  currentSortBy, 
  currentSortDirection,
  onSortChange 
}: { 
  sortKey: string; 
  label: string;
  currentSortBy: string | null;
  currentSortDirection: 'asc' | 'desc' | null;
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
}) {
  const isActive = currentSortBy === sortKey;
  const direction = isActive ? currentSortDirection : null;
  const icon = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕';

  const handleClick = () => {
    if (isActive && direction === 'desc') {
      onSortChange(sortKey, 'asc');
    } else {
      onSortChange(sortKey, 'desc');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // Buttons don't inherit text-transform, so the eyebrow casing on the
      // header cell has to be restated here or sortable columns read title case.
      className="flex items-center gap-1 text-left uppercase"
    >
      <span>{label}</span>
      <span className="text-[10px] text-foreground-subtle">{icon}</span>
    </button>
  );
}

const sortableHeader = (
  label: string, 
  sortKey: string,
  currentSortBy: string | null,
  currentSortDirection: 'asc' | 'desc' | null,
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void
): ((props: { column: any }) => ReactNode) => () => (
  <SortButton 
    sortKey={sortKey} 
    label={label}
    currentSortBy={currentSortBy}
    currentSortDirection={currentSortDirection}
    onSortChange={onSortChange}
  />
);

function buildColumns(
  mode: TableMode,
  options: { 
    showAgentOriginIndicator?: boolean;
    hideAgentColumn?: boolean;
    currentSortBy?: string | null;
    currentSortDirection?: 'asc' | 'desc' | null;
    onSortChange?: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
    listParams?: string;
  } = {}
): ColumnDef<ReferralRow>[] {
  const { 
    showAgentOriginIndicator = false,
    hideAgentColumn = false,
    currentSortBy = null,
    currentSortDirection = null,
    onSortChange = () => {},
    listParams = '',
  } = options;

  const borrowerColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Borrower', 'borrowerName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'borrowerName',
    cell: ({ row }) => {
      const { _id, borrowerName, borrowerPhone, borrowerEmail, urgentTaskCount } = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={listParams ? `/referrals/${_id}?${listParams}` : `/referrals/${_id}`} className="font-medium text-primary">
              {borrowerName}
            </Link>
            {showAgentOriginIndicator && row.original.origin === 'agent' ? (
              <AgentOriginMarker size="sm" />
            ) : null}
            {mode === 'admin' && (urgentTaskCount ?? 0) > 0 ? (
              <span
                className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger"
                title={`${urgentTaskCount} overdue or due today`}
              >
                {urgentTaskCount}
              </span>
            ) : null}
          </div>
          {borrowerEmail && (
            <a
              href={buildGmailComposeUrl(borrowerEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Email
            </a>
          )}
          {borrowerPhone ? (
            <a
              href={`tel:${borrowerPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-primary hover:underline"
            >
              {formatPhoneNumber(borrowerPhone)}
            </a>
          ) : (
            <span className="text-xs text-foreground-subtle">—</span>
          )}
        </div>
      );
    }
  };

  const createdColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Created', 'createdAt', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'createdAt',
    cell: ({ row }) => (
      <span className="text-numeric">{new Date(row.original.createdAt).toLocaleDateString()}</span>
    ),
  };

  const lastUpdatedColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Last Updated', 'updatedAt', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'updatedAt',
    cell: ({ row }) => {
      const updatedAt = row.original.updatedAt;
      return (
        <span className="text-numeric">
          {updatedAt ? new Date(updatedAt).toLocaleDateString() : '—'}
        </span>
      );
    },
  };

  const renderTimelineCountdown = (row: ReferralRow) => {
    const daysRemaining = calculateTimelineDaysRemaining(row.timeline, row.createdAt);
    return formatTimelineCountdown(daysRemaining, row.timeline);
  };

  const timelineColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Timeline', 'timeline', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'timeline',
    cell: ({ row }) => renderTimelineCountdown(row.original),
  };

  const agentColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Agent', 'assignedAgentName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'assignedAgentName',
    cell: ({ row }) => {
      const { assignedAgentName, assignedAgentEmail, assignedAgentPhone, autoUpdateRemindersEnabled } = row.original;
      if (!assignedAgentName && !assignedAgentPhone && !assignedAgentEmail) {
        return 'Unassigned';
      }
      return (
        <div className="flex flex-col text-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground-muted">{assignedAgentName || 'Unassigned'}</span>
            {autoUpdateRemindersEnabled && (
              <span title="Auto reminders enabled">
                <Clock
                  className="h-3.5 w-3.5 text-foreground-subtle"
                  aria-label="Auto reminders enabled"
                />
              </span>
            )}
          </div>
          {assignedAgentEmail && (
            <a
              href={buildGmailComposeUrl(assignedAgentEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Email
            </a>
          )}
          {assignedAgentPhone && (
            <a
              href={`tel:${assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-primary hover:underline"
            >
              {formatPhoneNumber(assignedAgentPhone)}
            </a>
          )}
        </div>
      );
    }
  };

  const lenderMcColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Lender/MC', 'lenderName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'lenderName',
    cell: ({ row }) => {
      const { lenderName, lenderEmail, lenderPhone } = row.original;
      if (!lenderName && !lenderPhone && !lenderEmail) {
        return 'Pending';
      }
      return (
        <div className="flex flex-col text-sm">
          <span className="font-medium text-foreground-muted">{lenderName || 'Pending'}</span>
          {lenderEmail && (
            <a
              href={buildGmailComposeUrl(lenderEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Email
            </a>
          )}
          {lenderPhone && (
            <a
              href={`tel:${lenderPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-primary hover:underline"
            >
              {formatPhoneNumber(lenderPhone)}
            </a>
          )}
        </div>
      );
    }
  };

  if (mode === 'agent') {
    return [
      borrowerColumn,
      {
        header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'loanFileNumber',
        cell: ({ row }) => <span className="text-numeric">{row.original.loanFileNumber}</span>
      },
      timelineColumn,
      {
        header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'status',
        cell: ({ row }) => {
          if (row.original.clientType === 'Both') {
            return <AgentBothStatusCell row={row.original} />;
          }

          return (
            <StatusSelect
              referralId={row.original._id}
              value={row.original.status}
              dealStatusLabel={row.original.dealStatusLabel ?? null}
              side={row.original.viewerAssignedSide ?? undefined}
              defaultSide={row.original.viewerAssignedSide === 'sell' ? 'sell' : 'buy'}
              roleMode="agent"
              borrowerName={row.original.borrowerName}
              isAgentOrigin={row.original.origin === 'agent'}
            />
          );
        },
      },
      {
        header: 'Notes',
        id: 'notes',
        cell: ({ row }) => (
          <NoteComposer
            referralId={row.original._id}
            mcEmail={row.original.lenderEmail}
          />
        ),
        enableSorting: false,
      },
      lenderMcColumn,
      createdColumn,
      lastUpdatedColumn,
    ];
  }

  if (mode === 'mc') {
    return [
      borrowerColumn,
      {
        header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'loanFileNumber',
        cell: ({ row }) => <span className="text-numeric">{row.original.loanFileNumber}</span>
      },
      timelineColumn,
      {
        header: 'Agent Contact',
        id: 'agentContact',
        cell: ({ row }) => (
          <div className="flex flex-col text-sm">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground-muted">{row.original.assignedAgentName || 'Unassigned'}</span>
              {row.original.autoUpdateRemindersEnabled && (
                <span title="Auto reminders enabled">
                  <Clock
                    className="h-3.5 w-3.5 text-foreground-subtle"
                    aria-label="Auto reminders enabled"
                  />
                </span>
              )}
            </div>
            {row.original.assignedAgentEmail && (
              <a
                href={buildGmailComposeUrl(row.original.assignedAgentEmail)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                Email
              </a>
            )}
            {row.original.assignedAgentPhone && (
              <a
                href={`tel:${row.original.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                className="text-xs text-primary hover:underline"
              >
                {formatPhoneNumber(row.original.assignedAgentPhone)}
              </a>
            )}
          </div>
        )
      },
      {
        header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusBadge status={row.original.dealStatusLabel ?? row.original.status} />
        ),
      },
      createdColumn
    ];
  }

  const adminColumns: ColumnDef<ReferralRow>[] = [
    borrowerColumn,
    {
      header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'loanFileNumber',
      cell: ({ row }) => <span className="text-numeric">{row.original.loanFileNumber}</span>
    },
    timelineColumn,
    {
      header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.dealStatusLabel ?? row.original.status} />
      ),
    },
    ...(hideAgentColumn ? [] : [agentColumn]),
    lenderMcColumn,
    createdColumn,
    lastUpdatedColumn
  ];

  return adminColumns;
}

const MD_MIN_WIDTH_QUERY = '(min-width: 768px)';

function referralDetailHref(row: ReferralRow, listParams: string) {
  return listParams ? `/referrals/${row._id}?${listParams}` : `/referrals/${row._id}`;
}

function MobileField({
  label,
  numeric,
  children
}: {
  label: string;
  numeric?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-eyebrow text-foreground-subtle">{label}</p>
      <div className={clsx('text-sm text-foreground', numeric && 'text-numeric')}>{children}</div>
    </div>
  );
}

function ReferralMobileStack({
  rows,
  mode,
  listParams,
  showAgentOriginIndicator,
  hideAgentColumn,
}: {
  rows: ReferralRow[];
  mode: TableMode;
  listParams: string;
  showAgentOriginIndicator?: boolean;
  hideAgentColumn?: boolean;
}) {
  const showOrigin = showAgentOriginIndicator ?? false;
  const hideAgent = hideAgentColumn ?? false;

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const timelineText = formatTimelineCountdown(
          calculateTimelineDaysRemaining(row.timeline, row.createdAt),
          row.timeline
        );
        const href = referralDetailHref(row, listParams);

        if (mode === 'agent') {
          return (
            <div
              key={row._id}
              className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
            >
              {/* Header zone */}
              <div className={`bg-surface-muted px-4 pt-4 ${row.clientType === 'Both' ? 'pb-3' : 'pb-3'}`}>
                <div className={`flex ${row.clientType === 'Both' ? 'flex-col gap-3' : 'items-start justify-between gap-3'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={href} className="text-base font-semibold text-foreground break-words hover:text-primary-hover">
                        {row.borrowerName}
                      </Link>
                      {showOrigin && row.origin === 'agent' ? (
                        <AgentOriginMarker size="sm" />
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      {row.borrowerEmail ? (
                        <a
                          href={buildGmailComposeUrl(row.borrowerEmail)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Email
                        </a>
                      ) : null}
                      {row.borrowerPhone ? (
                        <a
                          href={`tel:${row.borrowerPhone.replace(/[^0-9+]/g, '')}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {formatPhoneNumber(row.borrowerPhone)}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className={row.clientType === 'Both' ? '' : 'shrink-0'}>
                    {row.clientType === 'Both' ? (
                      <AgentBothStatusCell row={row} />
                    ) : (
                      <StatusSelect
                        referralId={row._id}
                        value={row.status}
                        dealStatusLabel={row.dealStatusLabel ?? null}
                        side={row.viewerAssignedSide ?? undefined}
                        defaultSide={row.viewerAssignedSide === 'sell' ? 'sell' : 'buy'}
                        roleMode="agent"
                        borrowerName={row.borrowerName}
                        isAgentOrigin={row.origin === 'agent'}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Details zone */}
              <div className="px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <MobileField label="Loan file #" numeric>{row.loanFileNumber}</MobileField>
                  <MobileField label="Timeline">{timelineText}</MobileField>
                  <MobileField label="Lender / MC">
                    {!row.lenderName && !row.lenderPhone && !row.lenderEmail ? (
                      'Pending'
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground-muted">{row.lenderName || 'Pending'}</span>
                        {row.lenderEmail ? (
                          <a
                            href={buildGmailComposeUrl(row.lenderEmail)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline w-fit"
                          >
                            Email
                          </a>
                        ) : null}
                        {row.lenderPhone ? (
                          <a
                            href={`tel:${row.lenderPhone.replace(/[^0-9+]/g, '')}`}
                            className="text-xs text-primary hover:underline w-fit"
                          >
                            {formatPhoneNumber(row.lenderPhone)}
                          </a>
                        ) : null}
                      </div>
                    )}
                  </MobileField>
                  <MobileField label="Created" numeric>
                    {new Date(row.createdAt).toLocaleDateString()}
                  </MobileField>
                  <MobileField label="Last updated" numeric>
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}
                  </MobileField>
                </div>

                {/* Notes zone */}
                <div className="border-t border-border pt-3">
                  <MobileField label="Notes">
                    <NoteComposer referralId={row._id} mcEmail={row.lenderEmail} />
                  </MobileField>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            key={row._id}
            className="rounded-card border border-border bg-surface-raised p-4 shadow-card space-y-3"
          >
            <MobileField label="Borrower">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={href} className="font-medium text-primary break-words">
                    {row.borrowerName}
                  </Link>
                  {showOrigin && row.origin === 'agent' ? (
                    <AgentOriginMarker size="sm" />
                  ) : null}
                  {mode === 'admin' && (row.urgentTaskCount ?? 0) > 0 ? (
                    <span
                      className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger"
                      title={`${row.urgentTaskCount} overdue or due today`}
                    >
                      {row.urgentTaskCount}
                    </span>
                  ) : null}
                </div>
                {row.borrowerEmail ? (
                  <a
                    href={buildGmailComposeUrl(row.borrowerEmail)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline w-fit"
                  >
                    Email
                  </a>
                ) : null}
                {row.borrowerPhone ? (
                  <a
                    href={`tel:${row.borrowerPhone.replace(/[^0-9+]/g, '')}`}
                    className="text-xs text-primary hover:underline w-fit"
                  >
                    {formatPhoneNumber(row.borrowerPhone)}
                  </a>
                ) : (
                  <span className="text-xs text-foreground-subtle">—</span>
                )}
              </div>
            </MobileField>

            <MobileField label="Loan file #" numeric>{row.loanFileNumber}</MobileField>
            <MobileField label="Timeline">{timelineText}</MobileField>

            {mode === 'mc' ? (
              <>
                <MobileField label="Agent contact">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground-muted">
                        {row.assignedAgentName || 'Unassigned'}
                      </span>
                      {row.autoUpdateRemindersEnabled ? (
                        <span title="Auto reminders enabled">
                          <Clock className="h-3.5 w-3.5 text-foreground-subtle" aria-label="Auto reminders enabled" />
                        </span>
                      ) : null}
                    </div>
                    {row.assignedAgentEmail ? (
                      <a
                        href={buildGmailComposeUrl(row.assignedAgentEmail)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline w-fit"
                      >
                        Email
                      </a>
                    ) : null}
                    {row.assignedAgentPhone ? (
                      <a
                        href={`tel:${row.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                        className="text-xs text-primary hover:underline w-fit"
                      >
                        {formatPhoneNumber(row.assignedAgentPhone)}
                      </a>
                    ) : null}
                  </div>
                </MobileField>
                <MobileField label="Status">
                  <StatusBadge status={row.dealStatusLabel ?? row.status} />
                </MobileField>
                <MobileField label="Created" numeric>
                  {new Date(row.createdAt).toLocaleDateString()}
                </MobileField>
              </>
            ) : null}

            {mode === 'admin' ? (
              <>
                <MobileField label="Status">
                  <StatusBadge status={row.dealStatusLabel ?? row.status} />
                </MobileField>
                {!hideAgent ? (
                  <MobileField label="Agent">
                    {!row.assignedAgentName && !row.assignedAgentPhone && !row.assignedAgentEmail ? (
                      'Unassigned'
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground-muted">
                            {row.assignedAgentName || 'Unassigned'}
                          </span>
                          {row.autoUpdateRemindersEnabled ? (
                            <span title="Auto reminders enabled">
                              <Clock className="h-3.5 w-3.5 text-foreground-subtle" aria-label="Auto reminders enabled" />
                            </span>
                          ) : null}
                        </div>
                        {row.assignedAgentEmail ? (
                          <a
                            href={buildGmailComposeUrl(row.assignedAgentEmail)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline w-fit"
                          >
                            Email
                          </a>
                        ) : null}
                        {row.assignedAgentPhone ? (
                          <a
                            href={`tel:${row.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                            className="text-xs text-primary hover:underline w-fit"
                          >
                            {formatPhoneNumber(row.assignedAgentPhone)}
                          </a>
                        ) : null}
                      </div>
                    )}
                  </MobileField>
                ) : null}
                <MobileField label="Lender / MC">
                  {!row.lenderName && !row.lenderPhone && !row.lenderEmail ? (
                    'Pending'
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground-muted">{row.lenderName || 'Pending'}</span>
                      {row.lenderEmail ? (
                        <a
                          href={buildGmailComposeUrl(row.lenderEmail)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline w-fit"
                        >
                          Email
                        </a>
                      ) : null}
                      {row.lenderPhone ? (
                        <a
                          href={`tel:${row.lenderPhone.replace(/[^0-9+]/g, '')}`}
                          className="text-xs text-primary hover:underline w-fit"
                        >
                          {formatPhoneNumber(row.lenderPhone)}
                        </a>
                      ) : null}
                    </div>
                  )}
                </MobileField>
                <MobileField label="Created" numeric>
                  {new Date(row.createdAt).toLocaleDateString()}
                </MobileField>
                <MobileField label="Last updated" numeric>
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}
                </MobileField>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReferralTable({
  data,
  mode,
  showAgentOriginIndicator,
  hideAgentColumn,
  stackOnMobile = false,
}: ReferralTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);

  const currentSortBy = searchParams.get('sortBy');
  const currentSortDirection = (searchParams.get('sortDirection') as 'asc' | 'desc' | null) || null;

  const listParams = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    params.delete('page');
    params.delete('pageSize');
    return params.toString();
  }, [searchParamsString]);

  const handleSortChange = useCallback(
    (sortBy: string, sortDirection: 'asc' | 'desc') => {
      const params = new URLSearchParams(searchParamsString);
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);
      params.delete('page');
      startTransition(() => {
        const queryString = params.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname);
      });
    },
    [router, pathname, searchParamsString, startTransition]
  );

  const columns = useMemo<ColumnDef<ReferralRow>[]>(
    () => buildColumns(mode, { 
      showAgentOriginIndicator,
      hideAgentColumn,
      currentSortBy,
      currentSortDirection,
      onSortChange: handleSortChange,
      listParams,
    }),
    [mode, showAgentOriginIndicator, hideAgentColumn, currentSortBy, currentSortDirection, handleSortChange, listParams]
  );

  // Ensure data is always an array - handle all edge cases
  // This is critical because useReactTable requires an iterable array
  const safeData = useMemo(() => {
    try {
      if (!data) return [];
      if (Array.isArray(data)) {
        // Double-check each item is valid
        return data.filter((item): item is ReferralRow => item != null && typeof item === 'object');
      }
      return [];
    } catch (error) {
      console.error('Error processing referral data:', error);
      return [];
    }
  }, [data]);

  const table = useReactTable({
    data: safeData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const [isDesktop, setIsDesktop] = useState(false);

  useLayoutEffect(() => {
    if (!stackOnMobile || typeof window === 'undefined') {
      return;
    }
    const mq = window.matchMedia(MD_MIN_WIDTH_QUERY);
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [stackOnMobile]);

  if (stackOnMobile && !isDesktop) {
    return (
      <ReferralMobileStack
        rows={safeData}
        mode={mode}
        listParams={listParams}
        showAgentOriginIndicator={showAgentOriginIndicator}
        hideAgentColumn={hideAgentColumn}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-card">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-surface-muted">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={clsx(
                    'text-eyebrow px-4 text-foreground-subtle',
                    mode === 'admin' ? 'py-2' : 'py-3',
                    header.column.id === 'actions' ? 'text-right' : 'text-left'
                  )}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-muted">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={clsx(
                    'px-4 text-sm text-foreground-muted',
                    mode === 'admin' ? 'py-1.5' : 'py-3',
                    cell.column.id === 'actions' && 'text-right'
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ReferralSummaryMetrics {
  total: number;
  closedDeals: number;
  closeRate: number;
  activeReferrals: number;
}

type ReferralSummaryMode = 'mc' | 'agent';

export function ReferralSummary({
  summary,
  mode
}: {
  summary: ReferralSummaryMetrics;
  mode: ReferralSummaryMode;
}) {
  const { total, closedDeals, closeRate, activeReferrals } = summary;

  const metrics =
    mode === 'agent'
      ? [
          {
            label: 'Total Referrals',
            value: formatNumber(total)
          },
          {
            label: 'Active Referrals',
            value: formatNumber(activeReferrals)
          },
          {
            label: 'Closed Referrals',
            value: formatNumber(closedDeals)
          },
          {
            label: 'Close Rate',
            value: `${closeRate.toFixed(1)}%`
          }
        ]
      : [
          {
            label: 'Total Referrals',
            value: formatNumber(total)
          },
          {
            label: 'Closed Deals',
            value: formatNumber(closedDeals)
          },
          {
            label: 'Close Rate',
            value: `${closeRate.toFixed(1)}%`
          }
        ];

  const columnClass = mode === 'agent' ? 'md:grid-cols-4' : 'md:grid-cols-3';

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <dl className={clsx('grid gap-2', columnClass)}>
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg bg-surface-muted px-3 py-2">
            <dt className="text-xs text-foreground-subtle">{metric.label}</dt>
            <dd className="text-numeric mt-0.5 text-base font-semibold text-foreground">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
