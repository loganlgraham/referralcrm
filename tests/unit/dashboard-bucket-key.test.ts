import { describe, expect, it } from '@jest/globals';
import { deriveCustomBucketKey } from '@/lib/server/dashboard/timeframe';

describe('deriveCustomBucketKey', () => {
  it('maps 0- and 1-day ranges to hourly buckets', () => {
    expect(deriveCustomBucketKey(0)).toBe('day');
    expect(deriveCustomBucketKey(1)).toBe('day');
  });

  it('maps 2..7 day ranges to daily buckets (week)', () => {
    expect(deriveCustomBucketKey(2)).toBe('week');
    expect(deriveCustomBucketKey(7)).toBe('week');
  });

  it('maps 8..31 day ranges to weekly buckets (month)', () => {
    expect(deriveCustomBucketKey(8)).toBe('month');
    expect(deriveCustomBucketKey(31)).toBe('month');
  });

  it('maps 32..180 day ranges to weekly buckets (month)', () => {
    expect(deriveCustomBucketKey(32)).toBe('month');
    expect(deriveCustomBucketKey(180)).toBe('month');
  });

  it('maps > 180 day ranges to monthly buckets (year)', () => {
    expect(deriveCustomBucketKey(181)).toBe('year');
    expect(deriveCustomBucketKey(365)).toBe('year');
  });
});
