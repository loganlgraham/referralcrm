'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import {
  CalculatorIcon,
  InfoIcon,
  SparklesIcon,
  PlusIcon,
  Share2Icon,
  DownloadIcon,
  ClipboardIcon,
  RotateCcwIcon,
} from 'lucide-react';
import {
  MortgageInputs,
  calculateMortgage,
  generateAmortizationSchedule,
  calculateExtraPrincipalImpact,
  getLoanTypeInfo,
  LoanType,
} from '@/utils/mortgage-calculations';
import { AmortizationTable } from './amortization-table';
import { ExtraPrincipalImpact } from './extra-principal-impact';
import { ScenarioComparison } from './scenario-comparison';
import { AffordabilityCalculator } from './affordability-calculator';

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

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

const defaultInputs: MortgageInputs = {
  purchasePrice: 500_000,
  downPaymentPercent: 15,
  interestRate: 6.75,
  termYears: 30,
  propertyTaxRate: 1.1,
  insuranceMonthly: 150,
  hoaMonthly: 100,
  pmiRate: 0.55,
  extraPrincipal: 0,
  loanType: 'conventional',
};

type TabType = 'calculator' | 'amortization' | 'scenarios' | 'affordability';

interface Scenario {
  id: string;
  name: string;
  inputs: MortgageInputs;
  calculations: ReturnType<typeof calculateMortgage>;
}

