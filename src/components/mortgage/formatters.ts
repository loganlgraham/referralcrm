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

export function formatCurrency(value: number): string {
  return currencyFormatter.format(Math.round(Number.isFinite(value) ? value : 0));
}

export function formatPercent(value: number): string {
  return percentFormatter.format(Number.isFinite(value) ? value : 0);
}

/** Currency with an explicit plus or minus, for deltas. */
export function formatSignedCurrency(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  if (rounded === 0) return 'No change';
  return `${rounded > 0 ? '+' : '-'}${formatCurrency(Math.abs(rounded))}`;
}
