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

  const onChange = (key: keyof AffordabilityInputs) => (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const value = rawValue === '' ? 0 : Number.parseFloat(rawValue) || 0;
    setInputs((prev) => ({ ...prev, [key]: value }));
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
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600">
            <HomeIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Affordability Calculator</h2>
            <p className="text-sm text-slate-600">Calculate maximum purchase price based on your budget and income</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Input Section */}
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Income & Budget</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Monthly budget
                    <span className="text-xs text-slate-500">For housing</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={inputs.monthlyBudget}
                    onChange={onChange('monthlyBudget')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Down payment
                    <span className="text-xs text-slate-500">USD</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={inputs.downPaymentAmount}
                    onChange={onChange('downPaymentAmount')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Gross monthly income
                    <span className="text-xs text-slate-500">Before tax</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={inputs.grossMonthlyIncome}
                    onChange={onChange('grossMonthlyIncome')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Monthly debts
                    <span className="text-xs text-slate-500">Other debts</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={inputs.monthlyDebts}
                    onChange={onChange('monthlyDebts')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Loan Parameters</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Interest rate
                    <span className="text-xs text-slate-500">Annual %</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={inputs.interestRate}
                    onChange={onChange('interestRate')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Term
                    <span className="text-xs text-slate-500">Years</span>
                  </div>
                  <input
                    type="number"
                    min={5}
                    max={40}
                    step={1}
                    value={inputs.termYears}
                    onChange={onChange('termYears')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Property tax rate
                    <span className="text-xs text-slate-500">% / year</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={inputs.propertyTaxRate}
                    onChange={onChange('propertyTaxRate')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Insurance
                    <span className="text-xs text-slate-500">Monthly</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={inputs.insuranceMonthly}
                    onChange={onChange('insuranceMonthly')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    HOA dues
                    <span className="text-xs text-slate-500">Monthly</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={inputs.hoaMonthly}
                    onChange={onChange('hoaMonthly')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    PMI rate
                    <span className="text-xs text-slate-500">Annual %</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={inputs.pmiRate}
                    onChange={onChange('pmiRate')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
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
                <div className="rounded-lg bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-600">Max Purchase Price</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">
                    {currencyFormatter.format(results.maxPurchasePrice)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <p className="text-xs text-slate-600">Max Loan</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {currencyFormatter.format(results.maxLoanAmount)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <p className="text-xs text-slate-600">Down Payment</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {results.recommendedDownPaymentPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {results.debtToIncomeRatio !== null && (
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Debt Ratios</h3>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">Housing Expense Ratio</span>
                      <span className="font-semibold text-slate-900">
                        {percentFormatter.format(results.housingExpenseRatio || 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-2 rounded-full ${
                          (results.housingExpenseRatio || 0) <= 0.28 ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min((results.housingExpenseRatio || 0) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Target: ≤28% (front-end ratio)</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">Debt-to-Income Ratio</span>
                      <span className="font-semibold text-slate-900">
                        {percentFormatter.format(results.debtToIncomeRatio || 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
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
                    <p className="mt-1 text-xs text-slate-500">Target: ≤36-43% (back-end ratio)</p>
                  </div>
                </div>
              </div>
            )}

            {onUseResults && (
              <button
                onClick={handleUseResults}
                className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
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