export function MortgageCalculator() {
  const [inputs, setInputs] = useState<MortgageInputs>(defaultInputs);
  const [activeTab, setActiveTab] = useState<TabType>('calculator');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [showCopySuccess, setShowCopySuccess] = useState(false);

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
    loanType,
  } = inputs;

  const onChange = (key: keyof MortgageInputs) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const rawValue = event.target.value;
    // Handle loan type specially
    if (key === 'loanType') {
      setInputs((prev) => ({ ...prev, [key]: rawValue as LoanType }));
      return;
    }
    // Remove commas and parse to number
    const cleanValue = rawValue.replace(/,/g, '');
    const parsed = Number.parseFloat(cleanValue);
    const value = Number.isNaN(parsed) ? 0 : parsed;
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const formatNumberInput = (value: number): string => {
    if (value === 0) return '0';
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const calculations = useMemo(() => calculateMortgage(inputs), [inputs]);

  const amortizationSchedule = useMemo(
    () => generateAmortizationSchedule(inputs, calculations),
    [inputs, calculations]
  );

  const extraPrincipalImpact = useMemo(() => {
    if (extraPrincipal === 0) return null;
    return calculateExtraPrincipalImpact(inputs, calculations);
  }, [inputs, calculations, extraPrincipal]);

  const insights = useMemo(() => {
    const ideas: string[] = [];
    
    if (loanType === 'conventional' && calculations.ltv > 0.8) {
      ideas.push('LTV is above 80%, so PMI is included. Increasing the down payment a bit or negotiating seller credits could remove it.');
    }
    
    if (loanType === 'fha') {
      ideas.push('FHA loans include both upfront and monthly MIP. Consider conventional if the borrower has 20%+ down to avoid PMI.');
    }
    
    if (loanType === 'va') {
      ideas.push('VA loans offer 0% down with no monthly PMI, but include a funding fee. Eligible veterans get excellent terms.');
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
  }, [calculations.ltv, inputs.extraPrincipal, interestRate, loanType]);

  const handleSaveScenario = () => {
    const scenarioName = `Scenario ${scenarios.length + 1}`;
    const newScenario: Scenario = {
      id: `scenario-${Date.now()}`,
      name: scenarioName,
      inputs: { ...inputs },
      calculations: { ...calculations },
    };
    setScenarios((prev) => [...prev, newScenario]);
  };

  const handleRemoveScenario = (id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  const handleReset = () => {
    setInputs(defaultInputs);
  };

  const handleShareLink = () => {
    const params = new URLSearchParams({
      price: purchasePrice.toString(),
      down: downPaymentPercent.toString(),
      rate: interestRate.toString(),
      term: termYears.toString(),
      tax: propertyTaxRate.toString(),
      insurance: insuranceMonthly.toString(),
      hoa: hoaMonthly.toString(),
      pmi: pmiRate.toString(),
      extra: extraPrincipal.toString(),
      type: loanType || 'conventional',
    });
    
    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(shareUrl);
    setShowCopySuccess(true);
    setTimeout(() => setShowCopySuccess(false), 2000);
  };

  const handleCopyToClipboard = () => {
    const summary = `
Mortgage Calculation Summary
Purchase Price: ${formatCurrency(purchasePrice)}
Down Payment: ${downPaymentPercent}% (${formatCurrency(calculations.downPaymentAmount)})
Loan Amount: ${formatCurrency(calculations.loanAmount)}
Interest Rate: ${interestRate}%
Term: ${termYears} years
Loan Type: ${getLoanTypeInfo(loanType || 'conventional').name}

Monthly Payment Breakdown:
- Principal & Interest: ${formatCurrency(calculations.principalAndInterest)}
- Property Taxes: ${formatCurrency(calculations.propertyTaxes)}
- Homeowners Insurance: ${formatCurrency(insuranceMonthly)}
- HOA Dues: ${formatCurrency(hoaMonthly)}
${calculations.pmiMonthly > 0 ? `- PMI/MIP: ${formatCurrency(calculations.pmiMonthly)}` : ''}
${extraPrincipal > 0 ? `- Extra Principal: ${formatCurrency(extraPrincipal)}` : ''}

Total Monthly Payment: ${formatCurrency(calculations.totalMonthly)}
Total Interest Over Life: ${formatCurrency(calculations.totalInterest)}
Loan-to-Value: ${formatPercent(calculations.ltv)}
`.trim();
    
    navigator.clipboard.writeText(summary);
    setShowCopySuccess(true);
    setTimeout(() => setShowCopySuccess(false), 2000);
  };

  const handleUseAffordabilityResults = (price: number, downPercent: number) => {
    setInputs((prev) => ({
      ...prev,
      purchasePrice: price,
      downPaymentPercent: downPercent,
    }));
    setActiveTab('calculator');
  };

  // Parse URL params on mount
  useMemo(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlInputs: Partial<MortgageInputs> = {};
      
      if (params.has('price')) urlInputs.purchasePrice = Number(params.get('price'));
      if (params.has('down')) urlInputs.downPaymentPercent = Number(params.get('down'));
      if (params.has('rate')) urlInputs.interestRate = Number(params.get('rate'));
      if (params.has('term')) urlInputs.termYears = Number(params.get('term'));
      if (params.has('tax')) urlInputs.propertyTaxRate = Number(params.get('tax'));
      if (params.has('insurance')) urlInputs.insuranceMonthly = Number(params.get('insurance'));
      if (params.has('hoa')) urlInputs.hoaMonthly = Number(params.get('hoa'));
      if (params.has('pmi')) urlInputs.pmiRate = Number(params.get('pmi'));
      if (params.has('extra')) urlInputs.extraPrincipal = Number(params.get('extra'));
      if (params.has('type')) urlInputs.loanType = params.get('type') as LoanType;
      
      if (Object.keys(urlInputs).length > 0) {
        setInputs((prev) => ({ ...prev, ...urlInputs }));
      }
    }
  }, []);

  const loanTypeInfo = getLoanTypeInfo(loanType || 'conventional');

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
          
          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcwIcon className="h-4 w-4" />
              Reset
            </button>
            <button
              onClick={handleShareLink}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Share2Icon className="h-4 w-4" />
              Share Link
            </button>
            <button
              onClick={handleCopyToClipboard}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ClipboardIcon className="h-4 w-4" />
              Copy Summary
            </button>
            {activeTab === 'calculator' && (
              <button
                onClick={handleSaveScenario}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
              >
                <PlusIcon className="h-4 w-4" />
                Save Scenario
              </button>
            )}
          </div>
        </div>

        {showCopySuccess && (
          <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Copied to clipboard!
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 border-b border-slate-200">
          <nav className="-mb-px flex gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('calculator')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'calculator'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              Calculator
            </button>
            <button
              onClick={() => setActiveTab('amortization')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'amortization'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              Amortization
            </button>
            <button
              onClick={() => setActiveTab('scenarios')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'scenarios'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              Scenarios {scenarios.length > 0 && `(${scenarios.length})`}
            </button>
            <button
              onClick={() => setActiveTab('affordability')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'affordability'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              Affordability
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="mt-6">
          {activeTab === 'calculator' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                {/* Loan Type Selector */}
                <div className="rounded-lg border border-slate-200 p-4">
                  <label className="space-y-2">
                    <div className="text-sm font-semibold text-slate-800">Loan Type</div>
                    <select
                      value={loanType}
                      onChange={onChange('loanType')}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      <option value="conventional">Conventional</option>
                      <option value="fha">FHA</option>
                      <option value="va">VA</option>
                      <option value="usda">USDA</option>
                      <option value="jumbo">Jumbo</option>
                    </select>
                    <p className="text-xs text-slate-500">
                      {loanTypeInfo.description}
                      {loanTypeInfo.minDownPaymentPercent > 0 && ` (Min ${loanTypeInfo.minDownPaymentPercent}% down)`}
                    </p>
                  </label>
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                        Purchase price
                        <span className="text-xs text-slate-500">USD</span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatNumberInput(purchasePrice)}
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
                        type="text"
                        inputMode="decimal"
                        value={formatNumberInput(downPaymentPercent)}
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
                        type="text"
                        inputMode="decimal"
                        value={formatNumberInput(interestRate)}
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
                        type="text"
                        inputMode="numeric"
                        value={formatNumberInput(termYears)}
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
                        type="text"
                        inputMode="decimal"
                        value={formatNumberInput(propertyTaxRate)}
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
                        type="text"
                        inputMode="numeric"
                        value={formatNumberInput(insuranceMonthly)}
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
                        type="text"
                        inputMode="numeric"
                        value={formatNumberInput(hoaMonthly)}
                        onChange={onChange('hoaMonthly')}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </label>
                    {loanTypeInfo.hasPMI && (
                      <label className="space-y-2">
                        <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                          PMI rate
                          <span className="text-xs text-slate-500">Annual %</span>
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatNumberInput(pmiRate)}
                          onChange={onChange('pmiRate')}
                          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        />
                        <p className="text-xs text-slate-500">
                          {loanType === 'fha' ? 'FHA MIP applies to all loans' : 'Applies when <20% down'}
                        </p>
                      </label>
                    )}
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                        Extra principal
                        <span className="text-xs text-slate-500">Monthly</span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatNumberInput(extraPrincipal)}
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
                        <dt className="flex items-center gap-2 font-semibold">
                          {loanType === 'fha' ? 'MIP' : 'PMI'}
                        </dt>
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
                    {calculations.upfrontMIP && (
                      <div className="rounded-md bg-slate-50 px-3 py-2">
                        <dt className="text-xs text-slate-500">Upfront MIP (FHA)</dt>
                        <dd className="text-base font-semibold text-slate-900">{formatCurrency(calculations.upfrontMIP)}</dd>
                      </div>
                    )}
                    {calculations.fundingFee && (
                      <div className="rounded-md bg-slate-50 px-3 py-2">
                        <dt className="text-xs text-slate-500">VA Funding Fee</dt>
                        <dd className="text-base font-semibold text-slate-900">{formatCurrency(calculations.fundingFee)}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {extraPrincipalImpact && (
                  <ExtraPrincipalImpact
                    monthsSaved={extraPrincipalImpact.monthsSaved}
                    yearsSaved={extraPrincipalImpact.yearsSaved}
                    interestSaved={extraPrincipalImpact.interestSaved}
                    originalPayoffDate={extraPrincipalImpact.originalPayoffDate}
                    newPayoffDate={extraPrincipalImpact.newPayoffDate}
                    extraPrincipalAmount={extraPrincipal}
                  />
                )}

                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <SparklesIcon className="h-4 w-4 text-brand" />
                    Coaching angles
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {insights.map((insight, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-brand">•</span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'amortization' && (
            <AmortizationTable schedule={amortizationSchedule} includesExtraPrincipal={extraPrincipal > 0} />
          )}

          {activeTab === 'scenarios' && (
            <ScenarioComparison scenarios={scenarios} onRemoveScenario={handleRemoveScenario} />
          )}

          {activeTab === 'affordability' && (
            <AffordabilityCalculator onUseResults={handleUseAffordabilityResults} />
          )}
        </div>
      </div>
    </div>
  );
}
