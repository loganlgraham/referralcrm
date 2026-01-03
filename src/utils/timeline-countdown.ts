import type { ReferralTimeline } from '@/constants/referrals';

/**
 * Calculates the target number of days from creation date for a given timeline value.
 * Returns the middle point of the range for ranges, or specific values for fixed timelines.
 */
function getTimelineTargetDays(timeline: ReferralTimeline): number | null {
  switch (timeline) {
    case 'asap':
      return 0;
    case '1-3_months':
      return 60; // Middle of 30-90 day range
    case '3-6_months':
      return 135; // Middle of 90-180 day range
    case '6-12_months':
      return 270; // Middle of 180-360 day range
    case '12+_months':
      return 540; // Using 18 months (540 days) as target for 12+ months
    case 'not_specified':
      return null;
    default:
      return null;
  }
}

/**
 * Calculates the number of days remaining until the timeline target date.
 * @param timeline - The timeline value from the referral
 * @param createdAt - ISO date string of when the referral was created
 * @returns Number of days remaining (negative if expired), or null if not applicable
 */
export function calculateTimelineDaysRemaining(
  timeline: ReferralTimeline | undefined | null,
  createdAt: string
): number | null {
  if (!timeline || timeline === 'not_specified') {
    return null;
  }

  const targetDays = getTimelineTargetDays(timeline);
  if (targetDays === null) {
    return null;
  }

  const createdDate = new Date(createdAt);
  const targetDate = new Date(createdDate);
  targetDate.setDate(targetDate.getDate() + targetDays);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Formats the timeline countdown for display.
 * @param daysRemaining - Number of days remaining (from calculateTimelineDaysRemaining)
 * @param timeline - The timeline value (for special cases like 'asap')
 * @returns Formatted string for display
 */
export function formatTimelineCountdown(
  daysRemaining: number | null,
  timeline: ReferralTimeline | undefined | null
): string {
  if (timeline === 'asap') {
    return 'ASAP';
  }

  if (daysRemaining === null) {
    return '—';
  }

  if (daysRemaining <= 0) {
    return 'Expired';
  }

  if (daysRemaining === 1) {
    return '1 day';
  }

  return `${daysRemaining} days`;
}
