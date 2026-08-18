'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardIcon, Share2Icon, AlertTriangleIcon, WalletIcon } from 'lucide-react';
import {
  AffordabilityInput,
  DEFAULT_CONFORMING_LOAN_LIMIT,
  DownPaymentMode,
  calculateAffordability,
  describeBindingConstraint,
  getMortgageInsuranceLabel,
  getProgramGuidelines,
} from '@/utils/affordability';
import { LoanType, MortgageInputs, getLoanTypeInfo } from '@/utils/mortgage-calculations';
import { AffordabilityResultCard } from './affordability-result-card';
import { AffordabilityRatioMeters } from './affordability-ratio-meters';
import { BuyingPowerLeversPanel } from './buying-power-levers';
import { formatCurrency, formatSignedCurrency } from './formatters';
import { useNumberInputs } from './use-number-inputs';

type IncomeMode = 'monthly' | 'annual';

type BorrowerFieldKey =
  | 'incomeValue'
  | 'monthlyDebts'
  | 'downPaymentAmount'
  | 'downPaymentPercent'
  | 'cashOnHand'
  | 'closingCostPercent'
  | 'comfortBudget'
  | 'frontEndCapPercent'
  | 'backEndCapPercent'
  | 'conformingLoanLimit';

type LoanFieldKey =
  | 'interestRate'
  | 'termYears'
  | 'propertyTaxRate'
  | 'insuranceMonthly'
  | 'hoaMonthly'
  | 'pmiRate';

interface BorrowerState {
  incomeMode: IncomeMode;
  incomeValue: number;
  monthlyDebts: number;
  downPaymentMode: DownPaymentMode;
  downPaymentAmount: number;
  downPaymentPercent: number;
  useCashLimit: boolean;
  cashOnHand: number;
  closingCostPercent: number;
  useComfortBudget: boolean;
  comfortBudget: number;
  frontEndCapPercent: number | null;
  backEndCapPercent: number;
  conformingLoanLimit: number;
}

const INPUT_CLASS =
  'w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring';

function isLoanType(value: string | null): value is LoanType {
  return (
    value === 'conventional' ||
    value === 'fha' ||
    value === 'va' ||
    value === 'usda' ||
    value === 'jumbo'
  );
}

