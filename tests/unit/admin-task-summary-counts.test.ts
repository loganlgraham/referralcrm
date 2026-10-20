import { describe, expect, it } from '@jest/globals';

import {
  countSummaryTasks,
  openTaskReferralIdsMissingFrom,
  referralHasNoOpenTask,
} from '@/lib/admin-task-summary-counts';

describe('countSummaryTasks', () => {
  it('counts every open task when the network is all, including tasks whose referral is missing', () => {
    const counts = countSummaryTasks(
      'all',
      [
        { referralId: 'missing', bucket: 'overdue' },
        { referralId: 'aha', bucket: 'today' },
      ],
      new Map()
    );

    expect(counts).toEqual({ overdueCount: 1, dueTodayCount: 1 });
  });

  it('counts a filtered task when its referral was loaded, including a soft-deleted referral', () => {
    const counts = countSummaryTasks(
      'aha',
      [
        { referralId: 'deleted-aha', bucket: 'overdue' },
        { referralId: 'missing', bucket: 'overdue' },
        { referralId: 'agit', bucket: 'today' },
      ],
      new Map([
        ['deleted-aha', 'AHA'],
        ['agit', 'AGIT'],
      ])
    );

    expect(counts).toEqual({ overdueCount: 1, dueTodayCount: 0 });
  });
});

describe('openTaskReferralIdsMissingFrom', () => {
  it('returns open-task referrals that were not in the active set', () => {
    expect(
      openTaskReferralIdsMissingFrom(['active', 'deleted', 'active'], new Set(['active']))
    ).toEqual(['deleted']);
  });
});

describe('referralHasNoOpenTask', () => {
  it('includes an active referral with no open task and skips terminal statuses in any casing', () => {
    expect(referralHasNoOpenTask('Active Lead', false)).toBe(true);
    expect(referralHasNoOpenTask('Closed', false)).toBe(false);
    expect(referralHasNoOpenTask('lost', false)).toBe(false);
    expect(referralHasNoOpenTask('Active Lead', true)).toBe(false);
  });
});
