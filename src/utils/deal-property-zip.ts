export const DEAL_PROPERTY_ZIP_SOURCE_VALUES = [
  'manual',
  'address_extracted',
  'address_verified',
] as const;

export type DealPropertyZipSource = (typeof DEAL_PROPERTY_ZIP_SOURCE_VALUES)[number];

export type DealPropertyZipNormalizeResult =
  | { ok: true; zip: string | null }
  | { ok: false; reason: 'invalid_zip' };

export function normalizeDealPropertyZipInput(
  value: string | null | undefined
): DealPropertyZipNormalizeResult {
  if (value == null) {
    return { ok: true, zip: null };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, zip: null };
  }

  const match = /^(\d{5})(?:-\d{4})?$/.exec(trimmed);
  if (!match) {
    return { ok: false, reason: 'invalid_zip' };
  }

  return { ok: true, zip: match[1] };
}
