import { describe, expect, it } from '@jest/globals';
import { groupReferralsForAgent } from '@/lib/referral-groups';

interface Row {
  id: string;
  needsUpdate?: boolean;
  daysInStatus?: number;
}

describe('groupReferralsForAgent', () => {
  it('puts Waiting on you before Moving along', () => {
    const groups = groupReferralsForAgent<Row>([
      { id: 'calm', needsUpdate: false, daysInStatus: 4 },
      { id: 'stale', needsUpdate: true, daysInStatus: 17 }
    ]);

    expect(groups.map((group) => group.id)).toEqual(['waiting-on-you', 'moving-along']);
    expect(groups[0].label).toBe('Waiting on you');
    expect(groups[1].label).toBe('Moving along');
    expect(groups[0].items.map((item) => item.id)).toEqual(['stale']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['calm']);
  });

  it('sorts each group by daysInStatus descending', () => {
    const groups = groupReferralsForAgent<Row>([
      { id: 'w-3', needsUpdate: true, daysInStatus: 3 },
      { id: 'm-1', needsUpdate: false, daysInStatus: 1 },
      { id: 'w-21', needsUpdate: true, daysInStatus: 21 },
      { id: 'm-9', needsUpdate: false, daysInStatus: 9 },
      { id: 'w-8', needsUpdate: true, daysInStatus: 8 }
    ]);

    expect(groups[0].items.map((item) => item.id)).toEqual(['w-21', 'w-8', 'w-3']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['m-9', 'm-1']);
  });

  it('treats a missing daysInStatus as zero and a missing needsUpdate as moving along', () => {
    const groups = groupReferralsForAgent<Row>([{ id: 'bare' }, { id: 'aged', daysInStatus: 5 }]);

    expect(groups[0].items).toHaveLength(0);
    expect(groups[1].items.map((item) => item.id)).toEqual(['aged', 'bare']);
  });

  it('does not mutate or reorder the caller array', () => {
    const rows: Row[] = [
      { id: 'a', needsUpdate: true, daysInStatus: 1 },
      { id: 'b', needsUpdate: true, daysInStatus: 30 }
    ];

    groupReferralsForAgent(rows);

    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('returns both groups, empty, for an empty list', () => {
    const groups = groupReferralsForAgent<Row>([]);

    expect(groups).toHaveLength(2);
    expect(groups[0].items).toEqual([]);
    expect(groups[1].items).toEqual([]);
  });
});
