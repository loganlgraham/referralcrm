const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedCcRecipients = {
  emails: string[];
  invalid: string[];
};

/**
 * Accepts an array of addresses or a single comma/semicolon-separated string and
 * returns normalized, deduped addresses alongside any entries that failed validation.
 */
export const parseCcRecipients = (input: unknown): ParsedCcRecipients => {
  const raw: string[] = [];

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === 'string') {
        raw.push(...entry.split(/[,;]/));
      }
    }
  } else if (typeof input === 'string') {
    raw.push(...input.split(/[,;]/));
  }

  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const normalized = entry.trim().toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    if (EMAIL_REGEX.test(normalized)) {
      emails.push(normalized);
    } else {
      invalid.push(normalized);
    }
  }

  return { emails, invalid };
};

let warnedAboutMissingRecipients = false;

/**
 * The coordinator addresses copied on referral notifications. Configured via
 * REFERRAL_NOTIFICATION_RECIPIENTS so changing who gets copied never needs a deploy.
 *
 * There is deliberately no baked-in fallback: a hardcoded address that quietly stops
 * accepting mail is what caused coordinator notifications to bounce in the first place.
 * An unset variable means no coordinator copy, which callers are expected to handle.
 */
export const getReferralNotificationRecipients = (): string[] => {
  const configured = parseCcRecipients(process.env.REFERRAL_NOTIFICATION_RECIPIENTS);

  if (configured.emails.length === 0 && !warnedAboutMissingRecipients) {
    warnedAboutMissingRecipients = true;
    console.warn(
      '[Email] REFERRAL_NOTIFICATION_RECIPIENTS is unset or has no valid addresses. Referral coordinator notifications will be skipped.'
    );
  }

  return configured.emails;
};

/**
 * Merges default CC addresses with admin-supplied extras, dropping duplicates and
 * the message's own recipient so nobody receives the same email twice.
 */
export const buildCcList = (
  defaults: string[],
  extras: string[],
  toAddress?: string | null
): string[] => {
  const excluded = typeof toAddress === 'string' ? toAddress.trim().toLowerCase() : '';
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const entry of [...defaults, ...extras]) {
    const normalized = entry.trim().toLowerCase();
    if (normalized.length === 0 || normalized === excluded || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
};
