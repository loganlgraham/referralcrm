export const REFERRAL_STATUSES = [
  'New Lead',
  'Paired',
  'In Communication',
  'Active Lead',
  'Under Contract',
  'Closed',
  'Lost',
  'Terminated'
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_VALUES = [...REFERRAL_STATUSES, 'Showing Homes'] as const;

export const ACTIVE_REFERRAL_STATUSES = [
  'Paired',
  'In Communication',
  'Active Lead',
  'Under Contract'
] as const;

export const ACTIVE_REFERRAL_STATUS_VALUES = [...ACTIVE_REFERRAL_STATUSES, 'Showing Homes'] as const;

export function normalizeReferralStatus(status?: string | null): ReferralStatus | null {
  if (!status) {
    return null;
  }
  if (status === 'Showing Homes') {
    return 'Active Lead';
  }
  return REFERRAL_STATUSES.includes(status as ReferralStatus) ? (status as ReferralStatus) : null;
}

/**
 * Display label for a referral status. Agent-created referrals share the same
 * pipeline names; origin is shown separately (Via agent). The unused options
 * argument is kept so existing call sites do not need a rewrite.
 */
export function getReferralStatusLabel(
  status: string,
  _options?: { isAgentOrigin?: boolean }
): string {
  return normalizeReferralStatus(status) ?? status;
}

export const LOST_REASON_VALUES = [
  'never_connected',
  'already_had_agent',
  'chose_other_agent_precontact',
  'not_qualified',
  'no_longer_buying',
  'out_of_area',
  'already_transacted',
  'duplicate_or_invalid',
  'chose_other_agent_postcontact',
  'unresponsive_after_contact',
  'service_issue',
  'other'
] as const;

export type LostReason = (typeof LOST_REASON_VALUES)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  never_connected: 'Never able to reach the borrower',
  already_had_agent: 'Already working with someone else',
  chose_other_agent_precontact: 'Went with someone else before we connected',
  not_qualified: 'Not qualified to buy',
  no_longer_buying: 'No longer buying / timeline changed',
  out_of_area: 'Looking outside our area',
  already_transacted: 'Already bought or sold',
  duplicate_or_invalid: 'Duplicate or bad contact info',
  chose_other_agent_postcontact: 'Went with someone else after we connected',
  unresponsive_after_contact: 'Went quiet after we connected',
  service_issue: 'Service or responsiveness issue',
  other: 'Other'
};

/**
 * Whether a loss for this reason counts against the assigned agent. The policy
 * lives here rather than on the referral document so it can be retuned without a
 * migration and without rewriting history.
 */
export const LOST_REASON_COUNTS_AGAINST_AGENT: Record<LostReason, boolean> = {
  never_connected: false,
  already_had_agent: false,
  chose_other_agent_precontact: false,
  not_qualified: false,
  no_longer_buying: false,
  out_of_area: false,
  already_transacted: false,
  duplicate_or_invalid: false,
  chose_other_agent_postcontact: true,
  unresponsive_after_contact: true,
  service_issue: true,
  other: true
};

/** Pre-contact reasons first: the common case when a referral is lost early. */
export const LOST_REASON_OPTIONS: { value: LostReason; label: string }[] = LOST_REASON_VALUES.map(
  (value) => ({ value, label: LOST_REASON_LABELS[value] })
);

/**
 * One shared list for every origin. The unused options argument is kept so
 * existing call sites do not need a rewrite.
 */
export function getLostReasonOptions(_options?: {
  isAgentOrigin?: boolean;
}): { value: LostReason; label: string }[] {
  return LOST_REASON_OPTIONS;
}

export const LOST_REASON_SOURCE_VALUES = ['reported', 'inferred'] as const;

export type LostReasonSource = (typeof LOST_REASON_SOURCE_VALUES)[number];

export function normalizeLostReason(reason?: string | null): LostReason | null {
  if (!reason) {
    return null;
  }
  return LOST_REASON_VALUES.includes(reason as LostReason) ? (reason as LostReason) : null;
}

export const DEFAULT_AGENT_COMMISSION_BPS = 300;
export const DEFAULT_REFERRAL_FEE_BPS = 2500;

export const REFERRAL_TIMELINE_VALUES = [
  'asap',
  '1-3_months',
  '3-6_months',
  '6-12_months',
  '12+_months',
  'not_specified'
] as const;

export type ReferralTimeline = (typeof REFERRAL_TIMELINE_VALUES)[number];

export const REFERRAL_TIMELINE_OPTIONS: { value: ReferralTimeline; label: string }[] = [
  { value: 'asap', label: 'ASAP / Ready to purchase' },
  { value: '1-3_months', label: '1-3 months' },
  { value: '3-6_months', label: '3-6 months' },
  { value: '6-12_months', label: '6-12 months' },
  { value: '12+_months', label: '12+ months / Just browsing' },
  { value: 'not_specified', label: 'Not specified' }
];
