import {
  LOST_REASON_COUNTS_AGAINST_AGENT,
  type LostReason
} from '@/constants/referrals';

export interface LostAttributionInput {
  status?: string | null;
  lostReason?: string | null;
}

/**
 * Whether a Lost referral should count against its assigned agent.
 *
 * Unclassified losses (no reason, or a reason no longer in the taxonomy) count
 * against the agent so that a gap in reason capture can never quietly erase
 * history. Callers must pass a referral whose status is already resolved.
 */
export function isAttributableLoss(referral: LostAttributionInput): boolean {
  if (referral.status !== 'Lost') {
    return false;
  }
  const reason = referral.lostReason;
  if (!reason || !(reason in LOST_REASON_COUNTS_AGAINST_AGENT)) {
    return true;
  }
  return LOST_REASON_COUNTS_AGAINST_AGENT[reason as LostReason];
}

/**
 * Inverse of {@link isAttributableLoss}, limited to referrals that are actually
 * Lost. Used to report lead-quality losses separately from agent performance.
 */
export function isUnattributableLoss(referral: LostAttributionInput): boolean {
  return referral.status === 'Lost' && !isAttributableLoss(referral);
}
