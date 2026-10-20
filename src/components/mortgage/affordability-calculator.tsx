'use client';

import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AffordabilityInput,
  DEFAULT_CONFORMING_LOAN_LIMIT,
  DownPaymentMode,
  calculateAffordability,
  describeBindingConstraint,
  describeMortgageInsuranceDuration,
  getMortgageInsuranceLabel,
  getProgramGuidelines,
} from '@/utils/affordability';
import { LoanType, MortgageInputs, getLoanTypeInfo, isLoanType } from '@/utils/mortgage-calculations';
import { AffordabilityResultCard } from './affordability-result-card';
import { AffordabilityRatioMeters } from './affordability-ratio-meters';
import { BuyingPowerLeversPanel } from './buying-power-levers';
import {
  loadAffordabilityState,
  loadCalculatorState,
  parseFiniteNumber,
  saveAffordabilityState,
} from './calculator-state';
import { copyToClipboard } from './copy-to-clipboard';
import {
  CheckboxField,
  FieldGrid,
  FieldGroup,
  NumberField,
  SegmentedToggle,
  SelectField,
} from './fields';
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

const loanTypeOptions = [
  { value: 'conventional', label: 'Conventional' },
  { value: 'fha', label: 'FHA' },
  { value: 'va', label: 'VA' },
  { value: 'usda', label: 'USDA' },
  { value: 'jumbo', label: 'Jumbo' },
];

/** How long to wait after the last edit before writing state to storage. */
const SAVE_DEBOUNCE_MS = 400;

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

