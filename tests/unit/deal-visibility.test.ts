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

  it('masks other-side payment sent/received deals as closed for assigned-side agents', () => {
    const sideDeals: ReferralPayment[] = [
      { _id: 'buy-1', side: 'buy', status: 'under_contract', usedAssignedAgent: true },
      { _id: 'sell-1', side: 'sell', status: 'closed', usedAssignedAgent: true },
      { _id: 'sell-2', side: 'sell', status: 'payment_sent', usedAssignedAgent: true },
      { _id: 'sell-3', side: 'sell', status: 'paid', usedAssignedAgent: true },
    ];

    const result = getReferralDealsVisibility(sideDeals, 'agent', 'buy');

    expect(result.visibleDeals.map((deal) => deal._id)).toEqual([
      'buy-1',
      'sell-1',
      'sell-2',
      'sell-3',
    ]);
    expect(result.visibleDeals.find((deal) => deal._id === 'sell-2')?.status).toBe('closed');
    expect(result.visibleDeals.find((deal) => deal._id === 'sell-3')?.status).toBe('closed');
    expect(result.hiddenOutsideAgentCount).toBe(0);
  });
});
