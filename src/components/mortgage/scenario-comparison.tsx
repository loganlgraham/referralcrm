'use client';

import { XIcon } from 'lucide-react';
import { MortgageInputs, MortgageCalculations } from '@/utils/mortgage-calculations';

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

interface Scenario {
  id: string;
  name: string;
  inputs: MortgageInputs;
  calculations: MortgageCalculations;
}

interface ScenarioComparisonProps {
  scenarios: Scenario[];
  onRemoveScenario: (id: string) => void;
}

export function ScenarioComparison({ scenarios, onRemoveScenario }: ScenarioComparisonProps) {
  if (scenarios.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-600">No scenarios saved yet</p>
        <p className="mt-1 text-xs text-slate-500">Save scenarios to compare them side-by-side</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Compare Scenarios</h3>
        <p className="text-xs text-slate-500">{scenarios.length} scenario{scenarios.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full gap-4">
          {scenarios.map((scenario, index) => (
            <div
              key={scenario.id}
              className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-4"
              style={{ width: '280px' }}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-slate-900">{scenario.name}</h4>
                  <p className="text-xs text-slate-500">Scenario {index + 1}</p>
                </div>
                <button
                  onClick={() => onRemoveScenario(scenario.id)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Remove scenario"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>

              {/* Key Metrics */}
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-brand/5 p-3">
                  <p className="text-xs text-slate-600">Monthly Payment</p>
                  <p className="text-xl font-bold text-brand">
                    {currencyFormatter.format(scenario.calculations.totalMonthly)}
                  </p>
                </div>

                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Purchase Price</dt>
                    <dd className="font-semibold text-slate-900">
                      {currencyFormatter.format(scenario.inputs.purchasePrice)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Down Payment</dt>
                    <dd className="font-semibold text-slate-900">
                      {scenario.inputs.downPaymentPercent}% (
                      {currencyFormatter.format(scenario.calculations.downPaymentAmount)})
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Interest Rate</dt>
                    <dd className="font-semibold text-slate-900">{scenario.inputs.interestRate}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Loan Amount</dt>
                    <dd className="font-semibold text-slate-900">
                      {currencyFormatter.format(scenario.calculations.loanAmount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Term</dt>
                    <dd className="font-semibold text-slate-900">{scenario.inputs.termYears} years</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <dt className="text-slate-600">Total Interest</dt>
                    <dd className="font-semibold text-slate-900">
                      {currencyFormatter.format(scenario.calculations.totalInterest)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">LTV</dt>
                    <dd className="font-semibold text-slate-900">{percentFormatter.format(scenario.calculations.ltv)}</dd>
                  </div>
                  {scenario.calculations.pmiMonthly > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600">PMI</dt>
                      <dd className="font-semibold text-brand">
                        {currencyFormatter.format(scenario.calculations.pmiMonthly)}/mo
                      </dd>
                    </div>
                  )}
                  {scenario.inputs.extraPrincipal > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Extra Principal</dt>
                      <dd className="font-semibold text-emerald-600">
                        {currencyFormatter.format(scenario.inputs.extraPrincipal)}/mo
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Breakdown */}
              <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-xs">
                <p className="font-medium text-slate-700">Payment Breakdown</p>
                <div className="flex justify-between text-slate-600">
                  <span>P&I</span>
                  <span>{currencyFormatter.format(scenario.calculations.principalAndInterest)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Property Tax</span>
                  <span>{currencyFormatter.format(scenario.calculations.propertyTaxes)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Insurance</span>
                  <span>{currencyFormatter.format(scenario.inputs.insuranceMonthly)}</span>
                </div>
                {scenario.inputs.hoaMonthly > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>HOA</span>
                    <span>{currencyFormatter.format(scenario.inputs.hoaMonthly)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison Summary */}
      {scenarios.length > 1 && (
        <div className="rounded-lg bg-slate-50 p-4">
          <h4 className="text-sm font-semibold text-slate-800">Quick Comparison</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-slate-600">Lowest Monthly Payment</p>
              <p className="mt-1 text-base font-bold text-emerald-600">
                {currencyFormatter.format(Math.min(...scenarios.map((s) => s.calculations.totalMonthly)))}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-600">Lowest Total Interest</p>
              <p className="mt-1 text-base font-bold text-emerald-600">
                {currencyFormatter.format(Math.min(...scenarios.map((s) => s.calculations.totalInterest)))}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-600">Highest Down Payment</p>
              <p className="mt-1 text-base font-bold text-slate-900">
                {Math.max(...scenarios.map((s) => s.inputs.downPaymentPercent))}% (
                {currencyFormatter.format(
                  Math.max(...scenarios.map((s) => s.calculations.downPaymentAmount))
                )})
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
