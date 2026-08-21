'use client';

import { LayersIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MortgageInputs, MortgageCalculations } from '@/utils/mortgage-calculations';
import { formatCurrency, formatPercent } from './formatters';

export interface Scenario {
  id: string;
  name: string;
  inputs: MortgageInputs;
  calculations: MortgageCalculations;
}

interface ScenarioComparisonProps {
  scenarios: Scenario[];
  onRemoveScenario: (id: string) => void;
  onStartFromCalculator: () => void;
}

type RowFormat = 'currency' | 'percent' | 'text';
/** Which direction counts as the better outcome, when one exists. */
type RowBest = 'low' | 'high' | 'none';

interface ComparisonRow {
  label: string;
  format: RowFormat;
  best: RowBest;
  value: (scenario: Scenario) => number | string;
  emphasis?: boolean;
}

const rows: ComparisonRow[] = [
  {
    label: 'Monthly payment',
    format: 'currency',
    best: 'low',
    value: (scenario) => scenario.calculations.totalMonthly,
    emphasis: true,
  },
  {
    label: 'Purchase price',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.inputs.purchasePrice,
  },
  {
    label: 'Down payment',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.calculations.downPaymentAmount,
  },
  {
    label: 'Loan amount',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.calculations.loanAmount,
  },
  {
    label: 'Interest rate',
    format: 'text',
    best: 'none',
    value: (scenario) => `${scenario.inputs.interestRate}%`,
  },
  {
    label: 'Term',
    format: 'text',
    best: 'none',
    value: (scenario) => `${scenario.inputs.termYears} yrs`,
  },
  {
    label: 'Loan-to-value',
    format: 'percent',
    best: 'low',
    value: (scenario) => scenario.calculations.ltv,
  },
  {
    label: 'Principal & interest',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.calculations.principalAndInterest,
  },
  {
    label: 'Property taxes',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.calculations.propertyTaxes,
  },
  {
    label: 'Homeowners insurance',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.inputs.insuranceMonthly,
  },
  {
    label: 'HOA dues',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.inputs.hoaMonthly,
  },
  {
    label: 'Mortgage insurance',
    format: 'currency',
    best: 'low',
    value: (scenario) => scenario.calculations.pmiMonthly,
  },
  {
    label: 'Extra principal',
    format: 'currency',
    best: 'none',
    value: (scenario) => scenario.inputs.extraPrincipal,
  },
  {
    label: 'Total interest',
    format: 'currency',
    best: 'low',
    value: (scenario) => scenario.calculations.totalInterest,
  },
];

function renderValue(value: number | string, format: RowFormat) {
  if (typeof value === 'string') return value;
  return format === 'percent' ? formatPercent(value) : formatCurrency(value);
}

/**
 * Only marks a winner when the values actually differ, so identical scenarios
 * don't get an arbitrary green cell.
 */
function findBestIds(scenarios: Scenario[], row: ComparisonRow): Set<string> {
  if (row.best === 'none' || scenarios.length < 2) return new Set();

  const numeric = scenarios.map((scenario) => ({
    id: scenario.id,
    value: row.value(scenario),
  }));
  if (numeric.some((entry) => typeof entry.value !== 'number')) return new Set();

  const values = numeric.map((entry) => entry.value as number);
  const target = row.best === 'low' ? Math.min(...values) : Math.max(...values);
  if (values.every((value) => value === target)) return new Set();

  return new Set(
    numeric.filter((entry) => (entry.value as number) === target).map((entry) => entry.id)
  );
}

export function ScenarioComparison({
  scenarios,
  onRemoveScenario,
  onStartFromCalculator,
}: ScenarioComparisonProps) {
  if (scenarios.length === 0) {
    return (
      <EmptyState
        icon={<LayersIcon className="h-5 w-5" aria-hidden />}
        title="No saved scenarios yet"
        description="Save a scenario from the calculator to line options up side by side."
        action={
          <Button variant="secondary" size="sm" onClick={onStartFromCalculator}>
            Open the calculator
          </Button>
        }
      />
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface-raised shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-eyebrow text-foreground-subtle">Scenario comparison</h2>
        <p className="text-xs text-foreground-subtle">
          {scenarios.length === 1
            ? 'Save another scenario to compare.'
            : 'Green marks the better number in each row.'}
        </p>
      </div>

      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-[1] bg-surface-raised px-4 py-3 text-left text-eyebrow text-foreground-subtle"
              >
                Metric
              </th>
              {scenarios.map((scenario) => (
                <th key={scenario.id} scope="col" className="px-4 py-3 text-right align-top">
                  <div className="flex items-start justify-end gap-1.5">
                    <span className="text-sm font-semibold text-foreground">{scenario.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveScenario(scenario.id)}
                      aria-label={`Remove ${scenario.name}`}
                      className="rounded-md p-0.5 text-foreground-subtle transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const bestIds = findBestIds(scenarios, row);
              return (
                <tr key={row.label} className="border-t border-border">
                  <th
                    scope="row"
                    className={cn(
                      'sticky left-0 z-[1] bg-surface-raised px-4 py-2 text-left font-medium',
                      row.emphasis ? 'text-foreground' : 'text-foreground-muted'
                    )}
                  >
                    {row.label}
                  </th>
                  {scenarios.map((scenario) => {
                    const value = row.value(scenario);
                    const isBest = bestIds.has(scenario.id);
                    return (
                      <td
                        key={scenario.id}
                        className={cn(
                          'text-numeric px-4 py-2 text-right',
                          row.emphasis
                            ? 'text-base font-bold text-foreground'
                            : 'font-medium text-foreground-muted',
                          isBest && 'text-[hsl(var(--success))]'
                        )}
                      >
                        {renderValue(value, row.format)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
