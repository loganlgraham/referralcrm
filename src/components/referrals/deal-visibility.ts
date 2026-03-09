import type { ReferralPayment } from '@/types/referral-payment';

const isOutsideAgentDeal = (deal: ReferralPayment): boolean =>
  deal.usedAssignedAgent === false || deal.agentAttribution === 'OUTSIDE_AGENT';

export const getReferralDealsVisibility = (deals: ReferralPayment[], viewerRole: string) => {
  if (viewerRole !== 'agent') {
    return {
      visibleDeals: deals,
      hiddenOutsideAgentCount: 0,
    };
  }

  const visibleDeals = deals.filter((deal) => !isOutsideAgentDeal(deal));
  return {
    visibleDeals,
    hiddenOutsideAgentCount: Math.max(deals.length - visibleDeals.length, 0),
  };
};
