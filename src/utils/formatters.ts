import { formatInTimeZone } from 'date-fns-tz';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

const wholeCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat('en-US');
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const MST_TIMEZONE = 'America/Denver';

export function formatCurrency(cents: number) {
  return currencyFormatter.format((cents || 0) / 100);
}

export function formatCurrencyWhole(cents: number) {
  return wholeCurrencyFormatter.format((cents || 0) / 100);
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
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return value;
}

export function formatPhoneInput(value: string) {
  const digits = value.replace(/\D+/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('1')) {
    const normalized = digits.slice(1, 11);
    if (normalized.length <= 3) {
      return `1-${normalized}`;
    }
    if (normalized.length <= 6) {
      return `1-${normalized.slice(0, 3)}-${normalized.slice(3)}`;
    }
    return `1-${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }

  const normalized = digits.slice(0, 10);
  if (normalized.length <= 3) {
    return normalized;
  }
  if (normalized.length <= 6) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

export function formatDate(value?: string | Date | null) {
  if (!value) {
    return '—';
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return dateFormatter.format(parsed);
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) {
    return '—';
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return dateTimeFormatter.format(parsed);
}

export function formatDateMST(value?: string | Date | null) {
  if (!value) {
    return '—';
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return formatInTimeZone(parsed, MST_TIMEZONE, 'MMM d, yyyy');
}

export function formatDateTimeMST(value?: string | Date | null) {
  if (!value) {
    return '—';
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return formatInTimeZone(parsed, MST_TIMEZONE, "MMM d, yyyy 'at' h:mm a 'MT'");
}
