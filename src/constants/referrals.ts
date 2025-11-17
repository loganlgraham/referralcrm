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

export const DEFAULT_AGENT_COMMISSION_BPS = 300;
export const DEFAULT_REFERRAL_FEE_BPS = 2500;
