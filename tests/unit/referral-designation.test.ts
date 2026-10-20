import { describe, expect, it } from '@jest/globals';
import { Types } from 'mongoose';
import {
  getPaymentAgentDesignation,
  getReferralDesignation,
} from '@/lib/server/referral-designation';
import type { NetworkDesignation } from '@/lib/server/referral-designation';

function oid(hex: string) {
  return new Types.ObjectId(hex.padStart(24, '0'));
}

describe('getReferralDesignation', () => {
  const aAssigned = oid('1');
  const aBuy = oid('2');
  const aSell = oid('3');
  const map = new Map<string, NetworkDesignation | null>([
    [aAssigned.toString(), 'AHA'],
    [aBuy.toString(), 'AHA_OOS'],
    [aSell.toString(), 'AGIT'],
  ]);

  it('prefers assignedAgent designation', () => {
    expect(
      getReferralDesignation(
        { assignedAgent: aAssigned, buySideAgent: aBuy, sellSideAgent: aSell },
        map
      )
    ).toBe('AHA');
  });

  it('falls back to buySideAgent when assignedAgent missing/undesignated', () => {
    expect(
      getReferralDesignation(
        { assignedAgent: null, buySideAgent: aBuy, sellSideAgent: aSell },
        map
      )
    ).toBe('AHA_OOS');
  });

  it('falls back to sellSideAgent if neither prior slot is designated', () => {
    expect(
      getReferralDesignation(
        { assignedAgent: null, buySideAgent: null, sellSideAgent: aSell },
        map
      )
    ).toBe('AGIT');
  });

  it('returns null when no agent has a designation', () => {
    expect(
      getReferralDesignation(
        { assignedAgent: oid('deadbeef'), buySideAgent: null, sellSideAgent: null },
        map
      )
    ).toBeNull();
  });

  it('skips agents with a null value and continues traversal', () => {
    const nullingMap = new Map<string, NetworkDesignation | null>([
      [aAssigned.toString(), null],
      [aBuy.toString(), 'AHA_OOS'],
    ]);
    expect(
      getReferralDesignation(
        { assignedAgent: aAssigned, buySideAgent: aBuy, sellSideAgent: null },
        nullingMap
      )
    ).toBe('AHA_OOS');
  });

  it('falls back to ahaBucket=AHA_OOS when no agent is designated', () => {
    expect(
      getReferralDesignation(
        {
          assignedAgent: null,
          buySideAgent: null,
          sellSideAgent: null,
          ahaBucket: 'AHA_OOS',
          org: 'AHA',
        },
        map
      )
    ).toBe('AHA_OOS');
  });

  it('falls back to ahaBucket=AHA when no agent is designated', () => {
    expect(
      getReferralDesignation(
        { assignedAgent: null, ahaBucket: 'AHA' },
        map
      )
    ).toBe('AHA');
  });

  it('falls back to org=AHA when no agent and no ahaBucket', () => {
    expect(
      getReferralDesignation(
        { assignedAgent: null, org: 'AHA' },
        map
      )
    ).toBe('AHA');
  });

  it('prefers agent designation over stale ahaBucket', () => {
    expect(
      getReferralDesignation(
        {
          assignedAgent: aAssigned,
          ahaBucket: 'AHA_OOS',
          org: 'AHA',
        },
        map
      )
    ).toBe('AHA');
  });

  it('prefers ahaBucket=AHA_OOS over org=AHA when no agent', () => {
    expect(
      getReferralDesignation(
        { ahaBucket: 'AHA_OOS', org: 'AHA' },
        map
      )
    ).toBe('AHA_OOS');
  });
});

describe('getPaymentAgentDesignation', () => {
  const a1 = oid('1');
  const a2 = oid('2');
  const map = new Map<string, NetworkDesignation | null>([
    [a1.toString(), 'AHA'],
    [a2.toString(), 'AGIT'],
  ]);

  it('prefers payment.agentId over referral.assignedAgent', () => {
    expect(
      getPaymentAgentDesignation({ agentId: a2, referral: { assignedAgent: a1 } }, map)
    ).toBe('AGIT');
  });

  it('falls back to referral.assignedAgent when no payment agentId', () => {
    expect(getPaymentAgentDesignation({ referral: { assignedAgent: a1 } }, map)).toBe('AHA');
  });

  it('returns null when neither slot resolves', () => {
    expect(getPaymentAgentDesignation({ referral: { assignedAgent: null } }, map)).toBeNull();
  });
});
