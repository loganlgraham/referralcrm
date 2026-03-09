import { getReferralDealsVisibility } from '@/components/referrals/deal-visibility';
import type { ReferralPayment } from '@/types/referral-payment';

describe('getReferralDealsVisibility', () => {
  const deals: ReferralPayment[] = [
    { _id: '1', usedAssignedAgent: true, agentAttribution: 'AHA' },
    { _id: '2', usedAssignedAgent: false, agentAttribution: null },
    { _id: '3', usedAssignedAgent: true, agentAttribution: 'OUTSIDE_AGENT' },
  ];

  it('hides outside-agent deals for agent viewers', () => {
    const result = getReferralDealsVisibility(deals, 'agent');

    expect(result.visibleDeals.map((deal) => deal._id)).toEqual(['1']);
    expect(result.hiddenOutsideAgentCount).toBe(2);
  });

  it('shows all deals for non-agent viewers', () => {
    const result = getReferralDealsVisibility(deals, 'admin');

    expect(result.visibleDeals.map((deal) => deal._id)).toEqual(['1', '2', '3']);
    expect(result.hiddenOutsideAgentCount).toBe(0);
  });
});
