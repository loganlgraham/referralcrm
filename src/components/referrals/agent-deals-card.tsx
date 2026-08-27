'use client';

import { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { DEAL_STATUS_OPTIONS, type DealStatus, type TerminatedReason } from '@/constants/deals';
import type { ReferralPayment } from '@/types/referral-payment';
import { formatCurrency, formatDateMST } from '@/utils/formatters';
import {
  resolveAgentDealExpectedCents,
  resolveDealReferralFeeBasisPoints
} from '@/utils/referral';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { confirmCloseStatusDate } from '@/components/referrals/status-date-confirmation-toast';
import {
  confirmReferralTermination,
  type TerminationResolvedStatus
} from '@/components/referrals/terminate-confirmation-toast';
import type { LostReason } from '@/constants/referrals';

/** Everything the stage prompts collect, forwarded straight into `PATCH /api/payments`. */
export interface DealStageExtras {
  closingDate?: string;
  usedAfc?: boolean;
  sendClosedEmails?: boolean;
  sendAgentNpsEmail?: boolean;
  terminatedReason?: TerminatedReason;
  nextReferralStatus?: TerminationResolvedStatus;
  lostReason?: LostReason | null;
}

type DealStageHandler = (
  deal: ReferralPayment,
  nextStatus: DealStatus,
  extras: DealStageExtras
) => Promise<boolean> | boolean;

interface AgentDealsCardProps {
  deals: ReferralPayment[];
  hiddenOutsideAgentCount?: number;
  onStageChange: DealStageHandler;
  onEdit: (deal: ReferralPayment) => void;
  onAddDeal?: () => void;
  canAddDeal?: boolean;
  borrowerName: string;
  isAgentOrigin?: boolean;
}

const DEAL_GRID = 'grid grid-cols-[minmax(0,1fr)_150px_130px_120px_30px] items-center gap-4';

const TERMINATED_REASON_LABELS: Record<string, string> = {
  inspection: 'Inspection',
  appraisal: 'Appraisal',
  financing: 'Financing',
  changed_mind: 'Changed mind'
};

const formatPercent = (basisPoints?: number | null): string | null => {
  if (basisPoints == null) {
    return null;
  }
  return `${(basisPoints / 100).toFixed(2)}%`;
};

/** Deals that no longer earn anything read in muted type so the live row stands out. */
const isSettledOrDead = (status?: string | null) =>
  status === 'terminated' || status === 'paid' || status === 'payment_sent';

export function AgentDealsCard({
  deals,
  hiddenOutsideAgentCount = 0,
  onStageChange,
  onEdit,
  onAddDeal,
  canAddDeal = false,
  borrowerName,
  isAgentOrigin = false
}: AgentDealsCardProps) {
  const sorted = useMemo(
    () =>
      deals.toSorted((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      }),
    [deals]
  );

  return (
    <section className="rounded-card border border-border bg-surface shadow-resting">
      <div className="flex items-end justify-between gap-4 px-5 pb-3.5 pt-[18px]">
        <div>
          <h2 className="text-base font-bold tracking-[-0.02em] text-foreground">Deals</h2>
          <p className="mt-1 text-[13px] text-foreground-subtle">Contracts and payouts tied to this referral.</p>
        </div>
        {canAddDeal && onAddDeal ? (
          <Button type="button" variant="secondary" size="sm" className="h-9" onClick={onAddDeal}>
            Add deal
          </Button>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <p className="border-t border-border px-5 py-5 text-[13px] text-foreground-subtle">
          {hiddenOutsideAgentCount > 0
            ? 'This referral closed with another agent, so there is nothing here for you.'
            : 'No deals yet. One shows up here once this referral goes under contract.'}
        </p>
      ) : (
        <>
          <div className={cn(DEAL_GRID, 'border-b border-border px-5 pb-2')}>
            <span className="text-eyebrow text-foreground-subtle">Deal</span>
            <span className="text-eyebrow text-foreground-subtle">Closing</span>
            <span className="text-eyebrow text-foreground-subtle">Fee</span>
            <span className="text-right text-eyebrow text-foreground-subtle">Expected</span>
            <span />
          </div>
          {sorted.map((deal, index) => (
            <DealRow
              key={deal._id}
              deal={deal}
              isLast={index === sorted.length - 1}
              onStageChange={onStageChange}
              onEdit={onEdit}
              borrowerName={borrowerName}
              isAgentOrigin={isAgentOrigin}
            />
          ))}
        </>
      )}
    </section>
  );
}

function DealRow({
  deal,
  isLast,
  onStageChange,
  onEdit,
  borrowerName,
  isAgentOrigin
}: {
  deal: ReferralPayment;
  isLast: boolean;
  onStageChange: DealStageHandler;
  onEdit: (deal: ReferralPayment) => void;
  borrowerName: string;
  isAgentOrigin: boolean;
}) {
  const [updating, setUpdating] = useState(false);
  const status = (deal.status as DealStatus | undefined) ?? 'under_contract';
  const muted = isSettledOrDead(deal.status);
  const readOnly = deal.isCrossSideReadOnly === true;

  const contractPrice = deal.contractPriceCents ? formatCurrency(deal.contractPriceCents) : null;
  const referralFee = formatPercent(
    resolveDealReferralFeeBasisPoints(deal.contractPriceCents, deal.referralFeeBasisPoints)
  );
  const expectedCents = resolveAgentDealExpectedCents(deal);

  const subline =
    deal.status === 'terminated'
      ? `Reason: ${TERMINATED_REASON_LABELS[deal.terminatedReason ?? ''] ?? 'Not specified'}`
      : [
          deal.side === 'sell' ? 'Sell-side' : 'Buy-side',
          deal.propertyAddress?.trim() || null,
          deal.side === 'sell' ? null : deal.usedAfc ? 'financing with AFC' : 'financing elsewhere'
        ]
          .filter(Boolean)
          .join(' · ');

  /** Closing and terminating need extra input, collected in a toast before the write. */
  const handleStage = async (next: DealStatus) => {
    if (updating || next === status) {
      return;
    }

    const extras: DealStageExtras = {};

    if (next === 'closed') {
      const askUsedAfc = deal.side !== 'sell';
      const confirmation = await confirmCloseStatusDate({
        initialDateIso: deal.closingDate ?? null,
        canSendClosedEmails: false,
        defaultSendClosedEmails: false,
        canSendAgentNpsEmail: false,
        defaultSendAgentNpsEmail: false,
        showEmailPreference: false,
        askUsedAfc,
        defaultUsedAfc: deal.side === 'sell' ? false : Boolean(deal.usedAfc)
      });
      if (!confirmation.confirmed) {
        return;
      }
      extras.closingDate = confirmation.closingDateIso;
      extras.sendClosedEmails = true;
      extras.sendAgentNpsEmail = true;
      extras.usedAfc =
        deal.side === 'sell'
          ? false
          : typeof confirmation.usedAfc === 'boolean'
            ? confirmation.usedAfc
            : Boolean(deal.usedAfc);
    }

    if (next === 'terminated') {
      const confirmation = await confirmReferralTermination({
        borrowerName,
        isAgentOrigin
      });
      if (!confirmation.confirmed || !confirmation.resolvedStatus || !confirmation.terminatedReason) {
        return;
      }
      extras.terminatedReason = confirmation.terminatedReason;
      extras.nextReferralStatus = confirmation.resolvedStatus;
      extras.lostReason = confirmation.lostReason ?? null;
    }

    setUpdating(true);
    try {
      await onStageChange(deal, next, extras);
    } finally {
      setUpdating(false);
    }
  };

  // Payment Received is only reachable once the referral fee lands, so agents never pick it.
  const stageChoices = DEAL_STATUS_OPTIONS.filter((option) => option.value !== 'paid');

  return (
    <div className={cn('px-5 py-3.5', isLast ? null : 'border-b border-border/60')}>
      <div className={DEAL_GRID}>
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', muted ? 'text-foreground-subtle' : 'text-foreground')}>
            {contractPrice ? <span className="text-numeric">{contractPrice}</span> : 'Deal'}
          </p>
          <p className="mt-[3px] truncate text-[13px] text-foreground-subtle">{subline}</p>
        </div>
        <p className={cn('text-numeric text-[13px]', muted ? 'text-foreground-subtle' : 'text-foreground-muted')}>
          {deal.closingDate ? formatDateMST(deal.closingDate) : '—'}
        </p>
        <p className={cn('text-[13px]', muted ? 'text-foreground-subtle' : 'text-foreground-muted')}>
          {referralFee ? <span className="text-numeric">{referralFee}</span> : '—'}
        </p>
        <p
          className={cn(
            'text-numeric text-right text-[15px] font-semibold',
            muted ? 'text-foreground-subtle' : 'text-foreground'
          )}
        >
          {formatCurrency(expectedCents)}
        </p>
        <button
          type="button"
          aria-label="Edit deal"
          disabled={updating}
          onClick={() => onEdit(deal)}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-foreground-subtle transition hover:bg-surface-muted hover:text-foreground-muted disabled:opacity-50"
        >
          <Pencil className="h-[14px] w-[14px]" aria-hidden />
        </button>
      </div>
      {readOnly ? null : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stageChoices.map((option) => {
            const isCurrent = option.value === status;
            return (
              <button
                key={option.value}
                type="button"
                disabled={updating || isCurrent}
                aria-current={isCurrent}
                onClick={() => void handleStage(option.value)}
                className={cn(
                  'inline-flex h-8 items-center rounded-pill px-3 text-xs transition disabled:cursor-default',
                  isCurrent
                    ? 'bg-warning-soft font-bold text-warning shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.35)]'
                    : 'border border-border bg-surface font-medium text-foreground-muted hover:bg-surface-muted'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
