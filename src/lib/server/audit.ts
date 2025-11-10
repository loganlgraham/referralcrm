import { Types } from 'mongoose';

export const resolveAuditActorId = (value: unknown): Types.ObjectId | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }

  return undefined;
};
