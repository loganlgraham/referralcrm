'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClipboardIcon, PlusIcon, RotateCcwIcon, Share2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/tooltip';
import { describeMortgageInsuranceDuration, getMortgageInsuranceLabel } from '@/utils/affordability';
import {
  MortgageInputs,
  calculateMortgage,
  generateAmortizationSchedule,
  getLoanTypeInfo,
} from '@/utils/mortgage-calculations';
import { AmortizationTable } from './amortization-table';
import { ScenarioComparison, createScenario, type Scenario } from './scenario-comparison';
import {
  AffordabilityCalculator,
  type AffordabilityActions,
} from './affordability-calculator';
import { CalculatorTab } from './calculator-tab';
import { CalculatorTabs, type CalculatorTabDefinition, type CalculatorTabId } from './calculator-tabs';
import {
  clearStoredCalculatorState,
  loadCalculatorState,
  parseInputsFromParams,
  saveCalculatorState,
  toInputParams,
  type MortgageNumericKey,
  type StoredScenario,
} from './calculator-state';
import { copyToClipboard } from './copy-to-clipboard';
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
  vaSubsequentUse: false,
};

/** Past this the comparison table is wider than it is useful. */
const MAX_SCENARIOS = 6;

/** How long to wait after the last edit before writing state to storage. */
const SAVE_DEBOUNCE_MS = 400;

function isTabType(value: string | null): value is CalculatorTabId {
  return (
    value === 'calculator' ||
    value === 'amortization' ||
    value === 'scenarios' ||
    value === 'affordability'
  );
}

/** Lowest unused "Scenario N", so removing one never creates a duplicate name. */
function nextScenarioName(existing: Scenario[]): string {
  const taken = new Set(existing.map((scenario) => scenario.name));
  let number = existing.length + 1;
  while (taken.has(`Scenario ${number}`)) number += 1;
  return `Scenario ${number}`;
}

function toStoredScenario(scenario: Scenario): StoredScenario {
  return { id: scenario.id, name: scenario.name, inputs: scenario.inputs };
}

