import { describe, expect, it } from '@jest/globals';
import { Types } from 'mongoose';
import { resolveOriginalLenderId } from '@/lib/server/referral-transfer';

function oid(hex: string) {
  return new Types.ObjectId(hex.padStart(24, '0'));
}

describe('resolveOriginalLenderId', () => {
  const mcA = oid('a');
  const mcB = oid('b');
  const mcC = oid('c');

  it('returns the current lender when there is no audit trail', () => {
    expect(resolveOriginalLenderId({ lender: mcA })).toBe(mcA.toString());
    expect(resolveOriginalLenderId({ lender: mcA, audit: [] })).toBe(mcA.toString());
  });

  it('ignores non-lender audit entries and falls back to current lender', () => {
    const result = resolveOriginalLenderId({
      lender: mcB,
      audit: [{ field: 'status', previousValue: 'New', newValue: 'Paired', timestamp: '2026-01-01' }]
    });
    expect(result).toBe(mcB.toString());
  });

  it('credits the lender that existed before the first reassignment (previousValue wins)', () => {
    const result = resolveOriginalLenderId({
      lender: mcB,
      audit: [
        {
          field: 'lender',
          previousValue: mcA.toString(),
          newValue: mcB.toString(),
          timestamp: '2026-02-01'
        }
      ]
    });
    expect(result).toBe(mcA.toString());
  });

  it('credits the first explicit assignment when there was no prior lender', () => {
    const result = resolveOriginalLenderId({
      lender: mcC,
      audit: [
        { field: 'lender', previousValue: null, newValue: mcA.toString(), timestamp: '2026-01-01' },
        {
          field: 'lender',
          previousValue: mcA.toString(),
          newValue: mcB.toString(),
          timestamp: '2026-02-01'
        },
        {
          field: 'lender',
          previousValue: mcB.toString(),
          newValue: mcC.toString(),
          timestamp: '2026-03-01'
        }
      ]
    });
    expect(result).toBe(mcA.toString());
  });

  it('sorts by timestamp regardless of stored order', () => {
    const result = resolveOriginalLenderId({
      lender: mcC,
      audit: [
        {
          field: 'lender',
          previousValue: mcB.toString(),
          newValue: mcC.toString(),
          timestamp: '2026-03-01'
        },
        { field: 'lender', previousValue: null, newValue: mcA.toString(), timestamp: '2026-01-01' },
        {
          field: 'lender',
          previousValue: mcA.toString(),
          newValue: mcB.toString(),
          timestamp: '2026-02-01'
        }
      ]
    });
    expect(result).toBe(mcA.toString());
  });

  it('returns null when there is no lender anywhere', () => {
    expect(resolveOriginalLenderId({})).toBeNull();
    expect(resolveOriginalLenderId({ lender: null })).toBeNull();
  });
});
