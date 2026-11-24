import mongoose, { Schema, models, model } from 'mongoose';
import { describeStoredUserChange, ownerMutationIsBlocked } from '@/lib/intelligence/access-control';
import { ACCOUNT_OWNER_KEY, AccountOwner } from '@/models/account-owner';

const UserSchema = new Schema(
  {
    name: String,
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, required: true },
    emailVerified: Date,
    image: String,
    role: { type: String, enum: ['agent', 'mortgage-consultant', 'admin'], default: null },
    passwordHash: { type: String, required: true, select: false },
    lastLoginAt: Date,
    reminderEnabled: { type: Boolean, default: false },
    reminderFrequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
  },
  { timestamps: true }
);

const OWNER_PROTECTED = 'The account owner cannot be removed, demoted, or disabled.';

async function rejectHarmfulOwnerChange(filter: Record<string, unknown>, update: unknown, removing: boolean) {
  const change = describeStoredUserChange(update, removing);
  if (!ownerMutationIsBlocked({ targetIsOwner: true, removing: change.removing, nextRole: change.nextRole, disabling: change.disabling })) {
    return;
  }
  const owner = await AccountOwner.findOne({ key: ACCOUNT_OWNER_KEY }).select('ownerUserId').lean<{ ownerUserId?: unknown } | null>();
  if (!owner?.ownerUserId) return;
  const matched = await mongoose.model('User').exists({ $and: [filter, { _id: owner.ownerUserId }] });
  if (matched) {
    throw Object.assign(new Error(OWNER_PROTECTED), { code: 'OWNER_PROTECTED' });
  }
}

UserSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], async function protectOwnerUpdate() {
  const query = this as unknown as { getFilter: () => Record<string, unknown>; getUpdate: () => unknown };
  await rejectHarmfulOwnerChange(query.getFilter(), query.getUpdate(), false);
});

UserSchema.pre(['deleteOne', 'findOneAndDelete', 'deleteMany'], async function protectOwnerDelete() {
  const query = this as unknown as { getFilter: () => Record<string, unknown> };
  await rejectHarmfulOwnerChange(query.getFilter(), null, true);
});

export const User = models.User || model('User', UserSchema);
