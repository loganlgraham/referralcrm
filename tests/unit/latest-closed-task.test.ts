import { describe, expect, it } from '@jest/globals';

import { pickLatestClosedTaskTitles } from '@/lib/latest-closed-task';

describe('pickLatestClosedTaskTitles', () => {
  it('uses a newer dismissed task instead of an older completed task', () => {
    const titles = pickLatestClosedTaskTitles([
      {
        referralId: 'ref-1',
        title: 'Call the borrower',
        status: 'completed',
        completedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        referralId: 'ref-1',
        title: 'Intro email',
        status: 'dismissed',
        dismissedAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    expect(titles.get('ref-1')).toBe('Intro email');
  });

  it('keeps a dismissed title when that is the only closed task', () => {
    const titles = pickLatestClosedTaskTitles([
      {
        referralId: 'ref-2',
        title: 'Assign agent',
        status: 'dismissed',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        referralId: 'ref-2',
        title: 'Still open',
        status: 'open',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ]);

    expect(titles.get('ref-2')).toBe('Assign agent');
  });

  it('returns null when the latest closed task has a blank title', () => {
    const titles = pickLatestClosedTaskTitles([
      {
        referralId: 'ref-3',
        title: '   ',
        status: 'completed',
        completedAt: '2026-04-01T00:00:00.000Z',
      },
    ]);

    expect(titles.get('ref-3')).toBeNull();
  });
});
