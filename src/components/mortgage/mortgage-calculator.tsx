'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useNumberInputs } from './use-number-inputs';

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

type MortgageFieldKey = Exclude<keyof MortgageInputs, 'loanType'>;

function isTabType(value: string | null): value is TabType {
  return (
    value === 'calculator' ||
    value === 'amortization' ||
    value === 'scenarios' ||
    value === 'affordability'
  );
}

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

  const handleNumberChange = useCallback((key: MortgageFieldKey, value: number) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const numberInputs = useNumberInputs<MortgageFieldKey>(handleNumberChange);

  const handleInputsPatch = useCallback((patch: Partial<MortgageInputs>) => {
    setInputs((prev) => ({ ...prev, ...patch }));
  }, []);

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
    numberInputs.reset();
    // Clear URL parameters
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    }
    // Reset to calculator tab
    setActiveTab('calculator');
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

  const handleUseAffordabilityResults = useCallback(
    (patch: Partial<MortgageInputs>) => {
      handleInputsPatch(patch);
      numberInputs.reset();
      setActiveTab('calculator');
    },
    [handleInputsPatch, numberInputs]
  );

  useEffect(() => {
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

    const tab = params.get('tab');
    if (isTabType(tab)) setActiveTab(tab);
  }, []);

  const loanTypeInfo = getLoanTypeInfo(loanType || 'conventional');

  return (
    <div className="space-y-6">
      <div className="rounded-md bg-surface-raised p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <CalculatorIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Mortgage Coach Calculator</h1>
              <p className="text-sm text-foreground-muted">
                Model payment scenarios with taxes, insurance, HOA dues, and PMI so agents can set clear expectations with referrals.
              </p>
            </div>
          </div>
          
          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            >
              <RotateCcwIcon className="h-4 w-4" />
              Reset
            </button>
            <button
              onClick={handleShareLink}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            >
              <Share2Icon className="h-4 w-4" />
              Share Link
            </button>
            <button
              onClick={handleCopyToClipboard}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            >
              <ClipboardIcon className="h-4 w-4" />
              Copy Summary
            </button>
            {activeTab === 'calculator' && (
              <button
                onClick={handleSaveScenario}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Save Scenario
              </button>
            )}
          </div>
        </div>

        {showCopySuccess && (
          <div className="mt-3 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
            ✓ Copied to clipboard!
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 border-b border-border">
          <nav className="-mb-px flex gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('calculator')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'calculator'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-foreground-subtle hover:border-border-strong hover:text-foreground-muted'
              }`}
            >
              Calculator
            </button>
            <button
              onClick={() => setActiveTab('amortization')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'amortization'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-foreground-subtle hover:border-border-strong hover:text-foreground-muted'
              }`}
            >
              Amortization
            </button>
            <button
              onClick={() => setActiveTab('scenarios')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'scenarios'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-foreground-subtle hover:border-border-strong hover:text-foreground-muted'
              }`}
            >
              Scenarios {scenarios.length > 0 && `(${scenarios.length})`}
            </button>
            <button
              onClick={() => setActiveTab('affordability')}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === 'affordability'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-foreground-subtle hover:border-border-strong hover:text-foreground-muted'
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
                <div className="rounded-lg border border-border p-4">
                  <label className="space-y-2">
                    <div className="text-sm font-semibold text-foreground">Loan Type</div>
                    <select
                      value={loanType}
                      onChange={(event) =>
                        handleInputsPatch({ loanType: event.target.value as LoanType })
                      }
                      className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="conventional">Conventional</option>
                      <option value="fha">FHA</option>
                      <option value="va">VA</option>
                      <option value="usda">USDA</option>
                      <option value="jumbo">Jumbo</option>
                    </select>
                    <p className="text-xs text-foreground-subtle">
                      {loanTypeInfo.description}
                      {loanTypeInfo.minDownPaymentPercent > 0 && ` (Min ${loanTypeInfo.minDownPaymentPercent}% down)`}
                    </p>
                  </label>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                        Purchase price
                        <span className="text-xs text-foreground-subtle">USD</span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={numberInputs.format('purchasePrice', purchasePrice)}
                        onChange={numberInputs.onChange('purchasePrice')}
                        onBlur={numberInputs.onBlur('purchasePrice')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </label>
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                        Down payment
                        <span className="text-xs text-foreground-subtle">% of price</span>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numberInputs.format('downPaymentPercent', downPaymentPercent)}
                        onChange={numberInputs.onChange('downPaymentPercent')}
                        onBlur={numberInputs.onBlur('downPaymentPercent')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-xs text-foreground-subtle">{formatCurrency(calculations.downPaymentAmount)} down</p>
                    </label>
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                        Interest rate
                        <span className="text-xs text-foreground-subtle">Annual %</span>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numberInputs.format('interestRate', interestRate)}
                        onChange={numberInputs.onChange('interestRate')}
                        onBlur={numberInputs.onBlur('interestRate')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                        value={numberInputs.format('termYears', termYears)}
                        onChange={numberInputs.onChange('termYears')}
                        onBlur={numberInputs.onBlur('termYears')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                        value={numberInputs.format('propertyTaxRate', propertyTaxRate)}
                        onChange={numberInputs.onChange('propertyTaxRate')}
                        onBlur={numberInputs.onBlur('propertyTaxRate')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-xs text-foreground-subtle">{formatCurrency(calculations.propertyTaxes)} per month</p>
                    </label>
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                        Homeowners insurance
                        <span className="text-xs text-foreground-subtle">Monthly</span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={numberInputs.format('insuranceMonthly', insuranceMonthly)}
                        onChange={numberInputs.onChange('insuranceMonthly')}
                        onBlur={numberInputs.onBlur('insuranceMonthly')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                        value={numberInputs.format('hoaMonthly', hoaMonthly)}
                        onChange={numberInputs.onChange('hoaMonthly')}
                        onBlur={numberInputs.onBlur('hoaMonthly')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </label>
                    {loanTypeInfo.hasPMI && (
                      <label className="space-y-2">
                        <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                          PMI rate
                          <span className="text-xs text-foreground-subtle">Annual %</span>
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={numberInputs.format('pmiRate', pmiRate)}
                          onChange={numberInputs.onChange('pmiRate')}
                          onBlur={numberInputs.onBlur('pmiRate')}
                          className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <p className="text-xs text-foreground-subtle">
                          {loanType === 'fha' ? 'FHA MIP applies to all loans' : 'Applies when <20% down'}
                        </p>
                      </label>
                    )}
                    <label className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-medium text-foreground-muted">
                        Extra principal
                        <span className="text-xs text-foreground-subtle">Monthly</span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={numberInputs.format('extraPrincipal', extraPrincipal)}
                        onChange={numberInputs.onChange('extraPrincipal')}
                        onBlur={numberInputs.onBlur('extraPrincipal')}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-xs text-foreground-subtle">Shows payoff acceleration potential.</p>
                    </label>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Monthly payment breakdown</p>
                    <span className="text-xs text-foreground-subtle">Principal, interest & expenses</span>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm text-foreground-muted">
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
                      <div className="flex items-center justify-between text-primary">
                        <dt className="flex items-center gap-2 font-semibold">
                          {loanType === 'fha' ? 'MIP' : loanType === 'usda' ? 'USDA annual fee' : 'PMI'}
                        </dt>
                        <dd className="font-semibold">{formatCurrency(calculations.pmiMonthly)}</dd>
                      </div>
                    )}
                    {extraPrincipal > 0 && (
                      <div className="flex items-center justify-between text-foreground-muted">
                        <dt className="flex items-center gap-2 font-semibold">Extra principal</dt>
                        <dd className="font-semibold">{formatCurrency(extraPrincipal)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-4 flex items-center justify-between rounded-md bg-surface-muted px-3 py-2">
                    <span className="text-sm font-semibold text-foreground-muted">Estimated total</span>
                    <span className="text-lg font-bold text-foreground">{formatCurrency(calculations.totalMonthly)}</span>
                  </div>
                  <p className="mt-2 text-xs text-foreground-subtle">
                    Amounts are estimates for coaching conversations. Actual lender disclosures will differ based on credit, programs, and fees.
                  </p>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <InfoIcon className="h-4 w-4 text-foreground-subtle" />
                    Loan snapshot
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-foreground-muted">
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-foreground-subtle">Loan amount</dt>
                      <dd className="text-base font-semibold text-foreground">{formatCurrency(calculations.loanAmount)}</dd>
                    </div>
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-foreground-subtle">Down payment</dt>
                      <dd className="text-base font-semibold text-foreground">{formatCurrency(calculations.downPaymentAmount)}</dd>
                    </div>
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-foreground-subtle">Loan-to-value</dt>
                      <dd className="text-base font-semibold text-foreground">{formatPercent(calculations.ltv)}</dd>
                    </div>
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-foreground-subtle">Total scheduled interest</dt>
                      <dd className="text-base font-semibold text-foreground">{formatCurrency(calculations.totalInterest)}</dd>
                    </div>
                    {calculations.upfrontMIP && (
                      <div className="rounded-md bg-surface-muted px-3 py-2">
                        <dt className="text-xs text-foreground-subtle">Upfront MIP (FHA)</dt>
                        <dd className="text-base font-semibold text-foreground">{formatCurrency(calculations.upfrontMIP)}</dd>
                      </div>
                    )}
                    {calculations.fundingFee && (
                      <div className="rounded-md bg-surface-muted px-3 py-2">
                        <dt className="text-xs text-foreground-subtle">VA Funding Fee</dt>
                        <dd className="text-base font-semibold text-foreground">{formatCurrency(calculations.fundingFee)}</dd>
                      </div>
                    )}
                    {calculations.usdaGuaranteeFee && (
                      <div className="rounded-md bg-surface-muted px-3 py-2">
                        <dt className="text-xs text-foreground-subtle">USDA Guarantee Fee</dt>
                        <dd className="text-base font-semibold text-foreground">{formatCurrency(calculations.usdaGuaranteeFee)}</dd>
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

                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <SparklesIcon className="h-4 w-4 text-primary" />
                    Coaching angles
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-foreground-muted">
                    {insights.map((insight, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-primary">•</span>
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

          {/* Kept mounted so borrower details survive a trip to another tab. */}
          <div className={activeTab === 'affordability' ? undefined : 'hidden'}>
            <AffordabilityCalculator
              loanInputs={inputs}
              onLoanInputsChange={handleInputsPatch}
              onUseResults={handleUseAffordabilityResults}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