export function MortgageCalculator() {
  const [inputs, setInputs] = useState<MortgageInputs>(defaultInputs);
  const [activeTab, setActiveTab] = useState<CalculatorTabId>('calculator');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  // Storage is read after mount to keep the server and client markup identical,
  // so saving has to wait until that read has happened.
  const [hasRestoredState, setHasRestoredState] = useState(false);
  // Bumped on reset to remount the Affordability panel back to its defaults.
  const [affordabilityInstance, setAffordabilityInstance] = useState(0);
  const affordabilityActions = useRef<AffordabilityActions | null>(null);

  const { termYears, insuranceMonthly, hoaMonthly, extraPrincipal } = inputs;

  const handleNumberChange = useCallback((key: MortgageNumericKey, value: number) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const numberInputs = useNumberInputs<MortgageNumericKey>(handleNumberChange);

  const handleInputsPatch = useCallback((patch: Partial<MortgageInputs>) => {
    setInputs((prev) => ({ ...prev, ...patch }));
  }, []);

  const calculations = useMemo(() => calculateMortgage(inputs), [inputs]);

  const amortizationSchedule = useMemo(
    () => generateAmortizationSchedule(inputs, calculations),
    [inputs, calculations]
  );

  const handleSaveScenario = () => {
    if (scenarios.length >= MAX_SCENARIOS) {
      toast.error(`You can compare up to ${MAX_SCENARIOS} scenarios at once`, {
        description: 'Remove one on the Scenarios tab to make room.',
      });
      return;
    }

    setScenarios((prev) => [
      ...prev,
      createScenario(`scenario-${Date.now()}`, nextScenarioName(prev), { ...inputs }),
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
    clearStoredCalculatorState();
    setInputs(defaultInputs);
    setScenarios([]);
    numberInputs.reset();
    setAffordabilityInstance((instance) => instance + 1);
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
    setActiveTab('calculator');
    toast.success('Calculator reset', {
      description: 'Loan terms, borrower details, and saved scenarios are all cleared.',
    });
  };

  const handleShareLink = () => {
    if (activeTab === 'affordability' && affordabilityActions.current) {
      affordabilityActions.current.shareLink();
      return;
    }

    const params = toInputParams(inputs);
    if (activeTab !== 'calculator') params.set('tab', activeTab);

    void copyToClipboard(
      `${window.location.origin}${window.location.pathname}?${params.toString()}`,
      {
        title: 'Share link copied',
        description: 'Anyone you send it to opens this exact scenario.',
      }
    );
  };

  const handleCopySummary = () => {
    if (activeTab === 'affordability' && affordabilityActions.current) {
      affordabilityActions.current.copySummary();
      return;
    }

    const loanType = inputs.loanType ?? 'conventional';
    const lines = [
      'Mortgage estimate',
      `Purchase price: ${formatCurrency(inputs.purchasePrice)}`,
      `Down payment: ${inputs.downPaymentPercent}% (${formatCurrency(calculations.downPaymentAmount)})`,
      `Loan amount: ${formatCurrency(calculations.loanAmount)}`,
      `Interest rate: ${inputs.interestRate}%`,
      `Term: ${termYears} years`,
      `Loan type: ${getLoanTypeInfo(loanType).name}`,
      '',
      'Monthly payment',
      `  Principal & interest: ${formatCurrency(calculations.principalAndInterest)}`,
      `  Property taxes: ${formatCurrency(calculations.propertyTaxes)}`,
      `  Homeowners insurance: ${formatCurrency(insuranceMonthly)}`,
      `  HOA dues: ${formatCurrency(hoaMonthly)}`,
    ];

    if (calculations.pmiMonthly > 0) {
      const duration = describeMortgageInsuranceDuration(calculations.mortgageInsuranceMonths);
      lines.push(
        `  ${getMortgageInsuranceLabel(loanType)}: ${formatCurrency(calculations.pmiMonthly)}${
          duration ? ` (${duration.toLowerCase()})` : ''
        }`
      );
    }
    if (extraPrincipal > 0) {
      lines.push(`  Extra principal: ${formatCurrency(extraPrincipal)}`);
    }

    // Read the interest off the schedule rather than the scheduled-payments
    // total, so extra principal is reflected in what gets pasted to a client.
    const interestPaid = amortizationSchedule.at(-1)?.cumulativeInterest ?? 0;

    lines.push(
      '',
      `Total monthly payment: ${formatCurrency(calculations.totalMonthly)}`,
      `Paid off in: ${amortizationSchedule.length} payments`,
      `Total interest paid: ${formatCurrency(interestPaid)}`,
      `Loan-to-value: ${formatPercent(calculations.ltv)}`,
      '',
      'These are estimates for planning. Your lender\u2019s approval and disclosures are the final word.'
    );

    void copyToClipboard(lines.join('\n'), { title: 'Summary copied' });
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
    const linkInputs = parseInputsFromParams(params);
    const stored = loadCalculatorState();

    // A share link describes one specific scenario, so it wins over whatever
    // was last left on this device.
    const restored = Object.keys(linkInputs).length > 0 ? linkInputs : stored.inputs;
    if (Object.keys(restored).length > 0) {
      setInputs((prev) => ({ ...prev, ...restored }));
    }

    if (stored.scenarios.length > 0) {
      setScenarios(
        stored.scenarios.map((scenario) =>
          createScenario(scenario.id, scenario.name, { ...defaultInputs, ...scenario.inputs })
        )
      );
    }

    const tab = params.get('tab');
    if (isTabType(tab)) setActiveTab(tab);

    setHasRestoredState(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredState) return undefined;

    const timer = setTimeout(() => {
      saveCalculatorState({ inputs, scenarios: scenarios.map(toStoredScenario) });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hasRestoredState, inputs, scenarios]);

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
              <Tooltip content="Reset everything to defaults">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reset everything to defaults"
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
          key={affordabilityInstance}
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
