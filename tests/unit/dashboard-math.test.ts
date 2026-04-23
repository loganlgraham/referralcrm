import { endOfMonth, startOfMonth } from 'date-fns';
import { describe, expect, it } from '@jest/globals';
import {
  clampPercent,
  computeCohortCloseRate,
  isClosingInNonTerminatedMonth,
  isTotalFutureClosingStatus,
  safePercent
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

describe('isTotalFutureClosingStatus', () => {
  it('counts pre-close pipeline statuses', () => {
    expect(isTotalFutureClosingStatus('under_contract')).toBe(true);
    expect(isTotalFutureClosingStatus('past_inspection')).toBe(true);
    expect(isTotalFutureClosingStatus('clear_to_close')).toBe(true);
  });

  it('excludes closed, payment_sent, paid, and terminated', () => {
    expect(isTotalFutureClosingStatus('closed')).toBe(false);
    expect(isTotalFutureClosingStatus('payment_sent')).toBe(false);
    expect(isTotalFutureClosingStatus('paid')).toBe(false);
    expect(isTotalFutureClosingStatus('terminated')).toBe(false);
  });

  it('excludes payment_received for forward compatibility', () => {
    expect(isTotalFutureClosingStatus('payment_received')).toBe(false);
  });
});

describe('isClosingInNonTerminatedMonth', () => {
  const monthStart = startOfMonth(new Date(2026, 3, 1));
  const monthEnd = endOfMonth(new Date(2026, 3, 1));
  const closingInMonth = new Date(2026, 3, 15);

  it('returns true for closed with closingDate in range', () => {
    expect(
      isClosingInNonTerminatedMonth('closed', closingInMonth, monthStart, monthEnd)
    ).toBe(true);
  });

  it('returns true for under_contract with closingDate in range', () => {
    expect(
      isClosingInNonTerminatedMonth('under_contract', closingInMonth, monthStart, monthEnd)
    ).toBe(true);
  });

  it('excludes terminated even when date would be in range', () => {
    expect(
      isClosingInNonTerminatedMonth('terminated', closingInMonth, monthStart, monthEnd)
    ).toBe(false);
  });

  it('returns false when closingDate is missing', () => {
    expect(
      isClosingInNonTerminatedMonth('under_contract', null, monthStart, monthEnd)
    ).toBe(false);
  });

  it('returns false when closingDate is outside range', () => {
    expect(
      isClosingInNonTerminatedMonth('closed', new Date(2026, 4, 1), monthStart, monthEnd)
    ).toBe(false);
  });
});
