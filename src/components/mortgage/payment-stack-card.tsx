'use client';

import { cn } from '@/lib/cn';
import { getMortgageInsuranceLabel } from '@/utils/affordability';
import {
  type LoanType,
  type MortgageCalculations,
  type MortgageInputs,
} from '@/utils/mortgage-calculations';
import { formatCurrency } from './formatters';

interface PaymentSegment {
  id: string;
  label: string;
  amount: number;
  /** Background for the bar segment and its legend swatch. */
  swatch: string;
  note?: string;
}

function buildSegments(
  inputs: MortgageInputs,
  calculations: MortgageCalculations,
  loanType: LoanType
): PaymentSegment[] {
  const segments: PaymentSegment[] = [
    {
      id: 'principal-interest',
      label: 'Principal & interest',
      amount: calculations.principalAndInterest,
      swatch: 'bg-primary',
    },
    {
      id: 'taxes',
      label: 'Property taxes',
      amount: calculations.propertyTaxes,
      swatch: 'bg-info',
    },
    {
      id: 'insurance',
      label: 'Homeowners insurance',
      amount: inputs.insuranceMonthly,
      swatch: 'bg-accent',
    },
    {
      id: 'hoa',
      label: 'HOA dues',
      amount: inputs.hoaMonthly,
      swatch: 'bg-foreground-subtle',
    },
    {
      id: 'mortgage-insurance',
      label: getMortgageInsuranceLabel(loanType),
      amount: calculations.pmiMonthly,
      swatch: 'bg-signal',
      note: loanType === 'conventional' ? 'Drops off at 80% loan-to-value' : undefined,
    },
    {
      id: 'extra-principal',
      label: 'Extra principal',
      amount: inputs.extraPrincipal,
      swatch: 'bg-success',
      note: 'Optional, paid straight to the balance',
    },
  ];

  return segments.filter((segment) => segment.amount > 0);
}

interface PaymentStackCardProps {
  inputs: MortgageInputs;
  calculations: MortgageCalculations;
  loanTypeName: string;
}

/**
 * The page's anchor. A payment is a stack of parts and coaching is about which
 * part to shrink, so the bar is the proportional stack and the rows below are
 * its legend.
 */
export function PaymentStackCard({ inputs, calculations, loanTypeName }: PaymentStackCardProps) {
  const loanType = inputs.loanType ?? 'conventional';
  const segments = buildSegments(inputs, calculations, loanType);
  const total = calculations.totalMonthly;
  const share = (amount: number) => (total > 0 ? amount / total : 0);

  return (
    <section className="rounded-card border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-eyebrow text-foreground-subtle">Monthly payment</h2>
        <p className="text-xs text-foreground-subtle">
          {loanTypeName} &middot; {inputs.termYears} yrs &middot; {inputs.interestRate}%
        </p>
      </div>

      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-numeric text-4xl font-bold tracking-[-0.03em] text-foreground">
          {formatCurrency(total)}
        </span>
        <span className="text-sm font-medium text-foreground-subtle">/mo</span>
      </p>

      <div aria-hidden className="mt-4 flex h-2.5 gap-[2px] overflow-hidden rounded-pill">
        {segments.map((segment) => (
          <span
            key={segment.id}
            className={cn('block min-w-[3px]', segment.swatch)}
            style={{ width: `${share(segment.amount) * 100}%` }}
          />
        ))}
      </div>

      <dl className="mt-4 divide-y divide-border">
        {segments.map((segment) => (
          <div key={segment.id} className="flex items-baseline gap-3 py-2 first:pt-0">
            <dt className="flex min-w-0 flex-1 items-baseline gap-2">
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', segment.swatch)}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{segment.label}</span>
                {segment.note ? (
                  <span className="block text-xs text-foreground-subtle">{segment.note}</span>
                ) : null}
              </span>
            </dt>
            <dd className="text-numeric shrink-0 text-right text-sm font-semibold text-foreground">
              {formatCurrency(segment.amount)}
              <span className="ml-2 inline-block w-9 text-xs font-medium text-foreground-subtle">
                {Math.round(share(segment.amount) * 100)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-foreground-subtle">
        Estimates for coaching conversations. Actual lender disclosures will differ based on credit,
        program, and fees.
      </p>
    </section>
  );
}
