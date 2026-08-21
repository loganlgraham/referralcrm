'use client';

import { LockIcon } from 'lucide-react';
import {
  AffordabilityResult,
  getFinancedFeeLabel,
  getMortgageInsuranceLabel,
} from '@/utils/affordability';
import { LoanType } from '@/utils/mortgage-calculations';
import { formatCurrency, formatPercent } from './formatters';

interface AffordabilityResultCardProps {
  result: AffordabilityResult;
  loanType: LoanType;
  bindingLabel: string;
}

export function AffordabilityResultCard({
  result,
  loanType,
  bindingLabel,
}: AffordabilityResultCardProps) {
  const paymentRows = [
    { label: 'Principal & interest', value: result.principalAndInterest },
    { label: 'Property taxes', value: result.propertyTaxes },
    { label: 'Homeowners insurance', value: result.insuranceMonthly },
    { label: 'HOA dues', value: result.hoaMonthly },
  ];

  if (result.mortgageInsuranceMonthly > 0) {
    paymentRows.push({
      label: getMortgageInsuranceLabel(loanType),
      value: result.mortgageInsuranceMonthly,
    });
  }

  const snapshot = [
    { label: 'Loan amount', value: formatCurrency(result.totalLoanAmount) },
    {
      label: 'Down payment',
      value: `${formatCurrency(result.downPaymentAmount)} · ${result.downPaymentPercent.toFixed(1)}%`,
    },
    { label: 'Loan-to-value', value: formatPercent(result.baseLtv) },
    { label: 'Cash to close', value: formatCurrency(result.cashToClose) },
  ];

  if (result.financedFeeAmount > 0) {
    snapshot.push({
      label: getFinancedFeeLabel(loanType),
      value: formatCurrency(result.financedFeeAmount),
    });
  }

  return (
    <section className="rounded-card border border-border bg-surface-raised p-5 shadow-card">
      <h2 className="text-eyebrow text-foreground-subtle">Most they can buy</h2>

      <p className="mt-2 text-numeric text-4xl font-bold tracking-[-0.03em] text-foreground">
        {formatCurrency(result.maxPurchasePrice)}
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 text-xs font-medium text-foreground-muted">
        <LockIcon className="h-3 w-3" aria-hidden />
        {bindingLabel}
      </p>

      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-foreground">Payment at that price</p>
          <p className="text-numeric text-lg font-bold text-foreground">
            {formatCurrency(result.totalMonthlyPayment)}
            <span className="ml-1 text-xs font-medium text-foreground-subtle">/mo</span>
          </p>
        </div>
        <dl className="mt-2 divide-y divide-border">
          {paymentRows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-foreground-muted">{row.label}</dt>
              <dd className="text-numeric text-sm font-semibold text-foreground">
                {formatCurrency(row.value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        {snapshot.map((item) => (
          <div key={item.label} className="rounded-lg bg-surface-muted px-3 py-2">
            <dt className="text-xs text-foreground-subtle">{item.label}</dt>
            <dd className="text-numeric mt-0.5 text-sm font-semibold text-foreground">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-foreground-subtle">
        Prices are rounded down to the nearest {formatCurrency(1000)} so the payment stays inside the
        limits. Cash to close covers the down payment plus estimated closing costs, not prepaid taxes
        and insurance.
      </p>
    </section>
  );
}
