import {
  DEAL_STATUS_LABELS,
  DEAL_STATUS_VALUES,
  type DealStatus,
} from '@/constants/deals';
import { REFERRAL_TIMELINE_OPTIONS } from '@/constants/referrals';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Human-readable label for a deal status slug, or the original string if unknown. */
export function dealStatusToDisplay(status: string | null | undefined): string {
  if (status == null || status === '') {
    return 'Unknown';
  }
  return DEAL_STATUS_LABELS[status as DealStatus] ?? status;
}

/**
 * Replaces known internal slugs (deal status, referral timeline) in notification copy
 * with user-facing labels. Idempotent for strings that already use display labels.
 */
export function formatNotificationContent(content: string): string {
  const tokenPairs: { token: string; label: string }[] = [
    ...DEAL_STATUS_VALUES.map((value) => ({
      token: value,
      label: DEAL_STATUS_LABELS[value],
    })),
    ...REFERRAL_TIMELINE_OPTIONS.map(({ value, label }) => ({ token: value, label })),
  ].sort((a, b) => b.token.length - a.token.length);

  let result = content;
  for (const { token, label } of tokenPairs) {
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g');
    result = result.replace(re, label);
  }

  return result;
}
