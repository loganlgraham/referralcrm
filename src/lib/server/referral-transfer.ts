type AuditEntryLite = {
  field?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp?: Date | string | number | null;
};

type ReferralLite = {
  lender?: { toString(): string } | string | null;
  audit?: AuditEntryLite[] | null;
};

function toIdString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function') {
    const str = (value as { toString(): string }).toString();
    return str.length > 0 ? str : null;
  }
  return null;
}

function toTime(value: Date | string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Resolves the MC (lender) a transfer should be credited to. When a referral is
 * reassigned to a new MC, the transfer stays with the original (first-assigned)
 * MC rather than following the current `lender`. The original MC is reconstructed
 * from the `lender` audit trail; referrals that were never reassigned fall back to
 * the current `lender`.
 */
export function resolveOriginalLenderId(referral: ReferralLite): string | null {
  const lenderAudits = (referral.audit ?? [])
    .filter((entry) => entry?.field === 'lender')
    .slice()
    .sort((a, b) => toTime(a?.timestamp) - toTime(b?.timestamp));

  if (lenderAudits.length > 0) {
    const earliest = lenderAudits[0];
    const original = toIdString(earliest.previousValue) ?? toIdString(earliest.newValue);
    if (original) {
      return original;
    }
  }

  return toIdString(referral.lender ?? null);
}
