'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AmortizationEntry } from '@/utils/mortgage-calculations';
import { SegmentedToggle } from './fields';
import { formatCurrency } from './formatters';

type ViewMode = 'yearly' | 'monthly';

interface YearSummary {
  year: number;
  totalPayment: number;
  totalPrincipal: number;
  totalInterest: number;
  totalExtraPrincipal: number;
  endingBalance: number;
  months: AmortizationEntry[];
}

interface AmortizationTableProps {
  schedule: AmortizationEntry[];
  includesExtraPrincipal: boolean;
}

const headerCell =
  'sticky top-0 z-[1] bg-surface-raised px-3 py-2 text-eyebrow text-foreground-subtle shadow-[inset_0_-1px_0_0_hsl(var(--border))]';

export function AmortizationTable({ schedule, includesExtraPrincipal }: AmortizationTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('yearly');
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  const yearlyData = useMemo(() => {
    const years: YearSummary[] = [];
    const byYear = new Map<number, YearSummary>();

    for (const entry of schedule) {
      const yearIndex = Math.ceil(entry.month / 12);
      let yearData = byYear.get(yearIndex);

      if (!yearData) {
        yearData = {
          year: yearIndex,
          totalPayment: 0,
          totalPrincipal: 0,
          totalInterest: 0,
          totalExtraPrincipal: 0,
          endingBalance: entry.balance,
          months: [],
        };
        byYear.set(yearIndex, yearData);
        years.push(yearData);
      }

      yearData.totalPayment += entry.payment;
      yearData.totalPrincipal += entry.principal;
      yearData.totalInterest += entry.interest;
      yearData.totalExtraPrincipal += entry.extraPrincipal;
      yearData.endingBalance = entry.balance;
      yearData.months.push(entry);
    }

    return years;
  }, [schedule]);

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  if (schedule.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface-raised p-8 text-center shadow-card">
        <p className="text-sm text-foreground-muted">No amortization data available.</p>
      </div>
    );
  }

  const totalInterest = schedule[schedule.length - 1]?.cumulativeInterest ?? 0;
  const payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + schedule.length);

  const summary = [
    { label: 'Payments', value: `${schedule.length} months` },
    { label: 'Total interest', value: formatCurrency(totalInterest) },
    {
      label: 'Payoff date',
      value: payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    },
  ];

  return (
    <section className="rounded-card border border-border bg-surface-raised shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-eyebrow text-foreground-subtle">Amortization schedule</h2>
        <SegmentedToggle<ViewMode>
          ariaLabel="Schedule detail"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: 'yearly', label: 'Yearly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
        />
      </div>

      <dl className="grid grid-cols-3 divide-x divide-border border-b border-border">
        {summary.map((item) => (
          <div key={item.label} className="px-4 py-3">
            <dt className="text-xs text-foreground-subtle">{item.label}</dt>
            <dd className="text-numeric mt-0.5 text-base font-semibold text-foreground">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="scrollbar-thin max-h-[520px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={cn(headerCell, 'text-left')}>
                {viewMode === 'yearly' ? 'Year' : 'Month'}
              </th>
              <th scope="col" className={cn(headerCell, 'text-right')}>
                Payment
              </th>
              <th scope="col" className={cn(headerCell, 'text-right')}>
                Principal
              </th>
              <th scope="col" className={cn(headerCell, 'text-right')}>
                Interest
              </th>
              {includesExtraPrincipal ? (
                <th scope="col" className={cn(headerCell, 'text-right')}>
                  Extra
                </th>
              ) : null}
              <th scope="col" className={cn(headerCell, 'text-right')}>
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {viewMode === 'yearly'
              ? yearlyData.map((yearData) => {
                  const isExpanded = expandedYears.has(yearData.year);
                  const principalShare =
                    yearData.totalPrincipal + yearData.totalInterest > 0
                      ? yearData.totalPrincipal /
                        (yearData.totalPrincipal + yearData.totalInterest)
                      : 0;

                  return (
                    <Fragment key={`year-${yearData.year}`}>
                      <tr
                        className="cursor-pointer border-t border-border transition hover:bg-surface-muted"
                        onClick={() => toggleYear(yearData.year)}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleYear(yearData.year);
                            }}
                            className="flex items-center gap-1.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {isExpanded ? (
                              <ChevronDownIcon className="h-3.5 w-3.5 text-foreground-subtle" />
                            ) : (
                              <ChevronRightIcon className="h-3.5 w-3.5 text-foreground-subtle" />
                            )}
                            Year {yearData.year}
                          </button>
                          <span
                            aria-hidden
                            className="ml-5 mt-1 flex h-1 w-20 overflow-hidden rounded-pill bg-info/25"
                          >
                            <span
                              className="block h-1 bg-primary"
                              style={{ width: `${principalShare * 100}%` }}
                            />
                          </span>
                        </td>
                        <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                          {formatCurrency(yearData.totalPayment)}
                        </td>
                        <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                          {formatCurrency(yearData.totalPrincipal)}
                        </td>
                        <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                          {formatCurrency(yearData.totalInterest)}
                        </td>
                        {includesExtraPrincipal ? (
                          <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                            {formatCurrency(yearData.totalExtraPrincipal)}
                          </td>
                        ) : null}
                        <td className="text-numeric px-3 py-2 text-right font-semibold text-foreground">
                          {formatCurrency(yearData.endingBalance)}
                        </td>
                      </tr>
                      {isExpanded
                        ? yearData.months.map((entry) => (
                            <tr
                              key={`month-${entry.month}`}
                              className="border-t border-border bg-surface-muted/40 text-xs text-foreground-muted"
                            >
                              <td className="py-1.5 pl-9 pr-3">Month {entry.month}</td>
                              <td className="text-numeric px-3 py-1.5 text-right">
                                {formatCurrency(entry.payment)}
                              </td>
                              <td className="text-numeric px-3 py-1.5 text-right">
                                {formatCurrency(entry.principal)}
                              </td>
                              <td className="text-numeric px-3 py-1.5 text-right">
                                {formatCurrency(entry.interest)}
                              </td>
                              {includesExtraPrincipal ? (
                                <td className="text-numeric px-3 py-1.5 text-right">
                                  {formatCurrency(entry.extraPrincipal)}
                                </td>
                              ) : null}
                              <td className="text-numeric px-3 py-1.5 text-right">
                                {formatCurrency(entry.balance)}
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })
              : schedule.map((entry) => (
                  <tr key={`month-${entry.month}`} className="border-t border-border hover:bg-surface-muted">
                    <td className="px-3 py-2 font-medium text-foreground">Month {entry.month}</td>
                    <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                      {formatCurrency(entry.payment)}
                    </td>
                    <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                      {formatCurrency(entry.principal)}
                    </td>
                    <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                      {formatCurrency(entry.interest)}
                    </td>
                    {includesExtraPrincipal ? (
                      <td className="text-numeric px-3 py-2 text-right text-foreground-muted">
                        {formatCurrency(entry.extraPrincipal)}
                      </td>
                    ) : null}
                    <td className="text-numeric px-3 py-2 text-right font-semibold text-foreground">
                      {formatCurrency(entry.balance)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-border px-4 py-2.5 text-xs text-foreground-subtle">
        {viewMode === 'yearly'
          ? 'Select a year to open its monthly detail. The bar shows how much of that year goes to principal.'
          : 'Every scheduled payment, in order.'}
      </p>
    </section>
  );
}
