export const REFERRAL_STATUSES = [
  'New Lead',
  'In Communication',
  'Showing Homes',
  'Under Contract',
  'Closed'
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
