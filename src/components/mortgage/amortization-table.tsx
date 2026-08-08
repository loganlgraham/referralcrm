'use client';

import { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { AmortizationEntry } from '@/utils/mortgage-calculations';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

interface AmortizationTableProps {
  schedule: AmortizationEntry[];
  includesExtraPrincipal: boolean;
}

export function AmortizationTable({ schedule, includesExtraPrincipal }: AmortizationTableProps) {
  const [viewMode, setViewMode] = useState<'yearly' | 'monthly'>('yearly');
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  // Group by year for yearly view
  const yearlyData = useMemo(() => {
    const years: {
      year: number;
      totalPayment: number;
      totalPrincipal: number;
      totalInterest: number;
      totalExtraPrincipal: number;
      endingBalance: number;
      months: AmortizationEntry[];
    }[] = [];

    schedule.forEach((entry) => {
      const yearIndex = Math.ceil(entry.month / 12);
      let yearData = years.find((y) => y.year === yearIndex);

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
        years.push(yearData);
      }

      yearData.totalPayment += entry.payment;
      yearData.totalPrincipal += entry.principal;
      yearData.totalInterest += entry.interest;
      yearData.totalExtraPrincipal += entry.extraPrincipal;
      yearData.endingBalance = entry.balance;
      yearData.months.push(entry);
    });

    return years;
  }, [schedule]);

  const toggleYear = (year: number) => {
    const newExpanded = new Set(expandedYears);
    if (newExpanded.has(year)) {
      newExpanded.delete(year);
    } else {
      newExpanded.add(year);
    }
    setExpandedYears(newExpanded);
  };

  if (schedule.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="text-sm text-foreground-subtle">No amortization data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View mode toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Amortization Schedule</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('yearly')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === 'yearly'
                ? 'bg-primary text-white'
                : 'bg-surface-subtle text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Yearly
          </button>
          <button
            onClick={() => setViewMode('monthly')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === 'monthly'
                ? 'bg-primary text-white'
                : 'bg-surface-subtle text-foreground-muted hover:bg-surface-subtle'
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[500px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-muted text-foreground-muted">
            <tr>
              <th className="border-b border-border px-3 py-2 text-left font-semibold">
                {viewMode === 'yearly' ? 'Year' : 'Month'}
              </th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold">Payment</th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold">Principal</th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold">Interest</th>
              {includesExtraPrincipal && (
                <th className="border-b border-border px-3 py-2 text-right font-semibold">Extra</th>
              )}
              <th className="border-b border-border px-3 py-2 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {viewMode === 'yearly' ? (
              <>
                {yearlyData.map((yearData) => (
                  <>
                    <tr
                      key={`year-${yearData.year}`}
                      className="cursor-pointer hover:bg-surface-muted"
                      onClick={() => toggleYear(yearData.year)}
                    >
                      <td className="border-b border-border px-3 py-2 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {expandedYears.has(yearData.year) ? (
                            <ChevronUpIcon className="h-3 w-3" />
                          ) : (
                            <ChevronDownIcon className="h-3 w-3" />
                          )}
                          Year {yearData.year}
                        </div>
                      </td>
                      <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                        {currencyFormatter.format(yearData.totalPayment)}
                      </td>
                      <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                        {currencyFormatter.format(yearData.totalPrincipal)}
                      </td>
                      <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                        {currencyFormatter.format(yearData.totalInterest)}
                      </td>
                      {includesExtraPrincipal && (
                        <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                          {currencyFormatter.format(yearData.totalExtraPrincipal)}
                        </td>
                      )}
                      <td className="border-b border-border px-3 py-2 text-right font-medium text-foreground">
                        {currencyFormatter.format(yearData.endingBalance)}
                      </td>
                    </tr>
                    {expandedYears.has(yearData.year) &&
                      yearData.months.map((entry) => (
                        <tr key={`month-${entry.month}`} className="bg-surface-muted/50 text-foreground-muted">
                          <td className="border-b border-border px-3 py-1.5 pl-10 text-xs">Month {entry.month}</td>
                          <td className="border-b border-border px-3 py-1.5 text-right">
                            {currencyFormatter.format(entry.payment)}
                          </td>
                          <td className="border-b border-border px-3 py-1.5 text-right">
                            {currencyFormatter.format(entry.principal)}
                          </td>
                          <td className="border-b border-border px-3 py-1.5 text-right">
                            {currencyFormatter.format(entry.interest)}
                          </td>
                          {includesExtraPrincipal && (
                            <td className="border-b border-border px-3 py-1.5 text-right">
                              {currencyFormatter.format(entry.extraPrincipal)}
                            </td>
                          )}
                          <td className="border-b border-border px-3 py-1.5 text-right">
                            {currencyFormatter.format(entry.balance)}
                          </td>
                        </tr>
                      ))}
                  </>
                ))}
              </>
            ) : (
              <>
                {schedule.map((entry) => (
                  <tr key={`month-${entry.month}`} className="hover:bg-surface-muted">
                    <td className="border-b border-border px-3 py-2 font-medium text-foreground">
                      Month {entry.month}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                      {currencyFormatter.format(entry.payment)}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                      {currencyFormatter.format(entry.principal)}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                      {currencyFormatter.format(entry.interest)}
                    </td>
                    {includesExtraPrincipal && (
                      <td className="border-b border-border px-3 py-2 text-right text-foreground-muted">
                        {currencyFormatter.format(entry.extraPrincipal)}
                      </td>
                    )}
                    <td className="border-b border-border px-3 py-2 text-right font-medium text-foreground">
                      {currencyFormatter.format(entry.balance)}
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-muted p-3">
        <div>
          <p className="text-xs text-foreground-subtle">Total Payments</p>
          <p className="text-sm font-semibold text-foreground">{schedule.length} months</p>
        </div>
        <div>
          <p className="text-xs text-foreground-subtle">Total Interest Paid</p>
          <p className="text-sm font-semibold text-foreground">
            {currencyFormatter.format(schedule[schedule.length - 1]?.cumulativeInterest || 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-foreground-subtle">Payoff Date</p>
          <p className="text-sm font-semibold text-foreground">
            {new Date(Date.now() + schedule.length * 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
