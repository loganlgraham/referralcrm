'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { formatPhoneNumber } from '@/utils/formatters';
import { CopyButton } from '@/components/common/copy-button';
import { buttonClasses } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Shared building blocks for the referral detail page. The agent view and the
 * admin/manager/MC view both compose these so the two layouts read as one product.
 */

export const metaPillClasses =
  'inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-[3px] text-xs leading-[18px] text-foreground-muted shadow-[inset_0_0_0_1px_hsl(var(--border))]';

export const headerActionClasses = buttonClasses({ variant: 'secondary', size: 'md' });

export const headerIconActionClasses = buttonClasses({
  variant: 'secondary',
  size: 'icon'
});

export const railActionClasses = buttonClasses({
  variant: 'secondary',
  size: 'md',
  className: 'flex-1'
});

export const railTextButtonClasses =
  'text-[13px] font-semibold text-primary transition hover:text-primary-hover disabled:cursor-not-allowed disabled:opacity-50';

export const railCardClasses = 'rounded-card border border-border bg-surface px-5 py-[18px] shadow-resting';

export const railTitleClasses = 'text-base font-bold tracking-[-0.02em] text-foreground';

export function RailCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = 'section'
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div';
}) {
  return (
    <Tag className={cn(railCardClasses, className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={railTitleClasses}>{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-foreground-subtle">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className={cn('mt-3.5', bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function RailContactValue({
  value,
  copyLabel,
  numeric,
  href
}: {
  value: string;
  copyLabel: string;
  numeric?: boolean;
  href?: string;
}) {
  const display = numeric ? formatPhoneNumber(value) || value : value;
  return (
    <span className={cn('flex min-w-0 items-start gap-1', numeric ? 'text-numeric' : null)}>
      {href ? (
        <a href={href} className="min-w-0 break-words hover:text-foreground hover:underline">
          {display}
        </a>
      ) : (
        <span className="min-w-0 break-words">{display}</span>
      )}
      <CopyButton value={display} label={copyLabel} />
    </span>
  );
}

export function RailContactStack({
  email,
  phone,
  className,
  linked
}: {
  email?: string | null;
  phone?: string | null;
  className?: string;
  /** Render email/phone as mailto:/tel: links. */
  linked?: boolean;
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
      {trimmedEmail ? (
        <RailContactValue
          value={trimmedEmail}
          copyLabel="Copy email"
          href={linked ? `mailto:${trimmedEmail}` : undefined}
        />
      ) : null}
      {trimmedPhone ? (
        <RailContactValue
          value={trimmedPhone}
          copyLabel="Copy phone"
          numeric
          href={linked ? `tel:${trimmedPhone.replace(/[^\d+]/g, '')}` : undefined}
        />
      ) : null}
    </div>
  );
}

export function RailFact({
  label,
  value,
  numeric,
  className
}: {
  label: string;
  value: ReactNode | null;
  numeric?: boolean;
  className?: string;
}) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-foreground-subtle">{label}</dt>
      <dd
        className={cn(
          'mt-[3px] break-words text-sm font-semibold',
          hasValue ? 'text-foreground' : 'text-foreground-subtle',
          numeric && hasValue ? 'text-numeric' : null
        )}
      >
        {hasValue ? value : 'Not specified'}
      </dd>
    </div>
  );
}

export type RailFactItem = {
  label: string;
  value: ReactNode | null;
  numeric?: boolean;
  className?: string;
};

const hasFactValue = (value: ReactNode | null) => value !== null && value !== undefined && value !== '';

/** Fact grid that tucks empty fields behind a toggle so the card only shows what's known. */
export function RailFactList({
  facts,
  leading
}: {
  facts: RailFactItem[];
  /** Always-visible grid cells (e.g. inline editors) rendered before the facts. */
  leading?: ReactNode;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const emptyCount = facts.filter((fact) => !hasFactValue(fact.value)).length;
  const visibleFacts = showEmpty ? facts : facts.filter((fact) => hasFactValue(fact.value));

  return (
    <div className="space-y-3">
      {leading || visibleFacts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          {leading}
          {visibleFacts.map((fact) => (
            <RailFact
              key={fact.label}
              label={fact.label}
              value={fact.value}
              numeric={fact.numeric}
              className={fact.className}
            />
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-foreground-subtle">No details yet.</p>
      )}
      {emptyCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowEmpty((previous) => !previous)}
          aria-expanded={showEmpty}
          className={railTextButtonClasses}
        >
          {showEmpty ? 'Hide empty fields' : `Show empty fields (${emptyCount})`}
        </button>
      ) : null}
    </div>
  );
}

/** Hairline-separated stack used inside rail cards to avoid nested gray panels. */
export function RailDivided({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col divide-y divide-border [&>*]:pt-3.5 [&>*:first-child]:pt-0 [&>*]:pb-3.5 [&>*:last-child]:pb-0', className)}>
      {children}
    </div>
  );
}