function defaultBorrowerState(loanType: LoanType): BorrowerState {
  const guidelines = getProgramGuidelines(loanType);
  return {
    incomeMode: 'monthly',
    incomeValue: 8_000,
    monthlyDebts: 500,
    downPaymentMode: 'amount',
    downPaymentAmount: 50_000,
    downPaymentPercent: 5,
    useCashLimit: false,
    cashOnHand: 65_000,
    closingCostPercent: 3,
    useComfortBudget: false,
    comfortBudget: 3_000,
    frontEndCapPercent: guidelines.frontEndCapPercent,
    backEndCapPercent: guidelines.backEndCapPercent,
    conformingLoanLimit: DEFAULT_CONFORMING_LOAN_LIMIT,
  };
}

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  footnote?: string;
  decimal?: boolean;
  disabled?: boolean;
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  onBlur,
  footnote,
  decimal,
  disabled,
}: NumberFieldProps) {
  return (
    <label className={`space-y-2 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-sm font-medium text-foreground-muted">
        {label}
        {hint ? <span className="text-xs text-foreground-subtle">{hint}</span> : null}
      </div>
      <input
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        className={INPUT_CLASS}
      />
      {footnote ? <p className="text-xs text-foreground-subtle">{footnote}</p> : null}
    </label>
  );
}

interface SegmentedToggleProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

function SegmentedToggle({ options, value, onChange, ariaLabel }: SegmentedToggleProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded px-2.5 py-1 text-xs font-medium ${
            value === option.value
              ? 'bg-primary text-white'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface AffordabilityCalculatorProps {
  /** Loan terms shared with the Calculator tab, so both tabs describe one scenario. */
  loanInputs: MortgageInputs;
  onLoanInputsChange: (patch: Partial<MortgageInputs>) => void;
  onUseResults?: (patch: Partial<MortgageInputs>) => void;
}

export function AffordabilityCalculator({
  loanInputs,
  onLoanInputsChange,
  onUseResults,
}: AffordabilityCalculatorProps) {
  const loanType = loanInputs.loanType ?? 'conventional';

  const [borrower, setBorrower] = useState<BorrowerState>(() => defaultBorrowerState(loanType));
  const [capsProgram, setCapsProgram] = useState<LoanType>(loanType);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  // Switching programs swaps in that program's qualifying limits.
  if (capsProgram !== loanType) {
    const guidelines = getProgramGuidelines(loanType);
    setCapsProgram(loanType);
    setBorrower((prev) => ({
      ...prev,
      frontEndCapPercent: guidelines.frontEndCapPercent,
      backEndCapPercent: guidelines.backEndCapPercent,
    }));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (Array.from(params.keys()).length === 0) return;

    const readNumber = (key: string): number | null => {
      const raw = params.get(key);
      if (raw === null) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    };

    // The shared program arrives from the Calculator tab's own restore pass. Claim
    // it here so the caps land on that program's defaults once, then let any caps
    // in the link override them.
    const sharedLoanType = params.get('type');
    const sharedGuidelines = isLoanType(sharedLoanType)
      ? getProgramGuidelines(sharedLoanType)
      : null;
    if (isLoanType(sharedLoanType)) setCapsProgram(sharedLoanType);

    setBorrower((prev) => {
      const next = { ...prev };
      if (sharedGuidelines) {
        next.frontEndCapPercent = sharedGuidelines.frontEndCapPercent;
        next.backEndCapPercent = sharedGuidelines.backEndCapPercent;
      }
      const income = readNumber('income');
      if (income !== null) {
        next.incomeMode = 'monthly';
        next.incomeValue = income;
      }
      const debts = readNumber('debts');
      if (debts !== null) next.monthlyDebts = debts;
      const downAmount = readNumber('dpAmount');
      if (downAmount !== null) {
        next.downPaymentMode = 'amount';
        next.downPaymentAmount = downAmount;
      }
      const downPercent = readNumber('dpPercent');
      if (downPercent !== null) {
        next.downPaymentMode = 'percent';
        next.downPaymentPercent = downPercent;
      }
      const cash = readNumber('cash');
      if (cash !== null) {
        next.useCashLimit = true;
        next.cashOnHand = cash;
      }
      const closingCosts = readNumber('cc');
      if (closingCosts !== null) next.closingCostPercent = closingCosts;
      const budget = readNumber('budget');
      if (budget !== null) {
        next.useComfortBudget = true;
        next.comfortBudget = budget;
      }
      const frontCap = readNumber('feCap');
      if (frontCap !== null) next.frontEndCapPercent = frontCap;
      const backCap = readNumber('beCap');
      if (backCap !== null) next.backEndCapPercent = backCap;
      const limit = readNumber('limit');
      if (limit !== null) next.conformingLoanLimit = limit;
      return next;
    });
  }, []);

  const handleBorrowerNumber = useCallback((key: BorrowerFieldKey, value: number) => {
    setBorrower((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleLoanNumber = useCallback(
    (key: LoanFieldKey, value: number) => {
      onLoanInputsChange({ [key]: value });
    },
    [onLoanInputsChange]
  );

  const borrowerInputs = useNumberInputs<BorrowerFieldKey>(handleBorrowerNumber);
  const loanFields = useNumberInputs<LoanFieldKey>(handleLoanNumber);

  const grossMonthlyIncome =
    borrower.incomeMode === 'annual' ? borrower.incomeValue / 12 : borrower.incomeValue;

  const affordabilityInput = useMemo<AffordabilityInput>(
    () => ({
      loanType,
      grossMonthlyIncome,
      monthlyDebts: borrower.monthlyDebts,
      downPaymentMode: borrower.downPaymentMode,
      downPaymentAmount: borrower.downPaymentAmount,
      downPaymentPercent: borrower.downPaymentPercent,
      cashOnHand: borrower.useCashLimit ? borrower.cashOnHand : null,
      closingCostPercent: borrower.closingCostPercent,
      comfortBudget: borrower.useComfortBudget ? borrower.comfortBudget : null,
      interestRate: loanInputs.interestRate,
      termYears: loanInputs.termYears,
      propertyTaxRate: loanInputs.propertyTaxRate,
      insuranceMonthly: loanInputs.insuranceMonthly,
      hoaMonthly: loanInputs.hoaMonthly,
      annualMiRate: loanInputs.pmiRate,
      frontEndCapPercent: borrower.frontEndCapPercent,
      backEndCapPercent: borrower.backEndCapPercent,
      conformingLoanLimit: borrower.conformingLoanLimit,
    }),
    [borrower, grossMonthlyIncome, loanInputs, loanType]
  );

  const result = useMemo(() => calculateAffordability(affordabilityInput), [affordabilityInput]);

  const bindingLabel = describeBindingConstraint(result.bindingConstraint, affordabilityInput);
  const loanTypeInfo = getLoanTypeInfo(loanType);
  const showMiRateField = loanType === 'conventional' || loanType === 'fha';

  const flashCopyMessage = (message: string) => {
    setCopyMessage(message);
    setTimeout(() => setCopyMessage(null), 2_000);
  };

  const handleUseResults = () => {
    onUseResults?.({
      purchasePrice: result.maxPurchasePrice,
      downPaymentPercent: result.downPaymentPercent,
      loanType,
    });
  };

  const handleCopySummary = () => {
    const lines = [
      'What you can buy',
      `Maximum purchase price: ${formatCurrency(result.maxPurchasePrice)}`,
      `Estimated monthly payment: ${formatCurrency(result.totalMonthlyPayment)}`,
      `  Loan payment: ${formatCurrency(result.principalAndInterest)}`,
      `  Property taxes: ${formatCurrency(result.propertyTaxes)}`,
      `  Homeowners insurance: ${formatCurrency(result.insuranceMonthly)}`,
      `  HOA dues: ${formatCurrency(result.hoaMonthly)}`,
    ];

    if (result.mortgageInsuranceMonthly > 0) {
      lines.push(
        `  ${getMortgageInsuranceLabel(loanType)}: ${formatCurrency(result.mortgageInsuranceMonthly)}`
      );
    }

    lines.push(
      '',
      `Down payment: ${formatCurrency(result.downPaymentAmount)} (${result.downPaymentPercent.toFixed(1)}%)`,
      `Loan amount: ${formatCurrency(result.totalLoanAmount)}`,
      `Cash needed at closing: about ${formatCurrency(result.cashToClose)}`,
      `Loan type: ${loanTypeInfo.name} at ${loanInputs.interestRate}% for ${loanInputs.termYears} years`,
      `What sets the limit: ${bindingLabel.toLowerCase()}`
    );

    const topLevers = [
      ...result.levers.debtPaydown,
      ...result.levers.extraDownPayment,
      ...result.levers.incomeIncrease,
    ].filter((lever) => lever.priceDelta > 0);

    if (topLevers.length > 0) {
      lines.push('', 'Ways to raise this number:');
      for (const lever of topLevers) {
        lines.push(
          `- ${lever.label}: ${formatCurrency(lever.maxPurchasePrice)} (${formatSignedCurrency(lever.priceDelta)})`
        );
      }
    }

    lines.push(
      '',
      'These are estimates for planning. Your lender\u2019s approval and disclosures are the final word.'
    );

    navigator.clipboard.writeText(lines.join('\n'));
    flashCopyMessage('Buyer summary copied.');
  };

  const handleShareLink = () => {
    const params = new URLSearchParams({
      tab: 'affordability',
      type: loanType,
      rate: String(loanInputs.interestRate),
      term: String(loanInputs.termYears),
      tax: String(loanInputs.propertyTaxRate),
      insurance: String(loanInputs.insuranceMonthly),
      hoa: String(loanInputs.hoaMonthly),
      pmi: String(loanInputs.pmiRate),
      income: grossMonthlyIncome.toFixed(2),
      debts: String(borrower.monthlyDebts),
      cc: String(borrower.closingCostPercent),
      beCap: String(borrower.backEndCapPercent),
      limit: String(borrower.conformingLoanLimit),
    });

    if (borrower.downPaymentMode === 'amount') {
      params.set('dpAmount', String(borrower.downPaymentAmount));
    } else {
      params.set('dpPercent', String(borrower.downPaymentPercent));
    }
    if (borrower.useCashLimit) params.set('cash', String(borrower.cashOnHand));
    if (borrower.useComfortBudget) params.set('budget', String(borrower.comfortBudget));
    if (borrower.frontEndCapPercent !== null) {
      params.set('feCap', String(borrower.frontEndCapPercent));
    }

    navigator.clipboard.writeText(
      `${window.location.origin}${window.location.pathname}?${params.toString()}`
    );
    flashCopyMessage('Share link copied.');
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <WalletIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">What can they buy?</h2>
          <p className="text-sm text-foreground-muted">
            Works the way a pre-qualification does: income and debts set the payment they can carry,
            then cash on hand and program rules cap the price.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Income &amp; debts</h3>
              <SegmentedToggle
                ariaLabel="Income period"
                value={borrower.incomeMode}
                onChange={(value) =>
                  setBorrower((prev) => {
                    const incomeMode = value as IncomeMode;
                    if (incomeMode === prev.incomeMode) return prev;
                    return {
                      ...prev,
                      incomeMode,
                      incomeValue:
                        incomeMode === 'annual' ? prev.incomeValue * 12 : prev.incomeValue / 12,
                    };
                  })
                }
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'annual', label: 'Annual' },
                ]}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <NumberField
                label="Gross income"
                hint={borrower.incomeMode === 'annual' ? 'Per year' : 'Per month'}
                value={borrowerInputs.format('incomeValue', borrower.incomeValue)}
                onChange={borrowerInputs.onChange('incomeValue')}
                onBlur={borrowerInputs.onBlur('incomeValue')}
                footnote={
                  borrower.incomeMode === 'annual'
                    ? `${formatCurrency(grossMonthlyIncome)} per month`
                    : 'Before taxes, all borrowers combined'
                }
              />
              <NumberField
                label="Monthly debt payments"
                hint="Per month"
                value={borrowerInputs.format('monthlyDebts', borrower.monthlyDebts)}
                onChange={borrowerInputs.onChange('monthlyDebts')}
                onBlur={borrowerInputs.onBlur('monthlyDebts')}
                footnote="Car loans, credit card minimums, student loans"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Down payment &amp; cash</h3>
              <SegmentedToggle
                ariaLabel="Down payment entry"
                value={borrower.downPaymentMode}
                onChange={(value) =>
                  setBorrower((prev) => ({ ...prev, downPaymentMode: value as DownPaymentMode }))
                }
                options={[
                  { value: 'amount', label: 'Dollars' },
                  { value: 'percent', label: 'Percent' },
                ]}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {borrower.downPaymentMode === 'amount' ? (
                <NumberField
                  label="Down payment"
                  hint="USD"
                  value={borrowerInputs.format('downPaymentAmount', borrower.downPaymentAmount)}
                  onChange={borrowerInputs.onChange('downPaymentAmount')}
                  onBlur={borrowerInputs.onBlur('downPaymentAmount')}
                  footnote={`${result.downPaymentPercent.toFixed(1)}% at the max price`}
                />
              ) : (
                <NumberField
                  label="Down payment"
                  hint="% of price"
                  decimal
                  value={borrowerInputs.format('downPaymentPercent', borrower.downPaymentPercent)}
                  onChange={borrowerInputs.onChange('downPaymentPercent')}
                  onBlur={borrowerInputs.onBlur('downPaymentPercent')}
                  footnote={`${formatCurrency(result.downPaymentAmount)} at the max price`}
                />
              )}
              <NumberField
                label="Closing costs"
                hint="% of price"
                decimal
                value={borrowerInputs.format('closingCostPercent', borrower.closingCostPercent)}
                onChange={borrowerInputs.onChange('closingCostPercent')}
                onBlur={borrowerInputs.onBlur('closingCostPercent')}
                footnote={`${formatCurrency(result.closingCosts)} at the max price`}
              />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground-muted">
              <input
                type="checkbox"
                checked={borrower.useCashLimit}
                onChange={(event) =>
                  setBorrower((prev) => ({ ...prev, useCashLimit: event.target.checked }))
                }
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              Cap the price by the cash they actually have
            </label>
            {borrower.useCashLimit ? (
              <div className="mt-3">
                <NumberField
                  label="Total cash available"
                  hint="USD"
                  value={borrowerInputs.format('cashOnHand', borrower.cashOnHand)}
                  onChange={borrowerInputs.onChange('cashOnHand')}
                  onBlur={borrowerInputs.onBlur('cashOnHand')}
                  footnote="Must cover the down payment and closing costs together"
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Comfort check</h3>
            <label className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground-muted">
              <input
                type="checkbox"
                checked={borrower.useComfortBudget}
                onChange={(event) =>
                  setBorrower((prev) => ({ ...prev, useComfortBudget: event.target.checked }))
                }
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              Also cap the payment at what they say they want to spend
            </label>
            {borrower.useComfortBudget ? (
              <div className="mt-3">
                <NumberField
                  label="Target monthly payment"
                  hint="Per month"
                  value={borrowerInputs.format('comfortBudget', borrower.comfortBudget)}
                  onChange={borrowerInputs.onChange('comfortBudget')}
                  onBlur={borrowerInputs.onBlur('comfortBudget')}
                  footnote="Covers the full payment, including taxes, insurance, HOA, and mortgage insurance"
                />
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground-subtle">
                Turn this on to compare what they qualify for against what they want to pay.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Loan assumptions</h3>
            <p className="mt-1 text-xs text-foreground-subtle">
              Shared with the Calculator tab, so both tabs stay on the same scenario.
            </p>
            <label className="mt-3 block space-y-2">
              <div className="text-sm font-medium text-foreground-muted">Loan program</div>
              <select
                value={loanType}
                onChange={(event) =>
                  onLoanInputsChange({ loanType: event.target.value as LoanType })
                }
                className={INPUT_CLASS}
              >
                <option value="conventional">Conventional</option>
                <option value="fha">FHA</option>
                <option value="va">VA</option>
                <option value="usda">USDA</option>
                <option value="jumbo">Jumbo</option>
              </select>
              <p className="text-xs text-foreground-subtle">
                {loanTypeInfo.description}
                {loanTypeInfo.minDownPaymentPercent > 0
                  ? ` (Min ${loanTypeInfo.minDownPaymentPercent}% down)`
                  : ''}
              </p>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <NumberField
                label="Interest rate"
                hint="Annual %"
                decimal
                value={loanFields.format('interestRate', loanInputs.interestRate)}
                onChange={loanFields.onChange('interestRate')}
                onBlur={loanFields.onBlur('interestRate')}
              />
              <NumberField
                label="Term"
                hint="Years"
                value={loanFields.format('termYears', loanInputs.termYears)}
                onChange={loanFields.onChange('termYears')}
                onBlur={loanFields.onBlur('termYears')}
              />
              <NumberField
                label="Property tax rate"
                hint="% / year"
                decimal
                value={loanFields.format('propertyTaxRate', loanInputs.propertyTaxRate)}
                onChange={loanFields.onChange('propertyTaxRate')}
                onBlur={loanFields.onBlur('propertyTaxRate')}
              />
              <NumberField
                label="Homeowners insurance"
                hint="Monthly"
                value={loanFields.format('insuranceMonthly', loanInputs.insuranceMonthly)}
                onChange={loanFields.onChange('insuranceMonthly')}
                onBlur={loanFields.onBlur('insuranceMonthly')}
              />
              <NumberField
                label="HOA dues"
                hint="Monthly"
                value={loanFields.format('hoaMonthly', loanInputs.hoaMonthly)}
                onChange={loanFields.onChange('hoaMonthly')}
                onBlur={loanFields.onBlur('hoaMonthly')}
              />
              {showMiRateField ? (
                <NumberField
                  label={loanType === 'fha' ? 'Annual MIP rate' : 'PMI rate'}
                  hint="Annual %"
                  decimal
                  value={loanFields.format('pmiRate', loanInputs.pmiRate)}
                  onChange={loanFields.onChange('pmiRate')}
                  onBlur={loanFields.onBlur('pmiRate')}
                />
              ) : null}
            </div>
          </div>

          <details className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Qualifying limits
            </summary>
            <p className="mt-2 text-xs text-foreground-subtle">
              {result.guidelines.guidelineNote}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {borrower.frontEndCapPercent === null ? (
                <div className="text-xs text-foreground-subtle">
                  {result.guidelines.name} does not use a housing payment limit.
                </div>
              ) : (
                <NumberField
                  label="Housing payment cap"
                  hint="% of income"
                  decimal
                  value={borrowerInputs.format('frontEndCapPercent', borrower.frontEndCapPercent)}
                  onChange={borrowerInputs.onChange('frontEndCapPercent')}
                  onBlur={borrowerInputs.onBlur('frontEndCapPercent')}
                />
              )}
              <NumberField
                label="Total debt cap"
                hint="% of income"
                decimal
                value={borrowerInputs.format('backEndCapPercent', borrower.backEndCapPercent)}
                onChange={borrowerInputs.onChange('backEndCapPercent')}
                onBlur={borrowerInputs.onBlur('backEndCapPercent')}
              />
              <NumberField
                label="Conforming loan limit"
                hint="USD"
                value={borrowerInputs.format(
                  'conformingLoanLimit',
                  borrower.conformingLoanLimit
                )}
                onChange={borrowerInputs.onChange('conformingLoanLimit')}
                onBlur={borrowerInputs.onBlur('conformingLoanLimit')}
                footnote="Update for high-cost counties"
              />
            </div>
          </details>
        </div>

        <div className="space-y-4">
          <AffordabilityResultCard
            result={result}
            loanType={loanType}
            bindingLabel={bindingLabel}
          />

          <AffordabilityRatioMeters
            grossMonthlyIncome={grossMonthlyIncome}
            frontEndRatio={result.frontEndRatio}
            backEndRatio={result.backEndRatio}
            frontEndCapPercent={borrower.frontEndCapPercent}
            backEndCapPercent={borrower.backEndCapPercent}
            frontEndHeadroom={result.frontEndHeadroom}
            backEndHeadroom={result.backEndHeadroom}
            guidelineNote={result.guidelines.guidelineNote}
          />

          {result.warnings.length > 0 ? (
            <ul className="space-y-2">
              {result.warnings.map((warning) => (
                <li
                  key={warning.id}
                  className={`flex gap-2 rounded-md px-3 py-2 text-sm ${
                    warning.severity === 'warning'
                      ? 'bg-warning-soft text-warning'
                      : 'bg-surface-muted text-foreground-muted'
                  }`}
                >
                  <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <BuyingPowerLeversPanel
            levers={result.levers}
            bindingConstraint={result.bindingConstraint}
          />

          {copyMessage ? (
            <div className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
              {copyMessage}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {onUseResults ? (
              <button
                type="button"
                onClick={handleUseResults}
                className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                Use this price in the Calculator
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            >
              <ClipboardIcon className="h-4 w-4" />
              Copy buyer summary
            </button>
            <button
              type="button"
              onClick={handleShareLink}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            >
              <Share2Icon className="h-4 w-4" />
              Share link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
