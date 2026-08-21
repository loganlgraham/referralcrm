'use client';

import { TrendingDownIcon } from 'lucide-react';
import { formatCurrency } from './formatters';

interface ExtraPrincipalImpactProps {
  monthsSaved: number;
  yearsSaved: number;
  interestSaved: number;
  originalPayoffDate: Date;
  newPayoffDate: Date;
  extraPrincipalAmount: number;
  originalMonths: number;
  newMonths: number;
}

function formatMonth(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatDuration(monthsSaved: number) {
  const years = Math.floor(monthsSaved / 12);
  const months = monthsSaved % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  return parts.join(', ') || 'Less than a month';
}

export function ExtraPrincipalImpact({
  monthsSaved,
  interestSaved,
  originalPayoffDate,
  newPayoffDate,
  extraPrincipalAmount,
  originalMonths,
  newMonths,
}: ExtraPrincipalImpactProps) {
  if (extraPrincipalAmount === 0 || monthsSaved <= 0) {
    return (
      <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <h3 className="text-eyebrow text-foreground-subtle">Extra principal</h3>
        <p className="mt-2 text-sm text-foreground-muted">
          Add an extra monthly payment to see how much time and interest it saves.
        </p>
      </section>
    );
  }

  const remainingShare = originalMonths > 0 ? Math.min(newMonths / originalMonths, 1) : 1;

  return (
    <section className="rounded-card border border-success/30 bg-success-soft p-4">
      <h3 className="flex items-center gap-2 text-eyebrow text-[hsl(var(--success))]">
        <TrendingDownIcon className="h-3.5 w-3.5" aria-hidden />
        Extra principal impact
      </h3>
      <p className="mt-2 text-sm text-foreground-muted">
        Paying an extra{' '}
        <span className="text-numeric font-semibold text-foreground">
          {formatCurrency(extraPrincipalAmount)}
        </span>{' '}
        each month pays the loan off in {formatMonth(newPayoffDate)} instead of{' '}
        {formatMonth(originalPayoffDate)}.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-raised px-3 py-2 shadow-sm">
          <dt className="text-xs text-foreground-subtle">Time saved</dt>
          <dd className="text-numeric mt-0.5 text-base font-semibold text-foreground">
            {formatDuration(monthsSaved)}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-raised px-3 py-2 shadow-sm">
          <dt className="text-xs text-foreground-subtle">Interest saved</dt>
          <dd className="text-numeric mt-0.5 text-base font-semibold text-foreground">
            {formatCurrency(interestSaved)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-foreground-muted">Scheduled</span>
          <span className="h-2 flex-1 rounded-pill bg-foreground-subtle/40" />
          <span className="text-numeric w-16 shrink-0 text-right text-xs text-foreground-muted">
            {originalMonths} mo
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-foreground-muted">With extra</span>
          <span className="h-2 flex-1 rounded-pill bg-surface-raised">
            <span
              className="block h-2 rounded-pill bg-success"
              style={{ width: `${remainingShare * 100}%` }}
            />
          </span>
          <span className="text-numeric w-16 shrink-0 text-right text-xs text-foreground-muted">
            {newMonths} mo
          </span>
        </div>
      </div>
    </section>
  );
}
