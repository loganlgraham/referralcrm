'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { HomeIcon, TrendingUpIcon } from 'lucide-react';
import { calculateAffordability } from '@/utils/mortgage-calculations';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

interface AffordabilityInputs {
  monthlyBudget: number;
  downPaymentAmount: number;
  grossMonthlyIncome: number;
  monthlyDebts: number;
  interestRate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  pmiRate: number;
}

const defaultAffordabilityInputs: AffordabilityInputs = {
  monthlyBudget: 3000,
  downPaymentAmount: 50000,
  grossMonthlyIncome: 8000,
  monthlyDebts: 500,
  interestRate: 6.75,
  termYears: 30,
  propertyTaxRate: 1.1,
  insuranceMonthly: 150,
  hoaMonthly: 100,
  pmiRate: 0.55,
};

interface AffordabilityCalculatorProps {
  onUseResults?: (purchasePrice: number, downPaymentPercent: number) => void;
}

export function AffordabilityCalculator({ onUseResults }: AffordabilityCalculatorProps) {
  const [inputs, setInputs] = useState<AffordabilityInputs>(defaultAffordabilityInputs);
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

  const onChange = (key: keyof AffordabilityInputs) => (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    
    // Store raw input value to preserve decimals and formatting while typing
    setRawInputs((prev) => ({ ...prev, [key]: rawValue }));
    
    // Remove commas and parse to number
    const cleanValue = rawValue.replace(/,/g, '');
    const parsed = Number.parseFloat(cleanValue);
    const value = Number.isNaN(parsed) ? 0 : parsed;
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const onBlur = (key: keyof AffordabilityInputs) => () => {
    // Clear raw input on blur so formatted value shows
    setRawInputs((prev) => {
      const newRaw = { ...prev };
      delete newRaw[key];
      return newRaw;
    });
  };

  const formatNumberInput = (key: keyof AffordabilityInputs, value: number): string => {
    // If user is currently typing in this field, use the raw value
    if (rawInputs[key] !== undefined) {
      return rawInputs[key];
    }
    
    // Otherwise format the number value
    if (value === 0) return '0';
    
    // Check if value has decimals
    const hasDecimals = value % 1 !== 0;
    
    if (hasDecimals) {
      // Preserve decimals up to 2 places
      return value.toLocaleString('en-US', { 
        minimumFractionDigits: 0,
        maximumFractionDigits: 2 
      });
    } else {
      // Whole numbers with thousand separators
      return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
  };

  const results = useMemo(() => {
    return calculateAffordability({
      monthlyBudget: inputs.monthlyBudget,
      downPaymentAmount: inputs.downPaymentAmount,
      interestRate: inputs.interestRate,
      termYears: inputs.termYears,
      propertyTaxRate: inputs.propertyTaxRate,
      insuranceMonthly: inputs.insuranceMonthly,
      hoaMonthly: inputs.hoaMonthly,
      pmiRate: inputs.pmiRate,
      monthlyDebts: inputs.monthlyDebts,
      grossMonthlyIncome: inputs.grossMonthlyIncome,
    });
  }, [inputs]);

  const handleUseResults = () => {
    if (onUseResults) {
      onUseResults(results.maxPurchasePrice, results.recommendedDownPaymentPercent);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600">
            <HomeIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Affordability Calculator</h2>
            <p className="text-sm text-foreground-muted">Calculate maximum purchase price based on your budget and income</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Input Section */}
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Income & Budget</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Monthly budget
                    <span className="text-xs text-foreground-subtle">For housing</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('monthlyBudget', inputs.monthlyBudget)}
                    onChange={onChange('monthlyBudget')}
                    onBlur={onBlur('monthlyBudget')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Down payment
                    <span className="text-xs text-foreground-subtle">USD</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('downPaymentAmount', inputs.downPaymentAmount)}
                    onChange={onChange('downPaymentAmount')}
                    onBlur={onBlur('downPaymentAmount')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Gross monthly income
                    <span className="text-xs text-foreground-subtle">Before tax</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('grossMonthlyIncome', inputs.grossMonthlyIncome)}
                    onChange={onChange('grossMonthlyIncome')}
                    onBlur={onBlur('grossMonthlyIncome')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Monthly debts
                    <span className="text-xs text-foreground-subtle">Other debts</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('monthlyDebts', inputs.monthlyDebts)}
                    onChange={onChange('monthlyDebts')}
                    onBlur={onBlur('monthlyDebts')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Loan Parameters</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Interest rate
                    <span className="text-xs text-foreground-subtle">Annual %</span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatNumberInput('interestRate', inputs.interestRate)}
                    onChange={onChange('interestRate')}
                    onBlur={onBlur('interestRate')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Term
                    <span className="text-xs text-foreground-subtle">Years</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('termYears', inputs.termYears)}
                    onChange={onChange('termYears')}
                    onBlur={onBlur('termYears')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Property tax rate
                    <span className="text-xs text-foreground-subtle">% / year</span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatNumberInput('propertyTaxRate', inputs.propertyTaxRate)}
                    onChange={onChange('propertyTaxRate')}
                    onBlur={onBlur('propertyTaxRate')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    Insurance
                    <span className="text-xs text-foreground-subtle">Monthly</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('insuranceMonthly', inputs.insuranceMonthly)}
                    onChange={onChange('insuranceMonthly')}
                    onBlur={onBlur('insuranceMonthly')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    HOA dues
                    <span className="text-xs text-foreground-subtle">Monthly</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberInput('hoaMonthly', inputs.hoaMonthly)}
                    onChange={onChange('hoaMonthly')}
                    onBlur={onBlur('hoaMonthly')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                    PMI rate
                    <span className="text-xs text-foreground-subtle">Annual %</span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatNumberInput('pmiRate', inputs.pmiRate)}
                    onChange={onChange('pmiRate')}
                    onBlur={onBlur('pmiRate')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Results Section */}
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2">
                <TrendingUpIcon className="h-5 w-5 text-blue-600" />
                <h3 className="text-sm font-semibold text-blue-900">Maximum Affordability</h3>
              </div>

              <div className="mt-4 space-y-4">
                <div className="rounded-md bg-surface-raised p-4 shadow-sm">
                  <p className="text-sm text-foreground-muted">Max Purchase Price</p>
                  <p className="mt-1 text-3xl font-bold text-foreground">
                    {currencyFormatter.format(results.maxPurchasePrice)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-surface-raised p-3 shadow-sm">
                    <p className="text-xs text-foreground-muted">Max Loan</p>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {currencyFormatter.format(results.maxLoanAmount)}
                    </p>
                  </div>
                  <div className="rounded-md bg-surface-raised p-3 shadow-sm">
                    <p className="text-xs text-foreground-muted">Down Payment</p>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {results.recommendedDownPaymentPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {results.debtToIncomeRatio !== null && (
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">Debt Ratios</h3>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground-muted">Housing Expense Ratio</span>
                      <span className="font-semibold text-foreground">
                        {percentFormatter.format(results.housingExpenseRatio || 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-subtle">
                      <div
                        className={`h-2 rounded-full ${
                          (results.housingExpenseRatio || 0) <= 0.28 ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min((results.housingExpenseRatio || 0) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-foreground-subtle">Target: ≤28% (front-end ratio)</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground-muted">Debt-to-Income Ratio</span>
                      <span className="font-semibold text-foreground">
                        {percentFormatter.format(results.debtToIncomeRatio || 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-subtle">
                      <div
                        className={`h-2 rounded-full ${
                          (results.debtToIncomeRatio || 0) <= 0.36
                            ? 'bg-emerald-500'
                            : (results.debtToIncomeRatio || 0) <= 0.43
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min((results.debtToIncomeRatio || 0) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-foreground-subtle">Target: ≤36-43% (back-end ratio)</p>
                  </div>
                </div>
              </div>
            )}

            {onUseResults && (
              <button
                onClick={handleUseResults}
                className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Use These Results in Calculator
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
