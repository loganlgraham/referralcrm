import { describe, expect, it } from '@jest/globals';

import {
  getPreviousPeriodRange,
  getReferralTimeframeAnchor,
  parseTimeframe
} from '@/lib/server/dashboard/timeframe';

describe('getReferralTimeframeAnchor', () => {
  it('uses the earlier of referralDate vs createdAt', () => {
    const anchor = getReferralTimeframeAnchor({
      createdAt: new Date('2026-03-01T12:00:00Z'),
      referralDate: new Date('2026-01-15T00:00:00Z')
    });
    expect(anchor?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('falls back to createdAt when referralDate is missing', () => {
    const anchor = getReferralTimeframeAnchor({
      createdAt: new Date('2026-02-01T00:00:00Z'),
      referralDate: null
    });
    expect(anchor?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('getPreviousPeriodRange week (M-2)', () => {
  it('ends immediately before the current week starts (rolling window, not full prior calendar week)', () => {
    const timeframe = parseTimeframe('week', null, null);
    expect(timeframe.start && timeframe.end).toBeTruthy();
    const prev = getPreviousPeriodRange(timeframe);
    expect(prev).not.toBeNull();
    if (!prev || !timeframe.start) return;
    expect(prev.end.getTime()).toBeLessThan(timeframe.start.getTime());
  });
});
