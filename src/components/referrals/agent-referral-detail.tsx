'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mail, Phone } from 'lucide-react';
import { getReferralStatusLabel, type ReferralStatus } from '@/constants/referrals';
import { formatCurrency, formatDateMST, formatPhoneNumber } from '@/utils/formatters';
import { CopyButton } from '@/components/common/copy-button';
import { cn } from '@/lib/cn';
import { describeAgentReferralEyebrow } from '@/components/referrals/agent-referral-shared';

export interface AgentDetailContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface AgentDetailHeaderProps {
  borrowerName: string;
  clientType: string;
  preApprovalAmountCents?: number | null;
  lookingIn?: string | null;
  loanType?: string | null;
  referredAt?: string | null;
  status: ReferralStatus;
  isAgentOrigin: boolean;
  daysInStatus?: number | null;
  propertyAddress?: string | null;
  loanFileNumber?: string | null;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  backHref: string;
}

const metaPillClasses =
  'inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-[3px] text-xs leading-[18px] text-foreground-muted shadow-[inset_0_0_0_1px_hsl(var(--border))]';

const headerActionClasses =
  'inline-flex h-10 items-center gap-[7px] whitespace-nowrap rounded-lg bg-surface px-3.5 text-sm font-semibold text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)),0_1px_2px_rgba(15,23,42,0.05)] transition hover:bg-surface-muted';

