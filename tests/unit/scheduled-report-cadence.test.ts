import { describe, expect, it } from '@jest/globals';
import { formatInTimeZone } from 'date-fns-tz';

import { computeNextRunAt } from '@/models/scheduled-report';

const MT = 'America/Denver';

describe('computeNextRunAt', () => {
  it('daily cadence advances to the next 7am MT', () => {
    const from = new Date('2026-04-13T17:00:00Z'); // 11am MT
    const next = computeNextRunAt('daily', from);
    expect(formatInTimeZone(next, MT, 'yyyy-MM-dd HH:mm')).toBe('2026-04-14 07:00');
  });

  it('daily cadence stays same day when before 7am MT', () => {
    const from = new Date('2026-04-13T05:00:00Z'); // 11pm MT prior day = Apr 12
    const next = computeNextRunAt('daily', from);
    // Next 7am MT after Apr 12 11pm is Apr 13 07:00 MT
    expect(formatInTimeZone(next, MT, 'yyyy-MM-dd HH:mm')).toBe('2026-04-13 07:00');
  });

  it('weekly cadence picks the next Monday 7am MT', () => {
    // 2026-04-15 is a Wednesday in MT
    const from = new Date('2026-04-15T18:00:00Z');
    const next = computeNextRunAt('weekly', from);
    // Next Monday is 2026-04-20
    expect(formatInTimeZone(next, MT, 'yyyy-MM-dd HH:mm EEE')).toBe('2026-04-20 07:00 Mon');
  });

  it('monthly cadence picks the next 1st 7am MT', () => {
    const from = new Date('2026-04-13T17:00:00Z');
    const next = computeNextRunAt('monthly', from);
    expect(formatInTimeZone(next, MT, 'yyyy-MM-dd HH:mm')).toBe('2026-05-01 07:00');
  });

  it('monthly cadence handles end-of-month correctly', () => {
    const from = new Date('2026-04-30T20:00:00Z');
    const next = computeNextRunAt('monthly', from);
    expect(formatInTimeZone(next, MT, 'yyyy-MM-dd HH:mm')).toBe('2026-05-01 07:00');
  });
});
