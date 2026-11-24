import { referralWorkflowRoute, routingAgent } from '@/lib/referral-routing';

const local = { ahaDesignation: 'AHA' };
const oos = { ahaDesignation: 'AHA_OOS' };

describe('referral workflow routing', () => {
  it('keeps the import mailbox when the assigned agent is from another network', () => {
    expect(referralWorkflowRoute({ inboundEmail: { channel: 'AHA_OOS' }, ahaBucket: 'AHA', buySideAgent: local })).toBe('AHA_OOS');
    expect(referralWorkflowRoute({ inboundEmail: { channel: 'AHA' }, assignedAgent: oos })).toBe('AHA');
    expect(referralWorkflowRoute({ inboundEmail: { routeHint: 'ahaoos' } })).toBe('AHA_OOS');
  });

  it('routes a manually entered file using its current assignment, including old AFC-coded files', () => {
    expect(referralWorkflowRoute({ origin: 'admin', ahaBucket: null, buySideAgent: local })).toBe('AHA');
    expect(referralWorkflowRoute({ origin: 'mc', ahaBucket: 'AHA', assignedAgent: oos })).toBe('AHA_OOS');
    expect(referralWorkflowRoute({ origin: 'admin', ahaBucket: 'AHA' })).toBeNull();
    expect(referralWorkflowRoute({ assignedAgent: { ahaDesignation: 'AGIT' } })).toBeNull();
  });

  it('respects the assigned side and keeps agent-to-lender introductions separate', () => {
    expect(routingAgent({ clientType: 'Seller', sellSideAgent: oos, assignedAgent: local })).toBe(oos);
    expect(routingAgent({ clientType: 'Both', buySideAgent: local, sellSideAgent: oos })).toBe(local);
    expect(routingAgent({ clientType: 'Both', assignedAgent: oos, sellSideAgent: oos })).toBeNull();
    expect(referralWorkflowRoute({ origin: 'agent', buySideAgent: local })).toBeNull();
  });
});
