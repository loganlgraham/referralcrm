import { ReferralDocument, ReferralStatus } from '@/models/referral';
import { differenceInCalendarDays } from 'date-fns';

export function calculateReferralFeeDue(closedPriceCents: number, commissionBasisPoints: number, referralFeeBasisPoints?: number) {
  const commission = Math.round((closedPriceCents * commissionBasisPoints) / 10000);
  if (referralFeeBasisPoints !== undefined && referralFeeBasisPoints !== null && referralFeeBasisPoints > 0) {
    return Math.round((commission * referralFeeBasisPoints) / 10000);
  }
  const tier = closedPriceCents <= 400_000_00 ? 2500 : 3500;
  return Math.round((commission * tier) / 10000);
}

export function daysInStatus(referral: Pick<ReferralDocument, 'statusLastUpdated'>) {
  return differenceInCalendarDays(new Date(), referral.statusLastUpdated ?? new Date());
}

export function nextStatuses(status: ReferralStatus | 'Showing Homes'): ReferralStatus[] {
  const normalizedStatus = status === 'Showing Homes' ? 'Active Lead' : status;
  const pipeline: ReferralStatus[] = [
    'New Lead',
    'Paired',
    'In Communication',
    'Active Lead',
    'Under Contract',
    'Closed',
    'Lost',
    'Terminated'
  ];
  const currentIndex = pipeline.indexOf(normalizedStatus);
  if (currentIndex === -1) return pipeline;
  return pipeline.slice(currentIndex);
}
