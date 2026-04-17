import type { Types } from 'mongoose';

export const mergeClosedStatusQuery = (
  baseQuery: Record<string, unknown>,
  statusFilter: unknown,
  closedDealReferralIds: Array<string | Types.ObjectId>
): Record<string, unknown> => {
  if (!statusFilter || closedDealReferralIds.length === 0) {
    return baseQuery;
  }

  const andConditions: Record<string, unknown>[] = [];
  Object.entries(baseQuery).forEach(([key, value]) => {
    if (key === '$and' && Array.isArray(value)) {
      andConditions.push(...value);
      return;
    }
    if (key === '$or' && Array.isArray(value)) {
      andConditions.push({ $or: value });
      return;
    }
    andConditions.push({ [key]: value });
  });

  andConditions.push({
    $or: [
      { status: statusFilter },
      { _id: { $in: closedDealReferralIds } }
    ]
  });

  if (andConditions.length === 1) {
    return andConditions[0];
  }

  return { $and: andConditions };
};
