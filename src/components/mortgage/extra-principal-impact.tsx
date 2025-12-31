'use client';

import { ClockIcon, DollarSignIcon, CalendarIcon } from 'lucide-react';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

interface ExtraPrincipalImpactProps {
  monthsSaved: number;
  yearsSaved: number;
  interestSaved: number;
  originalPayoffDate: Date;
  newPayoffDate: Date;
  extraPrincipalAmount: number;
}

export function ExtraPrincipalImpact({
  monthsSaved,
  yearsSaved,
  interestSaved,
  originalPayoffDate,
  newPayoffDate,
  extraPrincipalAmount,
}: ExtraPrincipalImpactProps) {
  if (extraPrincipalAmount === 0 || monthsSaved <= 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800">Extra Principal Impact</h3>
        <p className="mt-2 text-xs text-slate-500">
          Add an extra principal payment to see how much time and interest you can save.
        </p>
      </div>
    );
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const yearsDisplay = Math.floor(yearsSaved);
  const monthsDisplay = Math.round((yearsSaved - yearsDisplay) * 12);

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-emerald-500 p-1.5 text-white">
          <DollarSignIcon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold text-emerald-900">Extra Principal Impact</h3>
      </div>

      <p className="mt-2 text-xs text-emerald-800">
        By paying an extra <strong>{currencyFormatter.format(extraPrincipalAmount)}/month</strong>, you will:
      </p>

      <div className="mt-4 grid gap-3">
        {/* Time Saved */}
        <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
          <div className="rounded-md bg-emerald-100 p-2 text-emerald-600">
            <ClockIcon className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-700">Time Saved</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">
              {yearsDisplay > 0 && `${yearsDisplay} ${yearsDisplay === 1 ? 'year' : 'years'}`}
              {yearsDisplay > 0 && monthsDisplay > 0 && ', '}
              {monthsDisplay > 0 && `${monthsDisplay} ${monthsDisplay === 1 ? 'month' : 'months'}`}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Earlier loan payoff</p>
          </div>
        </div>

        {/* Interest Saved */}
        <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
          <div className="rounded-md bg-emerald-100 p-2 text-emerald-600">
            <DollarSignIcon className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-700">Interest Saved</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{currencyFormatter.format(interestSaved)}</p>
            <p className="mt-0.5 text-xs text-slate-500">Over the life of the loan</p>
          </div>
        </div>

        {/* Payoff Date */}
        <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
          <div className="rounded-md bg-emerald-100 p-2 text-emerald-600">
            <CalendarIcon className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-700">New Payoff Date</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{formatDate(newPayoffDate)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              <span className="line-through text-slate-400">{formatDate(originalPayoffDate)}</span> original
            </p>
          </div>
        </div>
      </div>

      {/* Visualization bar */}
      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-emerald-900">Payoff Progress Comparison</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-slate-600">Standard</span>
            <div className="h-4 flex-1 rounded-full bg-slate-200">
              <div className="h-4 rounded-full bg-slate-400" style={{ width: '100%' }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-emerald-800">With extra</span>
            <div className="h-4 flex-1 rounded-full bg-emerald-100">
              <div
                className="h-4 rounded-full bg-emerald-500"
                style={{ width: `${((1 - yearsSaved / (monthsSaved / 12 + yearsSaved)) * 100).toFixed(0)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
