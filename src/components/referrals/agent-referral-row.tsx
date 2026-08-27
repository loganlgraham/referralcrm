'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getReferralStatusLabel, type ReferralStatus } from '@/constants/referrals';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { buildGmailComposeUrl } from '@/utils/gmail';
import type { ReferralRow } from '@/components/tables/referral-table';
import {
  AGENT_ROW_GRID,
  AGENT_ROW_GRID_SELECTABLE,
  describeClientSide,
  formatReferredDate,
  formatRelativeDays,
  getAgentStatusChoices,
  isQuietStatusChoice,
  pickAgentReferralEyebrowFact
} from '@/components/referrals/agent-referral-shared';

export interface AgentReferralRowProps {
  row: ReferralRow;
  expanded: boolean;
  pending: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onApplyStatus: (row: ReferralRow, status: ReferralStatus) => void;
  onSaveNote: (row: ReferralRow, note: string) => Promise<boolean>;
}

const EYEBROW = 'font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle';

export function AgentReferralRow({
  row,
  expanded,
  pending,
  selectMode,
  selected,
  onToggleSelected,
  onToggleExpanded,
  onApplyStatus,
  onSaveNote
}: AgentReferralRowProps) {
  const needsUpdate = Boolean(row.needsUpdate);
  const referredOn = formatReferredDate(row.referredAt ?? row.createdAt);
  const counterparty = row.counterparty ?? null;
  const lastActivity = row.lastActivity ?? null;
  const eyebrowFact = pickAgentReferralEyebrowFact({
    clientType: row.clientType,
    preApprovalAmountCents: row.preApprovalAmountCents,
    lookingInZip: row.lookingInZip,
    lookingInZips: row.lookingInZips,
    loanType: row.loanType,
    includeReferredDate: false
  });

  return (
    <div
      className={cn(
        'rounded-card border bg-surface transition',
        expanded
          ? 'border-border-strong shadow-card'
          : needsUpdate
            ? 'border-border shadow-card'
            : 'border-border shadow-resting',
        pending && 'opacity-60'
      )}
    >
      <div
        className={cn(
          selectMode ? AGENT_ROW_GRID_SELECTABLE : AGENT_ROW_GRID,
          'items-center px-5 py-4'
        )}
      >
        {selectMode ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(row._id)}
            aria-label={`Select ${row.borrowerName}`}
            className="h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
          />
        ) : null}

        <div className="min-w-0">
          <Link
            href={`/referrals/${row._id}`}
            className="text-[17px] font-bold tracking-[-0.02em] text-foreground no-underline hover:underline"
          >
            {row.borrowerName}
          </Link>
          <p className="mt-1 text-[13px] leading-[1.4] text-foreground-subtle">
            {describeClientSide(row.clientType)}
            {eyebrowFact?.kind === 'pre-approval' && eyebrowFact.numeric ? (
              <>
                {' · pre-approved up to '}
                <span className="font-mono font-medium tabular-nums text-foreground-muted">
                  {eyebrowFact.numeric}
                </span>
              </>
            ) : eyebrowFact ? (
              ` · ${eyebrowFact.text}`
            ) : null}
            {referredOn ? (
              <>
                {' · '}
                <span className="font-mono tabular-nums">{referredOn}</span>
              </>
            ) : null}
          </p>
        </div>

        <div>
          <StatusPill kind="auto" status={getReferralStatusLabel(row.status)} />
          <StatusSubline row={row} />
        </div>

        <div className="min-w-0">
          {lastActivity ? (
            <>
              <p className="line-clamp-2 text-[13px] leading-[1.4] text-foreground-muted">
                &ldquo;{lastActivity.text}&rdquo;
              </p>
              <p className="mt-1 text-[13px] text-foreground-subtle">
                {lastActivity.authorName || 'Unknown'}
                {' · '}
                <span className="font-mono tabular-nums">{formatRelativeDays(lastActivity.at)}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-[1.4] text-foreground-muted">No note since the intro.</p>
              <ContactLinks counterparty={counterparty} />
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {needsUpdate ? (
            <Button
              size="lg"
              className="h-10"
              aria-expanded={expanded}
              onClick={() => onToggleExpanded(row._id)}
            >
              Update status
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="lg"
            className="h-10"
            aria-expanded={expanded}
            onClick={() => onToggleExpanded(row._id)}
          >
            Add note
          </Button>
          <RowMenu row={row} />
        </div>
      </div>

      {expanded ? (
        <ExpandedPanel
          row={row}
          pending={pending}
          onApplyStatus={onApplyStatus}
          onSaveNote={onSaveNote}
        />
      ) : null}
    </div>
  );
}

function StatusSubline({ row }: { row: ReferralRow }) {
  if (row.needsUpdate) {
    return (
      <p className="mt-1.5 text-xs font-medium text-warning">
        <span className="font-mono tabular-nums">{row.daysInStatus ?? 0} days</span> in status
      </p>
    );
  }

  if (row.latestDeal?.stageLabel) {
    return (
      <p className="mt-1.5 text-xs text-foreground-subtle">
        Deal stage: <span className="font-semibold text-foreground-muted">{row.latestDeal.stageLabel}</span>
      </p>
    );
  }

  return (
    <p className="mt-1.5 text-xs text-foreground-subtle">
      <span className="font-mono tabular-nums">{row.daysInStatus ?? 0} days</span> in status
    </p>
  );
}

function ContactLinks({ counterparty }: { counterparty: ReferralRow['counterparty'] }) {
  if (!counterparty || (!counterparty.email && !counterparty.phone)) {
    return null;
  }

  return (
    <p className="mt-1 text-[13px] text-foreground-subtle">
      {counterparty.email ? (
        <a
          href={buildGmailComposeUrl(counterparty.email)}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary no-underline hover:underline"
        >
          Email
        </a>
      ) : null}
      {counterparty.email && counterparty.phone ? ' · ' : null}
      {counterparty.phone ? (
        <a
          href={`tel:${counterparty.phone}`}
          className="font-medium text-primary no-underline hover:underline"
        >
          Call
        </a>
      ) : null}
    </p>
  );
}

function RowMenu({ row }: { row: ReferralRow }) {
  const counterparty = row.counterparty;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${row.borrowerName}`}
          className="inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/referrals/${row._id}`} className="no-underline">
            Open referral
          </Link>
        </DropdownMenuItem>
        {counterparty?.email ? (
          <DropdownMenuItem asChild>
            <a
              href={buildGmailComposeUrl(counterparty.email)}
              target="_blank"
              rel="noreferrer"
              className="no-underline"
            >
              Email {counterparty.name}
            </a>
          </DropdownMenuItem>
        ) : null}
        {counterparty?.phone ? (
          <DropdownMenuItem asChild>
            <a href={`tel:${counterparty.phone}`} className="no-underline">
              Call {counterparty.name}
            </a>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExpandedPanel({
  row,
  pending,
  onApplyStatus,
  onSaveNote
}: {
  row: ReferralRow;
  pending: boolean;
  onApplyStatus: AgentReferralRowProps['onApplyStatus'];
  onSaveNote: AgentReferralRowProps['onSaveNote'];
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    noteRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed || saving) {
      return;
    }
    setSaving(true);
    const saved = await onSaveNote(row, trimmed);
    setSaving(false);
    if (saved) {
      setNote('');
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6 border-t border-border bg-surface-muted px-5 pb-[18px] pt-4">
      <div>
        <p className={cn(EYEBROW, 'mb-2')}>Where are they now?</p>
        <div className="flex flex-wrap gap-1.5">
          {getAgentStatusChoices(row.status).map((status) => {
            const isCurrent = status === row.status;
            const isQuiet = isQuietStatusChoice(status);
            return (
              <button
                key={status}
                type="button"
                disabled={pending || isCurrent}
                aria-current={isCurrent}
                onClick={() => onApplyStatus(row, status)}
                className={cn(
                  'inline-flex h-[34px] items-center rounded-pill px-[13px] text-[13px] transition disabled:cursor-default',
                  isCurrent
                    ? 'bg-info-soft font-semibold text-info shadow-[inset_0_0_0_1px_hsl(var(--info)/0.25)]'
                    : isQuiet
                      ? 'border border-border bg-surface font-medium text-foreground-subtle hover:bg-surface-subtle'
                      : 'border border-border-strong bg-surface font-medium text-foreground hover:bg-surface-subtle'
                )}
              >
                {getReferralStatusLabel(status)}
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <p className={cn(EYEBROW, 'mb-2')}>Note</p>
        <div className="flex gap-2">
          <input
            ref={noteRef}
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a note…"
            className="h-10 min-w-0 flex-1 rounded-lg border border-border-strong/70 bg-surface px-3 text-sm text-foreground shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)] focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="lg" className="h-10 shrink-0" loading={saving} disabled={!note.trim()}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
