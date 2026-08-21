'use client';

import { useMemo } from 'react';
import { SparklesIcon } from 'lucide-react';
import {
  calculateExtraPrincipalImpact,
  getLoanTypeInfo,
  type LoanType,
  type MortgageCalculations,
  type MortgageInputs,
} from '@/utils/mortgage-calculations';
import { ExtraPrincipalImpact } from './extra-principal-impact';
import { FieldGrid, FieldGroup, NumberField, SelectField } from './fields';
import { formatCurrency, formatPercent } from './formatters';
import { PaymentStackCard } from './payment-stack-card';
import { type NumberInputHandlers } from './use-number-inputs';

type MortgageFieldKey = Exclude<keyof MortgageInputs, 'loanType'>;

const loanTypeOptions = [
  { value: 'conventional', label: 'Conventional' },
  { value: 'fha', label: 'FHA' },
  { value: 'va', label: 'VA' },
  { value: 'usda', label: 'USDA' },
  { value: 'jumbo', label: 'Jumbo' },
];

interface CalculatorTabProps {
  inputs: MortgageInputs;
  calculations: MortgageCalculations;
  numberInputs: NumberInputHandlers<MortgageFieldKey>;
  onInputsPatch: (patch: Partial<MortgageInputs>) => void;
}

export function CalculatorTab({
  inputs,
  calculations,
  numberInputs,
  onInputsPatch,
}: CalculatorTabProps) {
  const loanType = inputs.loanType ?? 'conventional';
  const loanTypeInfo = getLoanTypeInfo(loanType);

  const extraPrincipalImpact = useMemo(() => {
    if (inputs.extraPrincipal === 0) return null;
    return calculateExtraPrincipalImpact(inputs, calculations);
  }, [inputs, calculations]);

  const insights = useMemo(() => {
    const ideas: string[] = [];

    if (loanType === 'conventional' && calculations.ltv > 0.8) {
      ideas.push(
        'Loan-to-value is above 80%, so mortgage insurance is included. A slightly larger down payment or a seller credit could remove it.'
      );
    }
    if (loanType === 'fha') {
      ideas.push(
        'FHA carries both an upfront and a monthly mortgage insurance premium. Conventional is usually cheaper with 20% down.'
      );
    }
    if (loanType === 'va') {
      ideas.push(
        'VA allows 0% down with no monthly mortgage insurance, though it does include a funding fee. Strong terms for eligible veterans.'
      );
    }
    if (inputs.interestRate >= 7) {
      ideas.push(
        'Rates are elevated. Offer a buydown or an ARM comparison to open up affordability for rate-sensitive buyers.'
      );
    } else if (inputs.interestRate < 6) {
      ideas.push(
        'Rates are comparatively favorable. Position urgency before the next move and highlight long-term stability.'
      );
    }
    if (inputs.extraPrincipal > 0) {
      ideas.push(
        'Extra principal each month accelerates payoff and saves interest. Quantify it for motivated buyers.'
      );
    } else {
      ideas.push(
        'Try a small recurring extra principal payment to show how quickly amortization accelerates.'
      );
    }

    ideas.push(
      'Use the payment breakdown to anchor a budget conversation and align on current lender programs.'
    );

    return ideas;
  }, [calculations.ltv, inputs.extraPrincipal, inputs.interestRate, loanType]);

  const snapshot = [
    { label: 'Loan amount', value: formatCurrency(calculations.loanAmount) },
    { label: 'Down payment', value: formatCurrency(calculations.downPaymentAmount) },
    { label: 'Loan-to-value', value: formatPercent(calculations.ltv) },
    { label: 'Total scheduled interest', value: formatCurrency(calculations.totalInterest) },
  ];

  if (calculations.upfrontMIP) {
    snapshot.push({ label: 'Upfront MIP', value: formatCurrency(calculations.upfrontMIP) });
  }
  if (calculations.fundingFee) {
    snapshot.push({ label: 'VA funding fee', value: formatCurrency(calculations.fundingFee) });
  }
  if (calculations.usdaGuaranteeFee) {
    snapshot.push({
      label: 'USDA guarantee fee',
      value: formatCurrency(calculations.usdaGuaranteeFee),
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <FieldGroup title="Loan">
          <div className="space-y-3">
            <SelectField
              label="Loan program"
              value={loanType}
              onChange={(value) => onInputsPatch({ loanType: value as LoanType })}
              options={loanTypeOptions}
              footnote={
                loanTypeInfo.minDownPaymentPercent > 0
                  ? `${loanTypeInfo.description} (minimum ${loanTypeInfo.minDownPaymentPercent}% down)`
                  : loanTypeInfo.description
              }
            />
            <FieldGrid>
              <NumberField
                label="Purchase price"
                prefix="$"
                value={numberInputs.format('purchasePrice', inputs.purchasePrice)}
                onChange={numberInputs.onChange('purchasePrice')}
                onBlur={numberInputs.onBlur('purchasePrice')}
                footnote={`${formatCurrency(calculations.loanAmount)} financed`}
              />
              <NumberField
                label="Down payment"
                suffix="%"
                decimal
                value={numberInputs.format('downPaymentPercent', inputs.downPaymentPercent)}
                onChange={numberInputs.onChange('downPaymentPercent')}
                onBlur={numberInputs.onBlur('downPaymentPercent')}
                footnote={`${formatCurrency(calculations.downPaymentAmount)} at closing`}
              />
              <NumberField
                label="Interest rate"
                suffix="%"
                decimal
                value={numberInputs.format('interestRate', inputs.interestRate)}
                onChange={numberInputs.onChange('interestRate')}
                onBlur={numberInputs.onBlur('interestRate')}
                footnote="Annual rate"
              />
              <NumberField
                label="Term"
                suffix="yrs"
                value={numberInputs.format('termYears', inputs.termYears)}
                onChange={numberInputs.onChange('termYears')}
                onBlur={numberInputs.onBlur('termYears')}
                footnote={`${inputs.termYears * 12} payments`}
              />
            </FieldGrid>
          </div>
        </FieldGroup>

        <FieldGroup title="Monthly costs">
          <FieldGrid>
            <NumberField
              label="Property tax rate"
              suffix="%"
              hint="per year"
              decimal
              value={numberInputs.format('propertyTaxRate', inputs.propertyTaxRate)}
              onChange={numberInputs.onChange('propertyTaxRate')}
              onBlur={numberInputs.onBlur('propertyTaxRate')}
              footnote={`${formatCurrency(calculations.propertyTaxes)} per month`}
            />
            <NumberField
              label="Homeowners insurance"
              prefix="$"
              hint="per month"
              value={numberInputs.format('insuranceMonthly', inputs.insuranceMonthly)}
              onChange={numberInputs.onChange('insuranceMonthly')}
              onBlur={numberInputs.onBlur('insuranceMonthly')}
              footnote={`${formatCurrency(inputs.insuranceMonthly * 12)} per year`}
            />
            <NumberField
              label="HOA dues"
              prefix="$"
              hint="per month"
              value={numberInputs.format('hoaMonthly', inputs.hoaMonthly)}
              onChange={numberInputs.onChange('hoaMonthly')}
              onBlur={numberInputs.onBlur('hoaMonthly')}
              footnote={inputs.hoaMonthly > 0 ? `${formatCurrency(inputs.hoaMonthly * 12)} per year` : 'No HOA'}
            />
            {loanTypeInfo.hasPMI ? (
              <NumberField
                label={loanType === 'fha' ? 'Annual MIP rate' : 'PMI rate'}
                suffix="%"
                hint="per year"
                decimal
                value={numberInputs.format('pmiRate', inputs.pmiRate)}
                onChange={numberInputs.onChange('pmiRate')}
                onBlur={numberInputs.onBlur('pmiRate')}
                footnote={
                  loanType === 'fha'
                    ? 'Applies to every FHA loan'
                    : 'Applies under 20% down'
                }
              />
            ) : null}
            <NumberField
              label="Extra principal"
              prefix="$"
              hint="per month"
              value={numberInputs.format('extraPrincipal', inputs.extraPrincipal)}
              onChange={numberInputs.onChange('extraPrincipal')}
              onBlur={numberInputs.onBlur('extraPrincipal')}
              footnote="Shows payoff acceleration"
            />
          </FieldGrid>
        </FieldGroup>
      </div>

      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <PaymentStackCard
          inputs={inputs}
          calculations={calculations}
          loanTypeName={loanTypeInfo.name}
        />

        <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <h3 className="text-eyebrow text-foreground-subtle">Loan snapshot</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {snapshot.map((item) => (
              <div key={item.label} className="rounded-lg bg-surface-muted px-3 py-2">
                <dt className="text-xs text-foreground-subtle">{item.label}</dt>
                <dd className="text-numeric mt-0.5 text-base font-semibold text-foreground">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {extraPrincipalImpact ? (
          <ExtraPrincipalImpact
            monthsSaved={extraPrincipalImpact.monthsSaved}
            yearsSaved={extraPrincipalImpact.yearsSaved}
            interestSaved={extraPrincipalImpact.interestSaved}
            originalPayoffDate={extraPrincipalImpact.originalPayoffDate}
            newPayoffDate={extraPrincipalImpact.newPayoffDate}
            extraPrincipalAmount={inputs.extraPrincipal}
            originalMonths={extraPrincipalImpact.originalMonths}
            newMonths={extraPrincipalImpact.newMonths}
          />
        ) : null}

        <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-eyebrow text-foreground-subtle">
            <SparklesIcon className="h-3.5 w-3.5 text-signal" aria-hidden />
            Coaching angles
          </h3>
          <ul className="mt-2 divide-y divide-border">
            {insights.map((insight) => (
              <li key={insight} className="py-2 text-sm leading-5 text-foreground-muted last:pb-0">
                {insight}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
