import { describe, expect, it } from '@jest/globals';

import { referralAgentSlotId } from '@/lib/referral-agent-slot';
import {
  parseTaskNetwork,
  referralMatchesTaskNetwork,
  taskNetworkDesignation,
  taskNetworkLabel,
} from '@/lib/task-network';

describe('parseTaskNetwork', () => {
  it('accepts aha, oos, and agit', () => {
    expect(parseTaskNetwork('aha')).toBe('aha');
    expect(parseTaskNetwork('oos')).toBe('oos');
    expect(parseTaskNetwork('agit')).toBe('agit');
  });

  it('treats missing and unknown values as all', () => {
    expect(parseTaskNetwork(null)).toBe('all');
    expect(parseTaskNetwork(undefined)).toBe('all');
    expect(parseTaskNetwork('')).toBe('all');
    expect(parseTaskNetwork('ALL')).toBe('all');
    expect(parseTaskNetwork('AHA')).toBe('all');
  });
});

describe('referralMatchesTaskNetwork', () => {
  it('includes every designation, including none, when the filter is all', () => {
    expect(referralMatchesTaskNetwork('AHA', 'all')).toBe(true);
    expect(referralMatchesTaskNetwork('AHA_OOS', 'all')).toBe(true);
    expect(referralMatchesTaskNetwork('AGIT', 'all')).toBe(true);
    expect(referralMatchesTaskNetwork(null, 'all')).toBe(true);
  });

  it('keeps only the selected network and drops undesignated referrals', () => {
    expect(taskNetworkDesignation('aha')).toBe('AHA');
    expect(taskNetworkDesignation('oos')).toBe('AHA_OOS');
    expect(taskNetworkDesignation('agit')).toBe('AGIT');
    expect(taskNetworkLabel('oos')).toBe('OOS');

    expect(referralMatchesTaskNetwork('AHA', 'aha')).toBe(true);
    expect(referralMatchesTaskNetwork('AHA_OOS', 'aha')).toBe(false);
    expect(referralMatchesTaskNetwork('AGIT', 'oos')).toBe(false);
    expect(referralMatchesTaskNetwork('AHA_OOS', 'oos')).toBe(true);
    expect(referralMatchesTaskNetwork('AGIT', 'agit')).toBe(true);
    expect(referralMatchesTaskNetwork(null, 'aha')).toBe(false);
    expect(referralMatchesTaskNetwork(null, 'oos')).toBe(false);
    expect(referralMatchesTaskNetwork(null, 'agit')).toBe(false);
  });
});

describe('referralAgentSlotId', () => {
  const id = '507f1f77bcf86cd799439011';

  it('reads an id from a hex string, an object id, or a populated agent', () => {
    expect(referralAgentSlotId(id)).toBe(id);
    expect(referralAgentSlotId({ toString: () => id })).toBe(id);
    expect(referralAgentSlotId({ _id: { toString: () => id }, name: 'Ada' })).toBe(id);
    const selfReferentialId = {
      toString: () => id,
      get _id() {
        return selfReferentialId;
      },
    };
    expect(referralAgentSlotId(selfReferentialId)).toBe(id);
    expect(referralAgentSlotId({ name: 'Ada' })).toBeNull();
    expect(referralAgentSlotId(null)).toBeNull();
  });
});
