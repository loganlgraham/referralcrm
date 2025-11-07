export const REFERRAL_STATUSES = [
  'New Lead',
  'In Communication',
  'Showing Homes',
  'Under Contract',
  'Closed'
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const DEFAULT_AGENT_COMMISSION_BPS = 300;
export const DEFAULT_REFERRAL_FEE_BPS = 2500;
