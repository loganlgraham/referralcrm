'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { CalculatorIcon, InfoIcon, SparklesIcon } from 'lucide-react';

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

function asNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

type CalculatorInputs = {
  purchasePrice: number;
  downPaymentPercent: number;
  interestRate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  pmiRate: number;
  extraPrincipal: number;
};

const defaultInputs: CalculatorInputs = {
  purchasePrice: 500_000,
  downPaymentPercent: 15,
  interestRate: 6.75,
  termYears: 30,
  propertyTaxRate: 1.1,
  insuranceMonthly: 150,
  hoaMonthly: 100,
  pmiRate: 0.55,
  extraPrincipal: 0,
};

export function MortgageCalculator() {
  const [inputs, setInputs] = useState<CalculatorInputs>(defaultInputs);

  const {
    purchasePrice,
    downPaymentPercent,
    interestRate,
    termYears,
    propertyTaxRate,
    insuranceMonthly,
    hoaMonthly,
    pmiRate,
    extraPrincipal,
  } = inputs;

  const onChange = (key: keyof CalculatorInputs) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value) || 0;
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const calculations = useMemo(() => {
    const price = Math.max(asNumber(purchasePrice), 0);
    const dpPercent = Math.min(Math.max(asNumber(downPaymentPercent), 0), 100);
    const downPaymentAmount = price * (dpPercent / 100);
    const loanAmount = Math.max(price - downPaymentAmount, 0);
    const monthlyRate = Math.max(asNumber(interestRate), 0) / 100 / 12;
    const totalPayments = Math.max(Math.floor(asNumber(termYears) * 12), 1);

    const principalAndInterest = monthlyRate
      ? loanAmount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalPayments)))
      : loanAmount / totalPayments;

    const propertyTaxes = (price * (Math.max(asNumber(propertyTaxRate), 0) / 100)) / 12;
    const pmiMonthly = dpPercent < 20 ? (loanAmount * (Math.max(asNumber(pmiRate), 0) / 100)) / 12 : 0;
    const totalMonthly =
      principalAndInterest + propertyTaxes + Math.max(insuranceMonthly, 0) + Math.max(hoaMonthly, 0) + pmiMonthly + Math.max(extraPrincipal, 0);
    const totalInterest = principalAndInterest * totalPayments - loanAmount;
    const ltv = loanAmount && price ? loanAmount / price : 0;

    return {
      downPaymentAmount,
      loanAmount,
      principalAndInterest,
      propertyTaxes,
      pmiMonthly,
      totalMonthly,
      totalInterest,
      ltv,
    };
  }, [downPaymentPercent, extraPrincipal, hoaMonthly, insuranceMonthly, interestRate, pmiRate, propertyTaxRate, purchasePrice, termYears]);

  const insights = useMemo(() => {
    const ideas: string[] = [];
    if (calculations.ltv > 0.8) {
      ideas.push('LTV is above 80%, so PMI is included. Increasing the down payment a bit or negotiating seller credits could remove it.');
    }
    if (interestRate >= 7) {
      ideas.push('Rates are elevated. Suggest a buydown option or an ARM comparison to create affordability for rate-sensitive borrowers.');
    } else if (interestRate < 6) {
      ideas.push('Rates are comparatively favorable. Position urgency before the next rate move and highlight long-term stability.');
    }
    if (inputs.extraPrincipal > 0) {
      ideas.push('Applying extra principal each month accelerates payoff and saves interest—quantify this for motivated borrowers.');
    } else {
      ideas.push('Explore a small recurring extra principal payment to show how quickly amortization accelerates.');
    }
    ideas.push('Use the payment breakdown to anchor a budget conversation and align with current lender programs.');
    return ideas;
  }, [calculations.ltv, inputs.extraPrincipal, interestRate]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand/10 p-2 text-brand">
            <CalculatorIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Mortgage Coach Calculator</h1>
            <p className="text-sm text-slate-600">
              Model payment scenarios with taxes, insurance, HOA dues, and PMI so agents can set clear expectations with referrals.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Purchase price
                    <span className="text-xs text-slate-500">USD</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={purchasePrice}
                    onChange={onChange('purchasePrice')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Down payment
                    <span className="text-xs text-slate-500">% of price</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.25}
                    value={downPaymentPercent}
                    onChange={onChange('downPaymentPercent')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <p className="text-xs text-slate-500">{formatCurrency(calculations.downPaymentAmount)} down</p>
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Interest rate
                    <span className="text-xs text-slate-500">Annual %</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={interestRate}
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
                    value={termYears}
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
                    value={propertyTaxRate}
                    onChange={onChange('propertyTaxRate')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <p className="text-xs text-slate-500">{formatCurrency(calculations.propertyTaxes)} per month</p>
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Homeowners insurance
                    <span className="text-xs text-slate-500">Monthly</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={insuranceMonthly}
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
                    value={hoaMonthly}
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
                    value={pmiRate}
                    onChange={onChange('pmiRate')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <p className="text-xs text-slate-500">Applies when &lt;20% down</p>
                </label>
                <label className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    Extra principal
                    <span className="text-xs text-slate-500">Monthly</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={25}
                    value={extraPrincipal}
                    onChange={onChange('extraPrincipal')}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <p className="text-xs text-slate-500">Shows payoff acceleration potential.</p>
                </label>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Monthly payment breakdown</p>
                <span className="text-xs text-slate-500">Principal, interest & expenses</span>
              </div>
              <dl className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 font-medium">Principal & interest</dt>
                  <dd className="font-semibold">{formatCurrency(calculations.principalAndInterest)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 font-medium">Property taxes</dt>
                  <dd className="font-semibold">{formatCurrency(calculations.propertyTaxes)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 font-medium">Homeowners insurance</dt>
                  <dd className="font-semibold">{formatCurrency(insuranceMonthly)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 font-medium">HOA dues</dt>
                  <dd className="font-semibold">{formatCurrency(hoaMonthly)}</dd>
                </div>
                {calculations.pmiMonthly > 0 && (
                  <div className="flex items-center justify-between text-brand">
                    <dt className="flex items-center gap-2 font-semibold">PMI</dt>
                    <dd className="font-semibold">{formatCurrency(calculations.pmiMonthly)}</dd>
                  </div>
                )}
                {extraPrincipal > 0 && (
                  <div className="flex items-center justify-between text-slate-700">
                    <dt className="flex items-center gap-2 font-semibold">Extra principal</dt>
                    <dd className="font-semibold">{formatCurrency(extraPrincipal)}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-4 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">Estimated total</span>
                <span className="text-lg font-bold text-slate-900">{formatCurrency(calculations.totalMonthly)}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Amounts are estimates for coaching conversations. Actual lender disclosures will differ based on credit, programs, and fees.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <InfoIcon className="h-4 w-4 text-slate-500" />
                Loan snapshot
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-700">
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Loan amount</dt>
                  <dd className="text-base font-semibold text-slate-900">{formatCurrency(calculations.loanAmount)}</dd>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Down payment</dt>
                  <dd className="text-base font-semibold text-slate-900">{formatCurrency(calculations.downPaymentAmount)}</dd>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Loan-to-value</dt>
                  <dd className="text-base font-semibold text-slate-900">{formatPercent(calculations.ltv)}</dd>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Total scheduled interest</dt>
                  <dd className="text-base font-semibold text-slate-900">{formatCurrency(calculations.totalInterest)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <SparklesIcon className="h-4 w-4 text-brand" />
                Coaching angles
              </div>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {insights.map((insight) => (
                  <li key={insight} className="flex gap-2">
                    <span className="text-brand">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
