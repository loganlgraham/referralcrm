const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatCurrency(cents: number) {
  return currencyFormatter.format((cents || 0) / 100);
}

export function formatNumber(value: number) {
  return numberFormatter.format(value || 0);
}
