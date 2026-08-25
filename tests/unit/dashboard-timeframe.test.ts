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

describe('parseTimeframe last_week / next_week / last_month', () => {
  it('last_week is the prior Monday–Sunday calendar week', () => {
    const last = parseTimeframe('last_week', null, null);
    const current = parseTimeframe('week', null, null);
    expect(last.start && last.end && current.start).toBeTruthy();
    if (!last.start || !last.end || !current.start) return;
    expect(last.end.getTime()).toBeLessThan(current.start.getTime());
    expect(last.start.getDay()).toBe(1);
    expect(last.label).toBe('Last Week');
  });

  it('next_week is the following Monday–Sunday calendar week', () => {
    const next = parseTimeframe('next_week', null, null);
    const current = parseTimeframe('week', null, null);
    expect(next.start && next.end && current.start).toBeTruthy();
    if (!next.start || !next.end || !current.start) return;
    expect(next.start.getTime()).toBeGreaterThan(current.start.getTime());
    expect(next.start.getDay()).toBe(1);
    expect(next.label).toBe('Next Week');
  });

  it('last_month is the previous calendar month', () => {
    const last = parseTimeframe('last_month', null, null);
    const current = parseTimeframe('month', null, null);
    expect(last.start && last.end && current.start).toBeTruthy();
    if (!last.start || !last.end || !current.start) return;
    expect(last.end.getTime()).toBeLessThan(current.start.getTime());
    expect(last.label).toBe('Last Month');
  });
});

describe('getPreviousPeriodRange last_week / next_week / last_month', () => {
  it('ends immediately before the selected window', () => {
    const keys = ['last_week', 'next_week', 'last_month'] as const;
    for (const key of keys) {
      const timeframe = parseTimeframe(key, null, null);
      const prev = getPreviousPeriodRange(timeframe);
      expect(prev).not.toBeNull();
      if (!prev || !timeframe.start) continue;
      expect(prev.end.getTime()).toBeLessThan(timeframe.start.getTime());
    }
  });
});
