import { mergeClosedStatusQuery } from '@/lib/server/referrals';

describe('mergeClosedStatusQuery', () => {
  it('merges closed deal ids into the status filter while preserving base conditions', () => {
    const baseQuery = {
      deletedAt: null,
      lender: 'lender-1',
      $or: [{ source: 'Lender' }, { source: 'MC' }]
    };
    const statusFilter = { $in: ['Closed', 'Lost'] };
    const closedIds = ['ref-1', 'ref-2'];

    const merged = mergeClosedStatusQuery(baseQuery, statusFilter, closedIds);

    expect(merged).toEqual({
      $and: [
        { deletedAt: null },
        { lender: 'lender-1' },
        { $or: [{ source: 'Lender' }, { source: 'MC' }] },
        { $or: [{ status: statusFilter }, { _id: { $in: closedIds } }] }
      ]
    });
  });

  it('returns the base query when no closed deal ids are provided', () => {
    const baseQuery = { deletedAt: null, lender: 'lender-2' };
    const statusFilter = { $in: ['Closed'] };

    const merged = mergeClosedStatusQuery(baseQuery, statusFilter, []);

    expect(merged).toEqual(baseQuery);
  });
});
