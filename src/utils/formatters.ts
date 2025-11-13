const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

const numberFormatter = new Intl.NumberFormat('en-US');
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

export function formatCurrency(cents: number) {
  return currencyFormatter.format((cents || 0) / 100);
}

export function formatNumber(value: number) {
  return numberFormatter.format(value || 0);
}

export function formatDecimal(value: number | null | undefined, fractionDigits = 1) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  if (fractionDigits === 1) {
    return decimalFormatter.format(value);
  }
  return value.toFixed(fractionDigits);
}

export function formatPhoneNumber(value?: string | null) {
  if (!value) {
    return '';
  }
  const digits = value.replace(/\D+/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return value;
}
