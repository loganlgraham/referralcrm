import { buildDealStatusMap, isAgentAttributedDeal } from '@/lib/server/referral-deal-status';
import {
  mapDealStatusToReferralStatus,
  mapReferralStatusToDealStatus,
} from '@/lib/server/referral-deal-status-mapper';

describe('referral deal status mapping', () => {
  it('treats only used-assigned-agent deals as agent-attributed', () => {
    expect(
      isAgentAttributedDeal({
        referralId: 'ref-1',
        status: 'under_contract',
        usedAssignedAgent: true,
        agentAttribution: 'AHA',
      })
    ).toBe(true);

    expect(
      isAgentAttributedDeal({
        referralId: 'ref-1',
        status: 'under_contract',
        usedAssignedAgent: false,
        agentAttribution: null,
      })
    ).toBe(false);

    expect(
      isAgentAttributedDeal({
        referralId: 'ref-1',
        status: 'under_contract',
        usedAssignedAgent: true,
        agentAttribution: 'OUTSIDE_AGENT',
      })
    ).toBe(false);
  });

  it('ignores outside-agent deals when building referral deal stage map', () => {
    const map = buildDealStatusMap([
      {
        referralId: 'ref-outside',
        status: 'under_contract',
        usedAssignedAgent: false,
        agentAttribution: 'OUTSIDE_AGENT',
      },
      {
        referralId: 'ref-attributed',
        status: 'under_contract',
        usedAssignedAgent: true,
        agentAttribution: 'AHA',
      },
    ]);

    expect(map.has('ref-outside')).toBe(false);
    expect(map.get('ref-attributed')).toEqual({
      primary: 'under_contract',
      fallback: 'under_contract',
    });
  });

  it('maps referral statuses to synced deal statuses', () => {
    expect(mapReferralStatusToDealStatus('Under Contract')).toBe('under_contract');
    expect(mapReferralStatusToDealStatus('Closed')).toBe('closed');
    expect(mapReferralStatusToDealStatus('Terminated')).toBe('terminated');
    expect(mapReferralStatusToDealStatus('Active Lead')).toBeNull();
  });

  it('maps deal pipeline statuses back to referral statuses', () => {
    expect(mapDealStatusToReferralStatus('under_contract')).toBe('Under Contract');
    expect(mapDealStatusToReferralStatus('past_inspection')).toBe('Under Contract');
    expect(mapDealStatusToReferralStatus('clear_to_close')).toBe('Under Contract');
    expect(mapDealStatusToReferralStatus('closed')).toBe('Closed');
    expect(mapDealStatusToReferralStatus('payment_sent')).toBe('Closed');
    expect(mapDealStatusToReferralStatus('paid')).toBe('Closed');
    expect(mapDealStatusToReferralStatus('terminated')).toBe('Terminated');
  });
});
