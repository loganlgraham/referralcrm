export const REFERRAL_STATUSES = [
  'New',
  'Contacted',
  'PWC',
  'Showing',
  'UC',
  'Closed',
  'Lost'
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
