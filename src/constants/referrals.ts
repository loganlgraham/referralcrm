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
