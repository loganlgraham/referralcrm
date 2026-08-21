'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClipboardIcon, PlusIcon, RotateCcwIcon, Share2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/tooltip';
import {
  MortgageInputs,
  calculateMortgage,
  generateAmortizationSchedule,
  getLoanTypeInfo,
  LoanType,
} from '@/utils/mortgage-calculations';
import { AmortizationTable } from './amortization-table';
import { ScenarioComparison, type Scenario } from './scenario-comparison';
import {
  AffordabilityCalculator,
  type AffordabilityActions,
} from './affordability-calculator';
import { CalculatorTab } from './calculator-tab';
import { CalculatorTabs, type CalculatorTabDefinition, type CalculatorTabId } from './calculator-tabs';
import { formatCurrency, formatPercent } from './formatters';
import { useNumberInputs } from './use-number-inputs';

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

type MortgageFieldKey = Exclude<keyof MortgageInputs, 'loanType'>;

function isTabType(value: string | null): value is CalculatorTabId {
  return (
    value === 'calculator' ||
    value === 'amortization' ||
    value === 'scenarios' ||
    value === 'affordability'
  );
}

export function MortgageCalculator() {
  const [inputs, setInputs] = useState<MortgageInputs>(defaultInputs);
  const [activeTab, setActiveTab] = useState<CalculatorTabId>('calculator');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const affordabilityActions = useRef<AffordabilityActions | null>(null);

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

  const handleSaveScenario = () => {
    setScenarios((prev) => [
      ...prev,
      {
        id: `scenario-${Date.now()}`,
        name: `Scenario ${prev.length + 1}`,
        inputs: { ...inputs },
        calculations: { ...calculations },
      },
    ]);
    toast.success('Scenario saved', {
      description: 'Compare it on the Scenarios tab.',
    });
  };

  const handleRemoveScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((scenario) => scenario.id !== id));
  }, []);

  const handleTabChange = useCallback((tab: CalculatorTabId) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'calculator') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tab);
    }
    window.history.replaceState({}, '', url.toString());
  }, []);

  const handleReset = () => {
    setInputs(defaultInputs);
    numberInputs.reset();
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
    setActiveTab('calculator');
    toast.success('Calculator reset');
  };

  const handleShareLink = () => {
    if (activeTab === 'affordability' && affordabilityActions.current) {
      affordabilityActions.current.shareLink();
      return;
    }

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
    if (activeTab !== 'calculator') params.set('tab', activeTab);

    navigator.clipboard.writeText(
      `${window.location.origin}${window.location.pathname}?${params.toString()}`
    );
    toast.success('Share link copied', {
      description: 'Anyone you send it to opens this exact scenario.',
    });
  };

  const handleCopySummary = () => {
    if (activeTab === 'affordability' && affordabilityActions.current) {
      affordabilityActions.current.copySummary();
      return;
    }

    const lines = [
      'Mortgage estimate',
      `Purchase price: ${formatCurrency(purchasePrice)}`,
      `Down payment: ${downPaymentPercent}% (${formatCurrency(calculations.downPaymentAmount)})`,
      `Loan amount: ${formatCurrency(calculations.loanAmount)}`,
      `Interest rate: ${interestRate}%`,
      `Term: ${termYears} years`,
      `Loan type: ${getLoanTypeInfo(loanType || 'conventional').name}`,
      '',
      'Monthly payment',
      `  Principal & interest: ${formatCurrency(calculations.principalAndInterest)}`,
      `  Property taxes: ${formatCurrency(calculations.propertyTaxes)}`,
      `  Homeowners insurance: ${formatCurrency(insuranceMonthly)}`,
      `  HOA dues: ${formatCurrency(hoaMonthly)}`,
    ];

    if (calculations.pmiMonthly > 0) {
      lines.push(`  Mortgage insurance: ${formatCurrency(calculations.pmiMonthly)}`);
    }
    if (extraPrincipal > 0) {
      lines.push(`  Extra principal: ${formatCurrency(extraPrincipal)}`);
    }

    lines.push(
      '',
      `Total monthly payment: ${formatCurrency(calculations.totalMonthly)}`,
      `Total interest over the life of the loan: ${formatCurrency(calculations.totalInterest)}`,
      `Loan-to-value: ${formatPercent(calculations.ltv)}`,
      '',
      'These are estimates for planning. Your lender\u2019s approval and disclosures are the final word.'
    );

    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Summary copied');
  };

  const handleUseAffordabilityResults = useCallback(
    (patch: Partial<MortgageInputs>) => {
      handleInputsPatch(patch);
      numberInputs.reset();
      handleTabChange('calculator');
      toast.success('Price moved to the calculator');
    },
    [handleInputsPatch, numberInputs, handleTabChange]
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

  const tabs: CalculatorTabDefinition[] = [
    { id: 'calculator', label: 'Calculator' },
    { id: 'amortization', label: 'Amortization' },
    { id: 'scenarios', label: 'Scenarios', count: scenarios.length },
    { id: 'affordability', label: 'Affordability' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mortgage coach"
        title="Mortgage calculator"
        description="Model a payment with taxes, insurance, HOA dues, and mortgage insurance so you can set clear expectations before handing a client to AFC."
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
              <Tooltip content="Reset to defaults">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reset to defaults"
                  onClick={handleReset}
                >
                  <RotateCcwIcon className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip content="Copy a share link">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy a share link"
                  onClick={handleShareLink}
                >
                  <Share2Icon className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip content="Copy summary">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy summary"
                  onClick={handleCopySummary}
                >
                  <ClipboardIcon className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
            <Button leadingIcon={<PlusIcon className="h-4 w-4" />} onClick={handleSaveScenario}>
              Save scenario
            </Button>
          </>
        }
      />

      <CalculatorTabs tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {activeTab === 'calculator' ? (
        <TabPanel id="calculator">
          <CalculatorTab
            inputs={inputs}
            calculations={calculations}
            numberInputs={numberInputs}
            onInputsPatch={handleInputsPatch}
          />
        </TabPanel>
      ) : null}

      {activeTab === 'amortization' ? (
        <TabPanel id="amortization">
          <AmortizationTable
            schedule={amortizationSchedule}
            includesExtraPrincipal={extraPrincipal > 0}
          />
        </TabPanel>
      ) : null}

      {activeTab === 'scenarios' ? (
        <TabPanel id="scenarios">
          <ScenarioComparison
            scenarios={scenarios}
            onRemoveScenario={handleRemoveScenario}
            onStartFromCalculator={() => handleTabChange('calculator')}
          />
        </TabPanel>
      ) : null}

      {/* Kept mounted so borrower details survive a trip to another tab. */}
      <TabPanel id="affordability" hidden={activeTab !== 'affordability'}>
        <AffordabilityCalculator
          loanInputs={inputs}
          onLoanInputsChange={handleInputsPatch}
          onUseResults={handleUseAffordabilityResults}
          actionsRef={affordabilityActions}
        />
      </TabPanel>
    </div>
  );
}

function TabPanel({
  id,
  hidden,
  children,
}: {
  id: CalculatorTabId;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`calculator-panel-${id}`}
      aria-labelledby={`calculator-tab-${id}`}
      tabIndex={-1}
      hidden={hidden}
    >
      {children}
    </div>
  );
}
