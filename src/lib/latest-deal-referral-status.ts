import type { DealStatus } from '@/constants/deals';
import type { ReferralStatus } from '@/constants/referrals';

type DealSnapshot = {
  status?: string | null;
  side?: 'buy' | 'sell' | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type LatestDealReferralStatuses = {
  overall: ReferralStatus | null;
  buy: ReferralStatus | null;
  sell: ReferralStatus | null;
};

const toTimestamp = (deal: DealSnapshot): number => {
  const createdAt = deal.createdAt ? new Date(deal.createdAt).getTime() : Number.NaN;
  if (!Number.isNaN(createdAt)) {
    return createdAt;
  }
  const updatedAt = deal.updatedAt ? new Date(deal.updatedAt).getTime() : Number.NaN;
  if (!Number.isNaN(updatedAt)) {
    return updatedAt;
  }
  return 0;
};

export const mapDealStatusToReferralStatusDisplay = (
  status?: string | null
): ReferralStatus | null => {
  switch (status as DealStatus | null | undefined) {
    case 'under_contract':
    case 'past_inspection':
    case 'past_appraisal':
    case 'clear_to_close':
      return 'Under Contract';
    case 'closed':
    case 'payment_sent':
    case 'paid':
      return 'Closed';
    case 'terminated':
      return 'Terminated';
    default:
      return null;
  }
};

type DatedStatus = {
  status: ReferralStatus;
  createdAtMs: number;
};

const pickLatestStatus = (
  existing: DatedStatus | null,
  candidate: DatedStatus
): DatedStatus => {
  if (!existing) {
    return candidate;
  }
  return candidate.createdAtMs >= existing.createdAtMs ? candidate : existing;
};

export const getLatestDealReferralStatuses = (
  deals: DealSnapshot[] | null | undefined
): LatestDealReferralStatuses => {
  if (!Array.isArray(deals) || deals.length === 0) {
    return { overall: null, buy: null, sell: null };
  }

  let overall: DatedStatus | null = null;
  let buy: DatedStatus | null = null;
  let sell: DatedStatus | null = null;

  for (const deal of deals) {
    const mappedStatus = mapDealStatusToReferralStatusDisplay(deal.status);
    if (!mappedStatus) {
      continue;
    }

    const candidate: DatedStatus = {
      status: mappedStatus,
      createdAtMs: toTimestamp(deal),
    };
    overall = pickLatestStatus(overall, candidate);
    if (deal.side === 'buy') {
      buy = pickLatestStatus(buy, candidate);
    } else if (deal.side === 'sell') {
      sell = pickLatestStatus(sell, candidate);
    }
  }

  return {
    overall: overall?.status ?? null,
    buy: buy?.status ?? null,
    sell: sell?.status ?? null,
  };
};
