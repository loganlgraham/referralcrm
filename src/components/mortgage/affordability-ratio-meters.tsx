'use client';

import { formatCurrency, formatPercent } from './formatters';

interface RatioMeterProps {
  title: string;
  description: string;
  ratio: number;
  capPercent: number | null;
  headroom: number | null;
}

function RatioMeter({ title, description, ratio, capPercent, headroom }: RatioMeterProps) {
  const cap = capPercent === null ? null : capPercent / 100;
  const fill = cap && cap > 0 ? Math.min((ratio / cap) * 100, 100) : Math.min(ratio * 100, 100);
  const overCap = cap !== null && ratio > cap + 0.0005;
  const nearCap = cap !== null && !overCap && ratio > cap * 0.95;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-foreground-muted">{title}</span>
        <span className="text-numeric font-semibold text-foreground">
          {formatPercent(ratio)}
          {capPercent === null ? null : (
            <span className="ml-1 text-xs font-medium text-foreground-subtle">
              of {capPercent}%
            </span>
          )}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface-subtle">
        <div
          className={`h-2 rounded-pill ${
            overCap ? 'bg-danger' : nearCap ? 'bg-warning' : 'bg-success'
          }`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-foreground-subtle">
        {headroom === null
          ? description
          : headroom >= 0
          ? `${formatCurrency(headroom)} per month of room left. ${description}`
          : `${formatCurrency(Math.abs(headroom))} per month over the limit. ${description}`}
      </p>
    </div>
  );
}

interface AffordabilityRatioMetersProps {
  grossMonthlyIncome: number;
  frontEndRatio: number | null;
  backEndRatio: number | null;
  frontEndCapPercent: number | null;
  backEndCapPercent: number;
  frontEndHeadroom: number | null;
  backEndHeadroom: number | null;
  guidelineNote: string;
}

export function AffordabilityRatioMeters({
  grossMonthlyIncome,
  frontEndRatio,
  backEndRatio,
  frontEndCapPercent,
  backEndCapPercent,
  frontEndHeadroom,
  backEndHeadroom,
  guidelineNote,
}: AffordabilityRatioMetersProps) {
  if (grossMonthlyIncome <= 0 || frontEndRatio === null || backEndRatio === null) {
    return (
      <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <h3 className="text-eyebrow text-foreground-subtle">Qualifying ratios</h3>
        <p className="mt-2 text-sm text-foreground-muted">
          Add gross monthly income to see how the payment lines up against qualifying limits.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <h3 className="text-eyebrow text-foreground-subtle">Qualifying ratios</h3>
      <div className="mt-3 space-y-4">
        <RatioMeter
          title="Housing payment vs income"
          description={
            frontEndCapPercent === null
              ? 'This program does not use a housing payment limit.'
              : 'Everything in the monthly payment above, divided by gross income.'
          }
          ratio={frontEndRatio}
          capPercent={frontEndCapPercent}
          headroom={frontEndHeadroom}
        />
        <RatioMeter
          title="All debt vs income"
          description="Housing payment plus car loans, cards, and student loans."
          ratio={backEndRatio}
          capPercent={backEndCapPercent}
          headroom={backEndHeadroom}
        />
      </div>
      <p className="mt-3 text-xs text-foreground-subtle">{guidelineNote}</p>
    </section>
  );
}
