'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { getReferralStatusLabel } from '@/constants/referrals';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { buildGmailComposeUrl } from '@/utils/gmail';
import {
  formatRelativeDays,
  getAgentStatusChoices,
  isQuietStatusChoice
} from '@/components/referrals/agent-referral-shared';
import type { AgentReferralRowProps } from '@/components/referrals/agent-referral-row';

const EYEBROW = 'font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle';

/** Phone rendering of a referral row. Same data and handlers as the desktop grid. */
export function AgentReferralCard({
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
  const counterparty = row.counterparty ?? null;
  const lastActivity = row.lastActivity ?? null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-card border border-border bg-surface transition',
        needsUpdate || expanded ? 'shadow-card' : 'shadow-none',
        pending && 'opacity-60'
      )}
    >
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {selectMode ? (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelected(row._id)}
                aria-label={`Select ${row.borrowerName}`}
                className="mt-1 h-4 w-4 shrink-0 rounded border-border-strong text-primary focus:ring-ring"
              />
            ) : null}
            <Link
              href={`/referrals/${row._id}`}
              className="text-[17px] font-bold leading-[1.25] tracking-[-0.02em] text-foreground no-underline"
            >
              {row.borrowerName}
            </Link>
          </div>
          <StatusPill kind="auto" status={getReferralStatusLabel(row.status)} size="sm" className="shrink-0" />
        </div>

        {needsUpdate ? (
          <>
            <p className="mt-2 text-[13px] leading-[1.45] text-foreground-muted">
              {lastActivity ? (
                <>&ldquo;{lastActivity.text}&rdquo; — </>
              ) : (
                'No note since the intro — '
              )}
              <span className="font-mono font-medium tabular-nums text-warning">
                {row.daysInStatus ?? 0} days
              </span>{' '}
              in this status.
            </p>
            {counterparty ? (
              <p className="mt-1.5 text-[13px] leading-[1.45] text-foreground-subtle">
                {counterparty.name}
                {counterparty.email ? (
                  <>
                    {' · '}
                    <a
                      href={buildGmailComposeUrl(counterparty.email)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary no-underline"
                    >
                      Email
                    </a>
                  </>
                ) : null}
                {counterparty.phone ? (
                  <>
                    {' · '}
                    <a href={`tel:${counterparty.phone}`} className="font-medium text-primary no-underline">
                      Call
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[13px] leading-[1.45] text-foreground-muted">
            {row.latestDeal?.stageLabel ? (
              <>
                Deal stage: <span className="font-semibold text-foreground">{row.latestDeal.stageLabel}</span>
              </>
            ) : (
              <>
                <span className="font-mono tabular-nums">{row.daysInStatus ?? 0} days</span> in status
              </>
            )}
            {lastActivity ? (
              <>
                {' · note '}
                <span className="font-mono tabular-nums">{formatRelativeDays(lastActivity.at)}</span>
              </>
            ) : null}
          </p>
        )}
      </div>

      <div className={cn('grid gap-2 px-4 pb-3.5', needsUpdate ? 'grid-cols-2' : 'grid-cols-1')}>
        {needsUpdate ? (
          <Button className="h-11" onClick={() => onToggleExpanded(row._id)} aria-expanded={expanded}>
            Update status
          </Button>
        ) : null}
        <Button
          variant="secondary"
          className="h-11"
          onClick={() => onToggleExpanded(row._id)}
          aria-expanded={expanded}
        >
          Add note
        </Button>
      </div>

      {expanded ? (
        <CardPanel row={row} pending={pending} onApplyStatus={onApplyStatus} onSaveNote={onSaveNote} />
      ) : null}
    </div>
  );
}

function CardPanel({
  row,
  pending,
  onApplyStatus,
  onSaveNote
}: {
  row: AgentReferralRowProps['row'];
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
    <div className="space-y-4 border-t border-border bg-surface-muted px-4 pb-4 pt-3.5">
      <div>
        <p className={cn(EYEBROW, 'mb-2')}>Where are they now?</p>
        <div className="flex flex-wrap gap-1.5">
          {getAgentStatusChoices(row.status).map((status) => {
            const isCurrent = status === row.status;
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
                    : isQuietStatusChoice(status)
                      ? 'border border-border bg-surface font-medium text-foreground-subtle'
                      : 'border border-border-strong bg-surface font-medium text-foreground'
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
            className="h-11 min-w-0 flex-1 rounded-lg border border-border-strong/70 bg-surface px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" className="h-11 shrink-0" loading={saving} disabled={!note.trim()}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
