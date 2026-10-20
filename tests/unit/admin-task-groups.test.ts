import { describe, expect, it } from '@jest/globals';

import { deriveSimilarTaskGroup, groupNoOpenTaskReferrals } from '@/lib/admin-task-groups';

interface Row {
  id: string;
  status: string;
  agentName: string | null;
  lastTaskTitle: string | null;
  lastActivityAt: string | null;
}

function row(partial: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    status: 'New Lead',
    agentName: 'Ada Agent',
    lastTaskTitle: null,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('deriveSimilarTaskGroup', () => {
  it('clusters titles that share the same leading words', () => {
    expect(deriveSimilarTaskGroup('Follow up with agent')).toEqual(
      deriveSimilarTaskGroup('Follow up with the agent')
    );
  });
});

describe('groupNoOpenTaskReferrals', () => {
  const referrals = [
    row({
      id: '1',
      agentName: 'Zoe Agent',
      status: 'Under Contract',
      lastTaskTitle: 'Follow up with agent',
      lastActivityAt: '2026-03-01T00:00:00.000Z',
    }),
    row({
      id: '2',
      agentName: null,
      status: 'New Lead',
      lastTaskTitle: null,
      lastActivityAt: '2026-04-01T00:00:00.000Z',
    }),
    row({
      id: '3',
      agentName: 'Ada Agent',
      status: 'Paired',
      lastTaskTitle: 'Follow up with the agent',
      lastActivityAt: '2026-02-01T00:00:00.000Z',
    }),
    row({
      id: '4',
      agentName: 'Ada Agent',
      status: 'Showing Homes',
      lastTaskTitle: 'Email borrower',
      lastActivityAt: '2026-05-01T00:00:00.000Z',
    }),
  ];

  it('groups by agent with unassigned last and newest activity first', () => {
    const groups = groupNoOpenTaskReferrals(referrals, 'agent');
    expect(groups.map((group) => group.groupLabel)).toEqual([
      'Ada Agent',
      'Zoe Agent',
      'Unassigned Agent',
    ]);
    expect(groups[0]?.referrals.map((referral) => referral.id)).toEqual(['4', '3']);
  });

  it('groups by pipeline stage and folds Showing Homes into Active Lead', () => {
    const groups = groupNoOpenTaskReferrals(referrals, 'stage');
    expect(groups.map((group) => group.groupLabel)).toEqual([
      'New Lead',
      'Paired',
      'Active Lead',
      'Under Contract',
    ]);
  });

  it('clusters similar completed tasks and buckets referrals with no previous task', () => {
    const groups = groupNoOpenTaskReferrals(referrals, 'similar');
    const followUp = groups.find((group) => group.groupLabel === 'Follow Up Agent');
    const none = groups.find((group) => group.groupLabel === 'No previous task');
    expect(followUp?.referrals.map((referral) => referral.id)).toEqual(['1', '3']);
    expect(none?.referrals.map((referral) => referral.id)).toEqual(['2']);
    expect(groups[0]?.referrals.length).toBeGreaterThanOrEqual(groups.at(-1)?.referrals.length ?? 0);
  });
});
