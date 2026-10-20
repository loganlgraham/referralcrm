import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { ReferralDocument, ReferralStatus } from '@/models/referral';
import { differenceInCalendarDays } from 'date-fns';

const REFERRAL_FEE_TIER_THRESHOLD_CENTS = 400_000_00;
const REFERRAL_FEE_TIER_LOW_BPS = 2500;
const REFERRAL_FEE_TIER_HIGH_BPS = 3500;

/** Settings default: 25% at or below $400k, 35% above $400k. */
export function defaultReferralFeeBasisPoints(priceCents: number): number {
  return priceCents <= REFERRAL_FEE_TIER_THRESHOLD_CENTS
    ? REFERRAL_FEE_TIER_LOW_BPS
    : REFERRAL_FEE_TIER_HIGH_BPS;
}

export function calculateReferralFeeDue(
  closedPriceCents: number,
  commissionBasisPoints: number,
  referralFeeBasisPoints?: number | null
) {
  const commission = Math.round((closedPriceCents * commissionBasisPoints) / 10000);
  if (referralFeeBasisPoints === 0) {
    return 0;
  }
  if (referralFeeBasisPoints !== undefined && referralFeeBasisPoints !== null && referralFeeBasisPoints > 0) {
    return Math.round((commission * referralFeeBasisPoints) / 10000);
  }
  return Math.round((commission * defaultReferralFeeBasisPoints(closedPriceCents)) / 10000);
}

/** Stored override if set; otherwise the $400k tier. Explicit 0 stays 0. */
export function resolveDealReferralFeeBasisPoints(
  contractPriceCents?: number | null,
  storedBasisPoints?: number | null
): number | null {
  if (storedBasisPoints === 0) {
    return 0;
  }
  if (storedBasisPoints != null && storedBasisPoints > 0) {
    return storedBasisPoints;
  }
  if (typeof contractPriceCents === 'number' && contractPriceCents > 0) {
    return defaultReferralFeeBasisPoints(contractPriceCents);
  }
  return null;
}

function isSettledOrDeadDeal(status?: string | null): boolean {
  return status === 'terminated' || status === 'paid' || status === 'payment_sent';
}

/** Remaining unpaid expected for the agent Deals table. */
export function resolveAgentDealExpectedCents(input: {
  status?: string | null;
  expectedAmountCents?: number | null;
  referralFeeBasisPoints?: number | null;
  contractPriceCents?: number | null;
  commissionBasisPoints?: number | null;
  commissionFlatFeeCents?: number | null;
  netReferralFeePaidCents?: number | null;
  receivedAmountCents?: number | null;
}): number {
  const paid = input.netReferralFeePaidCents ?? input.receivedAmountCents ?? 0;
  const storedExpected = input.expectedAmountCents ?? 0;

  if (isSettledOrDeadDeal(input.status) || storedExpected > 0 || input.referralFeeBasisPoints != null) {
    return Math.max(storedExpected - paid, 0);
  }

  const contractPriceCents = input.contractPriceCents ?? 0;
  if (contractPriceCents <= 0) {
    return Math.max(storedExpected - paid, 0);
  }

  if (input.commissionFlatFeeCents && input.commissionFlatFeeCents > 0) {
    const bps = defaultReferralFeeBasisPoints(contractPriceCents);
    return Math.max(Math.round((input.commissionFlatFeeCents * bps) / 10_000) - paid, 0);
  }

  const commissionBps = input.commissionBasisPoints ?? DEFAULT_AGENT_COMMISSION_BPS;
  return Math.max(calculateReferralFeeDue(contractPriceCents, commissionBps) - paid, 0);
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
