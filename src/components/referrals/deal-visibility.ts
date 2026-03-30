import type { ReferralPayment } from '@/types/referral-payment';

const isOutsideAgentDeal = (deal: ReferralPayment): boolean =>
  deal.usedAssignedAgent === false || deal.agentAttribution === 'OUTSIDE_AGENT';

const isCrossSidePaymentStatusDeal = (
  deal: ReferralPayment,
  viewerAssignedSide?: 'buy' | 'sell' | null
): boolean => {
  if (!viewerAssignedSide || (deal.side !== 'buy' && deal.side !== 'sell')) {
    return false;
  }

  if (deal.side === viewerAssignedSide) {
    return false;
  }

  return deal.status === 'payment_sent' || deal.status === 'paid';
};

const maskCrossSidePaymentStatus = (
  deal: ReferralPayment,
  viewerAssignedSide?: 'buy' | 'sell' | null
): ReferralPayment => {
  if (!isCrossSidePaymentStatusDeal(deal, viewerAssignedSide)) {
    return deal;
  }

  return {
    ...deal,
    status: 'closed',
  };
};

export const getReferralDealsVisibility = (
  deals: ReferralPayment[],
  viewerRole: string,
  viewerAssignedSide?: 'buy' | 'sell' | null
) => {
  if (viewerRole !== 'agent') {
    return {
      visibleDeals: deals,
      hiddenOutsideAgentCount: 0,
    };
  }

  const visibleDeals = deals
    .filter((deal) => !isOutsideAgentDeal(deal))
    .map((deal) => maskCrossSidePaymentStatus(deal, viewerAssignedSide));
  return {
    visibleDeals,
    hiddenOutsideAgentCount: deals.filter((deal) => isOutsideAgentDeal(deal)).length,
  };
};
