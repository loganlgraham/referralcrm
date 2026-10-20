'use client';

import { TrendingUpIcon } from 'lucide-react';
import { BindingConstraint, BuyingPowerLever, BuyingPowerLevers } from '@/utils/affordability';
import { formatCurrency, formatSignedCurrency } from './formatters';

function LeverGroup({ title, levers }: { title: string; levers: BuyingPowerLever[] }) {
  if (levers.length === 0) return null;

  return (
    <div>
      <p className="text-eyebrow text-foreground-subtle">{title}</p>
      <ul className="mt-1.5 divide-y divide-border">
        {levers.map((lever) => (
          <li key={lever.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-foreground-muted">{lever.label}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-numeric font-semibold text-foreground">
                {formatCurrency(lever.maxPurchasePrice)}
              </span>
              <span
                className={`text-numeric text-xs font-medium ${
                  lever.priceDelta > 0
                    ? 'text-[hsl(var(--success))]'
                    : lever.priceDelta < 0
                    ? 'text-[hsl(var(--danger))]'
                    : 'text-foreground-subtle'
                }`}
              >
                {formatSignedCurrency(lever.priceDelta)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BuyingPowerLeversProps {
  levers: BuyingPowerLevers;
  bindingConstraint: BindingConstraint;
}

export function BuyingPowerLeversPanel({ levers, bindingConstraint }: BuyingPowerLeversProps) {
  const cappedByCash = bindingConstraint === 'cash-to-close';
  const cappedByBudget = bindingConstraint === 'comfort-budget';
  const cappedByHousingRatio = bindingConstraint === 'front-end-dti';
  const cappedByInsuranceCliff = bindingConstraint === 'mortgage-insurance-cliff';

  return (
    <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <h3 className="flex items-center gap-2 text-eyebrow text-foreground-subtle">
        <TrendingUpIcon className="h-3.5 w-3.5 text-signal" aria-hidden />
        What moves the number
      </h3>

      <p className="mt-3 rounded-lg bg-primary-soft px-3 py-2 text-sm text-foreground">
        Every <span className="text-numeric font-semibold">{formatCurrency(100)}</span> per month
        freed up is worth about{' '}
        <span className="text-numeric font-semibold">
          {formatCurrency(levers.pricePerHundredMonthly)}
        </span>{' '}
        in purchase price at this rate and term.
      </p>

      {cappedByCash ? (
        <p className="mt-2 text-xs text-[hsl(var(--warning))]">
          Cash to close is the limit right now, so income and debt changes will not move the maximum
          price until there is more cash available.
        </p>
      ) : null}
      {cappedByBudget ? (
        <p className="mt-2 text-xs text-foreground-subtle">
          The target monthly payment is the limit right now, so this buyer qualifies for more than
          the price shown.
        </p>
      ) : null}
      {cappedByInsuranceCliff ? (
        <p className="mt-2 text-xs text-foreground-subtle">
          The price is sitting right at 20% down. Until there is more cash for the down payment,
          extra monthly room mostly goes to mortgage insurance instead of a bigger house.
        </p>
      ) : null}
      {cappedByHousingRatio ? (
        <p className="mt-2 text-xs text-foreground-subtle">
          The housing payment limit is what is binding, not their other debt, so paying off debt
          will not raise this price. More income or a lower rate will.
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <LeverGroup title="Pay down debt" levers={levers.debtPaydown} />
        <LeverGroup title="If the rate moves" levers={levers.rateShifts} />
        <LeverGroup title="More down payment" levers={levers.extraDownPayment} />
        <LeverGroup title="More income" levers={levers.incomeIncrease} />
      </div>
    </section>
  );
}