/** Borrower details from storage, which may have been written by an older release. */
function sanitizeBorrowerState(value: unknown, fallback: BorrowerState): BorrowerState {
  if (typeof value !== 'object' || value === null) return fallback;
  const record = value as Record<string, unknown>;

  const number = (key: keyof BorrowerState, current: number): number => {
    const raw = record[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : current;
  };
  const flag = (key: keyof BorrowerState, current: boolean): boolean => {
    const raw = record[key];
    return typeof raw === 'boolean' ? raw : current;
  };

  const storedFrontCap = record.frontEndCapPercent;
  const frontEndCapPercent =
    storedFrontCap === null
      ? null
      : typeof storedFrontCap === 'number' && Number.isFinite(storedFrontCap)
      ? storedFrontCap
      : fallback.frontEndCapPercent;

  return {
    incomeMode: record.incomeMode === 'annual' ? 'annual' : 'monthly',
    incomeValue: number('incomeValue', fallback.incomeValue),
    monthlyDebts: number('monthlyDebts', fallback.monthlyDebts),
    downPaymentMode: record.downPaymentMode === 'percent' ? 'percent' : 'amount',
    downPaymentAmount: number('downPaymentAmount', fallback.downPaymentAmount),
    downPaymentPercent: number('downPaymentPercent', fallback.downPaymentPercent),
    useCashLimit: flag('useCashLimit', fallback.useCashLimit),
    cashOnHand: number('cashOnHand', fallback.cashOnHand),
    closingCostPercent: number('closingCostPercent', fallback.closingCostPercent),
    useComfortBudget: flag('useComfortBudget', fallback.useComfortBudget),
    comfortBudget: number('comfortBudget', fallback.comfortBudget),
    frontEndCapPercent,
    backEndCapPercent: number('backEndCapPercent', fallback.backEndCapPercent),
    conformingLoanLimit: number('conformingLoanLimit', fallback.conformingLoanLimit),
  };
}

/** Copy and share are driven from the page header, which owns those buttons. */
export interface AffordabilityActions {
  copySummary: () => void;
  shareLink: () => void;
}

interface AffordabilityCalculatorProps {
  /** Loan terms shared with the Calculator tab, so both tabs describe one scenario. */
  loanInputs: MortgageInputs;
  onLoanInputsChange: (patch: Partial<MortgageInputs>) => void;
  onUseResults?: (patch: Partial<MortgageInputs>) => void;
  actionsRef?: MutableRefObject<AffordabilityActions | null>;
}

export function AffordabilityCalculator({
  loanInputs,
  onLoanInputsChange,
  onUseResults,
  actionsRef,
}: AffordabilityCalculatorProps) {
  const loanType = loanInputs.loanType ?? 'conventional';

  const [borrower, setBorrower] = useState<BorrowerState>(() => defaultBorrowerState(loanType));
  const [capsProgram, setCapsProgram] = useState<LoanType>(loanType);
  // Storage is read after mount to keep the server and client markup identical,
  // so saving has to wait until that read has happened.
  const [hasRestoredState, setHasRestoredState] = useState(false);

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
    const hasLink = Array.from(params.keys()).length > 0;

    // The program arrives from the Calculator tab's own restore pass, whether
    // from the link or from storage. Claim it here so the caps land on that
    // program's defaults before the render-time check would reset them, then
    // let the link or the saved profile override those defaults.
    const linkLoanType = params.get('type');
    const incomingLoanType = isLoanType(linkLoanType)
      ? linkLoanType
      : loadCalculatorState().inputs.loanType ?? null;
    if (incomingLoanType) setCapsProgram(incomingLoanType);

    // A share link describes one specific borrower, so it replaces rather than
    // merges with whatever profile was last left on this device.
    const storedBorrower = hasLink ? null : loadAffordabilityState();

    setBorrower((prev) => {
      let next = { ...prev };

      if (incomingLoanType) {
        const guidelines = getProgramGuidelines(incomingLoanType);
        next.frontEndCapPercent = guidelines.frontEndCapPercent;
        next.backEndCapPercent = guidelines.backEndCapPercent;
      }
      if (storedBorrower) {
        next = sanitizeBorrowerState(storedBorrower, next);
      }

      const income = parseFiniteNumber(params.get('income'));
      if (income !== null) {
        next.incomeMode = 'monthly';
        next.incomeValue = income;
      }
      const debts = parseFiniteNumber(params.get('debts'));
      if (debts !== null) next.monthlyDebts = debts;
      const downAmount = parseFiniteNumber(params.get('dpAmount'));
      if (downAmount !== null) {
        next.downPaymentMode = 'amount';
        next.downPaymentAmount = downAmount;
      }
      const downPercent = parseFiniteNumber(params.get('dpPercent'));
      if (downPercent !== null) {
        next.downPaymentMode = 'percent';
        next.downPaymentPercent = downPercent;
      }
      const cash = parseFiniteNumber(params.get('cash'));
      if (cash !== null) {
        next.useCashLimit = true;
        next.cashOnHand = cash;
      }
      const closingCosts = parseFiniteNumber(params.get('cc'));
      if (closingCosts !== null) next.closingCostPercent = closingCosts;
      const budget = parseFiniteNumber(params.get('budget'));
      if (budget !== null) {
        next.useComfortBudget = true;
        next.comfortBudget = budget;
      }
      const frontCap = parseFiniteNumber(params.get('feCap'));
      if (frontCap !== null) next.frontEndCapPercent = frontCap;
      const backCap = parseFiniteNumber(params.get('beCap'));
      if (backCap !== null) next.backEndCapPercent = backCap;
      const limit = parseFiniteNumber(params.get('limit'));
      if (limit !== null) next.conformingLoanLimit = limit;

      return next;
    });

    setHasRestoredState(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredState) return undefined;

    const timer = setTimeout(() => saveAffordabilityState(borrower), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hasRestoredState, borrower]);

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
      vaSubsequentUse: loanInputs.vaSubsequentUse ?? false,
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
  const showMiRateField = loanTypeInfo.hasPMI;
  const miDuration = describeMortgageInsuranceDuration(result.mortgageInsuranceMonths);

  const handleUseResults = () => {
    onUseResults?.({
      purchasePrice: result.maxPurchasePrice,
      // Rounded to what the field can display, so the calculator's inputs
      // reproduce the numbers shown beside them.
      downPaymentPercent: Math.round(result.downPaymentPercent * 100) / 100,
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
        `  ${getMortgageInsuranceLabel(loanType)}: ${formatCurrency(result.mortgageInsuranceMonthly)}${
          miDuration ? ` (${miDuration.toLowerCase()})` : ''
        }`
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

    void copyToClipboard(lines.join('\n'), { title: 'Buyer summary copied' });
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
    if (loanType === 'va' && loanInputs.vaSubsequentUse) params.set('vaSub', '1');

    void copyToClipboard(
      `${window.location.origin}${window.location.pathname}?${params.toString()}`,
      {
        title: 'Share link copied',
        description: 'Anyone you send it to opens this exact scenario.',
      }
    );
  };

  // No dependency array: the page header calls these on demand, so they must
  // always close over the current borrower and loan values.
  useEffect(() => {
    if (!actionsRef) return undefined;
    actionsRef.current = { copySummary: handleCopySummary, shareLink: handleShareLink };
    return () => {
      actionsRef.current = null;
    };
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <FieldGroup
          title="Income & debts"
          action={
            <SegmentedToggle<IncomeMode>
              ariaLabel="Income period"
              value={borrower.incomeMode}
              onChange={(incomeMode) =>
                setBorrower((prev) => {
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
          }
        >
          <FieldGrid>
            <NumberField
              label="Gross income"
              prefix="$"
              hint={borrower.incomeMode === 'annual' ? 'per year' : 'per month'}
              value={borrowerInputs.format('incomeValue', borrower.incomeValue)}
              onChange={borrowerInputs.onChange('incomeValue')}
              onBlur={borrowerInputs.onBlur('incomeValue')}
              footnote={
                borrower.incomeMode === 'annual'
                  ? `${formatCurrency(grossMonthlyIncome)} per month`
                  : 'Before taxes, all borrowers'
              }
            />
            <NumberField
              label="Monthly debts"
              prefix="$"
              hint="per month"
              value={borrowerInputs.format('monthlyDebts', borrower.monthlyDebts)}
              onChange={borrowerInputs.onChange('monthlyDebts')}
              onBlur={borrowerInputs.onBlur('monthlyDebts')}
              footnote="Cars, cards, student loans"
            />
          </FieldGrid>
        </FieldGroup>

        <FieldGroup
          title="Down payment & cash"
          action={
            <SegmentedToggle<DownPaymentMode>
              ariaLabel="Down payment entry"
              value={borrower.downPaymentMode}
              onChange={(downPaymentMode) =>
                setBorrower((prev) => ({ ...prev, downPaymentMode }))
              }
              options={[
                { value: 'amount', label: 'Dollars' },
                { value: 'percent', label: 'Percent' },
              ]}
            />
          }
        >
          <FieldGrid>
            {borrower.downPaymentMode === 'amount' ? (
              <NumberField
                label="Down payment"
                prefix="$"
                value={borrowerInputs.format('downPaymentAmount', borrower.downPaymentAmount)}
                onChange={borrowerInputs.onChange('downPaymentAmount')}
                onBlur={borrowerInputs.onBlur('downPaymentAmount')}
                footnote={`${result.downPaymentPercent.toFixed(1)}% at the max price`}
              />
            ) : (
              <NumberField
                label="Down payment"
                suffix="%"
                decimal
                value={borrowerInputs.format('downPaymentPercent', borrower.downPaymentPercent)}
                onChange={borrowerInputs.onChange('downPaymentPercent')}
                onBlur={borrowerInputs.onBlur('downPaymentPercent')}
                footnote={`${formatCurrency(result.downPaymentAmount)} at the max price`}
              />
            )}
            <NumberField
              label="Closing costs"
              suffix="%"
              hint="of price"
              decimal
              value={borrowerInputs.format('closingCostPercent', borrower.closingCostPercent)}
              onChange={borrowerInputs.onChange('closingCostPercent')}
              onBlur={borrowerInputs.onBlur('closingCostPercent')}
              footnote={`${formatCurrency(result.closingCosts)} at the max price`}
            />
          </FieldGrid>
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <CheckboxField
              label="Cap the price by the cash they actually have"
              checked={borrower.useCashLimit}
              onChange={(useCashLimit) => setBorrower((prev) => ({ ...prev, useCashLimit }))}
            />
            {borrower.useCashLimit ? (
              <NumberField
                label="Total cash available"
                prefix="$"
                value={borrowerInputs.format('cashOnHand', borrower.cashOnHand)}
                onChange={borrowerInputs.onChange('cashOnHand')}
                onBlur={borrowerInputs.onBlur('cashOnHand')}
                footnote="Must cover the down payment and closing costs together"
              />
            ) : null}
          </div>
        </FieldGroup>

        <FieldGroup title="Comfort check">
          <div className="space-y-3">
            <CheckboxField
              label="Also cap the payment at what they want to spend"
              checked={borrower.useComfortBudget}
              onChange={(useComfortBudget) =>
                setBorrower((prev) => ({ ...prev, useComfortBudget }))
              }
            />
            {borrower.useComfortBudget ? (
              <NumberField
                label="Target monthly payment"
                prefix="$"
                hint="per month"
                value={borrowerInputs.format('comfortBudget', borrower.comfortBudget)}
                onChange={borrowerInputs.onChange('comfortBudget')}
                onBlur={borrowerInputs.onBlur('comfortBudget')}
                footnote="Covers taxes, insurance, HOA, and mortgage insurance too"
              />
            ) : (
              <p className="text-xs text-foreground-subtle">
                Turn this on to compare what they qualify for against what they want to pay.
              </p>
            )}
          </div>
        </FieldGroup>

        <FieldGroup
          title="Loan assumptions"
          description="Shared with the Calculator tab, so both tabs stay on one scenario."
        >
          <div className="space-y-3">
            <SelectField
              label="Loan program"
              value={loanType}
              onChange={(value) => onLoanInputsChange({ loanType: value as LoanType })}
              options={loanTypeOptions}
              footnote={
                loanTypeInfo.minDownPaymentPercent > 0
                  ? `${loanTypeInfo.description} (minimum ${loanTypeInfo.minDownPaymentPercent}% down)`
                  : loanTypeInfo.description
              }
            />
            <FieldGrid>
              <NumberField
                label="Interest rate"
                suffix="%"
                decimal
                reserveFootnote={false}
                value={loanFields.format('interestRate', loanInputs.interestRate)}
                onChange={loanFields.onChange('interestRate')}
                onBlur={loanFields.onBlur('interestRate')}
              />
              <NumberField
                label="Term"
                suffix="yrs"
                reserveFootnote={false}
                value={loanFields.format('termYears', loanInputs.termYears)}
                onChange={loanFields.onChange('termYears')}
                onBlur={loanFields.onBlur('termYears')}
              />
              <NumberField
                label="Property tax rate"
                suffix="%"
                hint="per year"
                decimal
                reserveFootnote={false}
                value={loanFields.format('propertyTaxRate', loanInputs.propertyTaxRate)}
                onChange={loanFields.onChange('propertyTaxRate')}
                onBlur={loanFields.onBlur('propertyTaxRate')}
              />
              <NumberField
                label="Homeowners insurance"
                prefix="$"
                hint="per month"
                reserveFootnote={false}
                value={loanFields.format('insuranceMonthly', loanInputs.insuranceMonthly)}
                onChange={loanFields.onChange('insuranceMonthly')}
                onBlur={loanFields.onBlur('insuranceMonthly')}
              />
              <NumberField
                label="HOA dues"
                prefix="$"
                hint="per month"
                reserveFootnote={false}
                value={loanFields.format('hoaMonthly', loanInputs.hoaMonthly)}
                onChange={loanFields.onChange('hoaMonthly')}
                onBlur={loanFields.onBlur('hoaMonthly')}
              />
              {showMiRateField ? (
                <NumberField
                  label={loanType === 'fha' ? 'Annual MIP rate' : 'PMI rate'}
                  suffix="%"
                  hint="per year"
                  decimal
                  reserveFootnote={false}
                  value={loanFields.format('pmiRate', loanInputs.pmiRate)}
                  onChange={loanFields.onChange('pmiRate')}
                  onBlur={loanFields.onBlur('pmiRate')}
                />
              ) : null}
            </FieldGrid>
            {loanType === 'va' ? (
              <div className="border-t border-border pt-3">
                <CheckboxField
                  label="They have used a VA loan before"
                  checked={loanInputs.vaSubsequentUse ?? false}
                  onChange={(vaSubsequentUse) => onLoanInputsChange({ vaSubsequentUse })}
                />
                <p className="mt-1.5 text-xs text-foreground-subtle">
                  A repeat VA buyer pays 3.3% instead of 2.15% on the funding fee, unless they put
                  at least 5% down.
                </p>
              </div>
            ) : null}
          </div>
        </FieldGroup>

        <details className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <summary className="cursor-pointer text-eyebrow text-foreground-subtle">
            Qualifying limits
          </summary>
          <p className="mt-2 text-xs text-foreground-muted">{result.guidelines.guidelineNote}</p>
          <FieldGrid className="mt-3">
            {borrower.frontEndCapPercent === null ? (
              <p className="text-xs text-foreground-subtle">
                {result.guidelines.name} does not use a housing payment limit.
              </p>
            ) : (
              <NumberField
                label="Housing payment cap"
                suffix="%"
                hint="of income"
                decimal
                reserveFootnote={false}
                value={borrowerInputs.format('frontEndCapPercent', borrower.frontEndCapPercent)}
                onChange={borrowerInputs.onChange('frontEndCapPercent')}
                onBlur={borrowerInputs.onBlur('frontEndCapPercent')}
              />
            )}
            <NumberField
              label="Total debt cap"
              suffix="%"
              hint="of income"
              decimal
              reserveFootnote={false}
              value={borrowerInputs.format('backEndCapPercent', borrower.backEndCapPercent)}
              onChange={borrowerInputs.onChange('backEndCapPercent')}
              onBlur={borrowerInputs.onBlur('backEndCapPercent')}
            />
            <NumberField
              label="Conforming loan limit"
              prefix="$"
              value={borrowerInputs.format('conformingLoanLimit', borrower.conformingLoanLimit)}
              onChange={borrowerInputs.onChange('conformingLoanLimit')}
              onBlur={borrowerInputs.onBlur('conformingLoanLimit')}
              footnote="Update for high-cost counties"
            />
          </FieldGrid>
        </details>
      </div>

      <div className="space-y-4">
        <AffordabilityResultCard result={result} loanType={loanType} bindingLabel={bindingLabel} />

        {onUseResults ? (
          <Button variant="secondary" className="w-full" onClick={handleUseResults}>
            Use this price in the calculator
          </Button>
        ) : null}

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
                className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${
                  warning.severity === 'warning'
                    ? 'bg-warning-soft text-[hsl(var(--warning))]'
                    : 'bg-surface-muted text-foreground-muted'
                }`}
              >
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <BuyingPowerLeversPanel
          levers={result.levers}
          bindingConstraint={result.bindingConstraint}
        />
      </div>
    </div>
  );
}
