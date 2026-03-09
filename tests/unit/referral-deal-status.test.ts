import { buildDealStatusMap, isAgentAttributedDeal } from '@/lib/server/referral-deal-status';

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
});
