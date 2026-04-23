import { describe, expect, it } from '@jest/globals';
import {
  clampPercent,
  computeCohortCloseRate,
  safePercent,
} from '@/lib/server/dashboard-math';

describe('computeCohortCloseRate', () => {
  it('returns 0 when cohort is empty', () => {
    expect(computeCohortCloseRate(3, 0)).toBe(0);
  });

  it('returns 0 when closed count is zero', () => {
    expect(computeCohortCloseRate(0, 10)).toBe(0);
  });

  it('returns percentage in [0, 100] for valid inputs', () => {
    expect(computeCohortCloseRate(2, 8)).toBe(25);
    expect(computeCohortCloseRate(7, 10)).toBe(70);
    expect(computeCohortCloseRate(10, 10)).toBe(100);
  });

  it('guards NaN / Infinity inputs', () => {
    expect(computeCohortCloseRate(Number.NaN, 5)).toBe(0);
    expect(computeCohortCloseRate(2, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('treats negative cohort and negative closed as zero', () => {
    expect(computeCohortCloseRate(-1, 10)).toBe(0);
    expect(computeCohortCloseRate(3, -2)).toBe(0);
  });
});

describe('safePercent', () => {
  it('returns 0 for zero denominator', () => {
    expect(safePercent(5, 0)).toBe(0);
  });

  it('computes percentage', () => {
    expect(safePercent(3, 4)).toBe(75);
  });
});

describe('clampPercent', () => {
  it('clamps out-of-range values to [0, 100]', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(105)).toBe(100);
    expect(clampPercent(50)).toBe(50);
  });

  it('returns 0 for NaN', () => {
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});
