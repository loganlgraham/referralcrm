import {
  getLatestDealReferralStatuses,
  mapDealStatusToReferralStatusDisplay,
} from '@/lib/latest-deal-referral-status';

describe('latest deal referral status mapping', () => {
  it('maps deal statuses to referral display statuses', () => {
    expect(mapDealStatusToReferralStatusDisplay('under_contract')).toBe('Under Contract');
    expect(mapDealStatusToReferralStatusDisplay('payment_sent')).toBe('Closed');
    expect(mapDealStatusToReferralStatusDisplay('terminated')).toBe('Terminated');
    expect(mapDealStatusToReferralStatusDisplay('not_a_status')).toBeNull();
    expect(mapDealStatusToReferralStatusDisplay(null)).toBeNull();
  });

  it('uses the newest created deal for overall status', () => {
    const result = getLatestDealReferralStatuses([
      {
        status: 'under_contract',
        side: 'buy',
        createdAt: '2026-03-01T10:00:00.000Z',
      },
      {
        status: 'terminated',
        side: 'sell',
        createdAt: '2026-03-05T10:00:00.000Z',
      },
      {
        status: 'closed',
        side: 'buy',
        createdAt: '2026-03-09T10:00:00.000Z',
      },
    ]);

    expect(result).toEqual({
      overall: 'Closed',
      buy: 'Closed',
      sell: 'Terminated',
    });
  });

  it('falls back to updatedAt when createdAt is missing', () => {
    const result = getLatestDealReferralStatuses([
      {
        status: 'under_contract',
        side: 'buy',
        updatedAt: '2026-03-04T10:00:00.000Z',
      },
      {
        status: 'closed',
        side: 'buy',
        updatedAt: '2026-03-07T10:00:00.000Z',
      },
    ]);

    expect(result).toEqual({
      overall: 'Closed',
      buy: 'Closed',
      sell: null,
    });
  });
});
