'use client';

import { HomeIcon, LockIcon } from 'lucide-react';
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
  return (
    <div className="rounded-lg border border-primary/20 bg-primary-soft p-4">
      <div className="flex items-center gap-2">
        <HomeIcon className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold text-primary">Most they can buy</h3>
      </div>

      <div className="mt-4 rounded-md bg-surface-raised p-4 shadow-sm">
        <p className="text-sm text-foreground-muted">Maximum purchase price</p>
        <p className="mt-1 text-3xl font-bold text-foreground">
          {formatCurrency(result.maxPurchasePrice)}
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-foreground-muted">
          <LockIcon className="h-3 w-3" />
          {bindingLabel}
        </p>
        <p className="mt-2 text-xs text-foreground-subtle">
          Rounded down to the nearest {formatCurrency(1000)} so the payment below stays inside the
          limits.
        </p>
      </div>

      <div className="mt-4 rounded-md bg-surface-raised p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Payment at that price</p>
        <dl className="mt-3 space-y-2 text-sm text-foreground-muted">
          <div className="flex items-center justify-between">
            <dt>Principal &amp; interest</dt>
            <dd className="font-semibold text-foreground">
              {formatCurrency(result.principalAndInterest)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Property taxes</dt>
            <dd className="font-semibold text-foreground">{formatCurrency(result.propertyTaxes)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Homeowners insurance</dt>
            <dd className="font-semibold text-foreground">
              {formatCurrency(result.insuranceMonthly)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>HOA dues</dt>
            <dd className="font-semibold text-foreground">{formatCurrency(result.hoaMonthly)}</dd>
          </div>
          {result.mortgageInsuranceMonthly > 0 ? (
            <div className="flex items-center justify-between text-primary">
              <dt className="font-semibold">{getMortgageInsuranceLabel(loanType)}</dt>
              <dd className="font-semibold">{formatCurrency(result.mortgageInsuranceMonthly)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-3 flex items-center justify-between rounded-md bg-surface-muted px-3 py-2">
          <span className="text-sm font-semibold text-foreground-muted">Total monthly payment</span>
          <span className="text-lg font-bold text-foreground">
            {formatCurrency(result.totalMonthlyPayment)}
          </span>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-raised px-3 py-2 shadow-sm">
          <dt className="text-xs text-foreground-subtle">Loan amount</dt>
          <dd className="text-base font-semibold text-foreground">
            {formatCurrency(result.totalLoanAmount)}
          </dd>
        </div>
        <div className="rounded-md bg-surface-raised px-3 py-2 shadow-sm">
          <dt className="text-xs text-foreground-subtle">Down payment</dt>
          <dd className="text-base font-semibold text-foreground">
            {formatCurrency(result.downPaymentAmount)}
            <span className="ml-1 text-xs font-medium text-foreground-subtle">
              {result.downPaymentPercent.toFixed(1)}%
            </span>
          </dd>
        </div>
        <div className="rounded-md bg-surface-raised px-3 py-2 shadow-sm">
          <dt className="text-xs text-foreground-subtle">Loan-to-value</dt>
          <dd className="text-base font-semibold text-foreground">
            {formatPercent(result.baseLtv)}
          </dd>
        </div>
        <div className="rounded-md bg-surface-raised px-3 py-2 shadow-sm">
          <dt className="text-xs text-foreground-subtle">Cash needed to close</dt>
          <dd className="text-base font-semibold text-foreground">
            {formatCurrency(result.cashToClose)}
          </dd>
        </div>
        {result.financedFeeAmount > 0 ? (
          <div className="col-span-2 rounded-md bg-surface-raised px-3 py-2 shadow-sm">
            <dt className="text-xs text-foreground-subtle">{getFinancedFeeLabel(loanType)}</dt>
            <dd className="text-base font-semibold text-foreground">
              {formatCurrency(result.financedFeeAmount)}
              <span className="ml-1 text-xs font-medium text-foreground-subtle">
                on a {formatCurrency(result.baseLoanAmount)} base loan
              </span>
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-3 text-xs text-foreground-subtle">
        Cash to close covers the down payment plus estimated closing costs. It does not include
        prepaid taxes and insurance the lender may collect at settlement.
      </p>
    </div>
  );
}