export function AgentDetailHeader({
  borrowerName,
  clientType,
  preApprovalAmountCents,
  lookingIn,
  loanType,
  referredAt,
  status,
  isAgentOrigin,
  daysInStatus,
  propertyAddress,
  loanFileNumber,
  borrowerEmail,
  borrowerPhone,
  backHref
}: AgentDetailHeaderProps) {
  const eyebrow = describeAgentReferralEyebrow({
    clientType,
    preApprovalAmountCents,
    lookingIn,
    loanType,
    referredAt
  });

  return (
    <header className="space-y-2">
      <p className="text-[13px] text-foreground-subtle">
        <Link href={backHref} className="font-medium text-foreground-muted hover:text-foreground">
          Referrals
        </Link>
        {' / '}
        {borrowerName}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-eyebrow text-foreground-muted">{eyebrow}</p>
          <h1 className="mt-1 text-[28px] font-extrabold leading-tight tracking-[-0.035em] text-foreground sm:text-[32px]">
            {borrowerName}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          {borrowerEmail ? (
            <a href={`mailto:${borrowerEmail}`} className={headerActionClasses}>
              <Mail className="h-4 w-4" aria-hidden />
              Email
            </a>
          ) : null}
          {borrowerPhone ? (
            <a href={`tel:${borrowerPhone.replace(/[^\d+]/g, '')}`} className={headerActionClasses}>
              <Phone className="h-4 w-4" aria-hidden />
              Call
            </a>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="inline-flex items-center rounded-pill bg-warning-soft px-2.5 py-[3px] text-xs font-semibold leading-[18px] text-warning shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.3)]">
          {getReferralStatusLabel(status, { isAgentOrigin })}
        </span>
        {typeof daysInStatus === 'number' && daysInStatus >= 0 ? (
          <span className={metaPillClasses}>
            <span className="text-numeric font-semibold text-warning">
              {daysInStatus} {daysInStatus === 1 ? 'day' : 'days'}
            </span>
            in stage
          </span>
        ) : null}
        {propertyAddress?.trim() ? <span className={metaPillClasses}>{propertyAddress}</span> : null}
        {loanFileNumber?.trim() ? (
          <span className={metaPillClasses}>
            Loan <span className="text-numeric text-foreground">{loanFileNumber}</span>
            <CopyButton value={loanFileNumber} label="Copy loan number" />
          </span>
        ) : null}
      </div>
    </header>
  );
}

interface AgentContextRailProps {
  mc?: AgentDetailContact | null;
  agentSideLabel: string;
  agent?: AgentDetailContact | null;
  clientType: string;
  loanType?: string | null;
  preApprovalAmountCents?: number | null;
  lookingIn?: string | null;
  stageOnTransfer?: string | null;
  timelineLabel?: string | null;
  createdAt: string;
  currentAddress?: string | null;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  onEditIntake?: () => void;
}

export function AgentContextRail({
  mc,
  agentSideLabel,
  agent,
  clientType,
  loanType,
  preApprovalAmountCents,
  lookingIn,
  stageOnTransfer,
  timelineLabel,
  createdAt,
  currentAddress,
  borrowerEmail,
  borrowerPhone,
  onEditIntake
}: AgentContextRailProps) {
  return (
    <div className="flex flex-col gap-4">
      <RailCard title="Who's on it">
        <div className="flex flex-col gap-3.5">
          <div>
            <p className="text-eyebrow text-foreground-subtle">Mortgage consultant</p>
            {mc?.name ? (
              <>
                <p className="mt-1.5 text-[15px] font-bold text-foreground">{mc.name}</p>
                <RailContactStack className="mt-[3px]" email={mc.email} phone={mc.phone} />
                {mc.email || mc.phone ? (
                  <div className="mt-2.5 flex gap-2">
                    {mc.email ? (
                      <a href={`mailto:${mc.email}`} className={railActionClasses}>
                        Email
                      </a>
                    ) : null}
                    {mc.phone ? (
                      <a href={`tel:${mc.phone.replace(/[^\d+]/g, '')}`} className={railActionClasses}>
                        Call
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-1.5 text-sm text-foreground-subtle">Not paired yet.</p>
            )}
          </div>
          {agent?.name ? (
            <div className="border-t border-border pt-3.5">
              <p className="text-eyebrow text-foreground-subtle">{agentSideLabel}</p>
              <p className="mt-1.5 text-[15px] font-bold text-foreground">
                {agent.name}
                <span className="ml-1 text-xs font-medium text-foreground-subtle">· you</span>
              </p>
              <RailContactStack className="mt-[3px]" email={agent.email} phone={agent.phone} />
            </div>
          ) : null}
        </div>
      </RailCard>

      <RailCard
        title="Intake details"
        action={
          onEditIntake ? (
            <button
              type="button"
              onClick={onEditIntake}
              className="text-[13px] font-semibold text-primary hover:text-primary-hover"
            >
              Edit
            </button>
          ) : null
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <RailFact label="Client" value={clientType} />
          <RailFact label="Loan type" value={loanType?.trim() || null} />
          <RailFact
            label="Pre-approval"
            value={preApprovalAmountCents ? formatCurrency(preApprovalAmountCents) : null}
            numeric
          />
          <RailFact label="Looking in" value={lookingIn?.trim() || null} numeric />
          <RailFact label="Stage on transfer" value={stageOnTransfer?.trim() || null} />
          <RailFact label="Timeline" value={timelineLabel || null} />
          <RailFact label="Entered CRM" value={formatDateMST(createdAt)} numeric />
          <RailFact label="Current address" value={currentAddress?.trim() || null} />
        </dl>
      </RailCard>

      <RailCard title="Client contact">
        {borrowerEmail?.trim() || borrowerPhone?.trim() ? (
          <RailContactStack email={borrowerEmail} phone={borrowerPhone} />
        ) : (
          <p className="text-[13px] leading-relaxed text-foreground-muted">No contact details on file.</p>
        )}
      </RailCard>
    </div>
  );
}

const railActionClasses =
  'inline-flex h-9 flex-1 items-center justify-center rounded-[9px] bg-surface text-[13px] font-semibold text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))] transition hover:bg-surface-muted';

function RailCard({
  title,
  action,
  children
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface px-5 py-[18px] shadow-resting">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold tracking-[-0.02em] text-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function RailContactValue({
  value,
  copyLabel,
  numeric
}: {
  value: string;
  copyLabel: string;
  numeric?: boolean;
}) {
  const display = numeric ? formatPhoneNumber(value) || value : value;
  return (
    <span className={cn('flex min-w-0 items-start gap-1', numeric ? 'text-numeric' : null)}>
      <span className="min-w-0 break-words">{display}</span>
      <CopyButton value={display} label={copyLabel} />
    </span>
  );
}

function RailContactStack({
  email,
  phone,
  className
}: {
  email?: string | null;
  phone?: string | null;
  className?: string;
}) {
  const trimmedEmail = email?.trim() || null;
  const trimmedPhone = phone?.trim() || null;
  if (!trimmedEmail && !trimmedPhone) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 break-words text-[13px] leading-relaxed text-foreground-muted',
        className
      )}
    >
      {trimmedEmail ? <RailContactValue value={trimmedEmail} copyLabel="Copy email" /> : null}
      {trimmedPhone ? <RailContactValue value={trimmedPhone} copyLabel="Copy phone" numeric /> : null}
    </div>
  );
}

function RailFact({ label, value, numeric }: { label: string; value: string | null; numeric?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-foreground-subtle">{label}</dt>
      <dd
        className={cn(
          'mt-[3px] text-sm font-semibold',
          value ? 'text-foreground' : 'text-foreground-subtle',
          numeric && value ? 'text-numeric' : null
        )}
      >
        {value ?? 'Not specified'}
      </dd>
    </div>
  );
}
