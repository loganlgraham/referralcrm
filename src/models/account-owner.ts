import { Schema, model, models } from 'mongoose';

const ownerAuditSchema = new Schema(
  {
    at: { type: Date, required: true },
    action: { type: String, enum: ['assign'], required: true },
    actor: { type: String, enum: ['bootstrap'], required: true },
    previousOwnerUserId: { type: Schema.Types.ObjectId, default: null },
    nextOwnerUserId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const accountOwnerSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    audit: { type: [ownerAuditSchema], default: [] },
  },
  { timestamps: true },
);

export const ACCOUNT_OWNER_KEY = 'referrio';

export const AccountOwner = models.AccountOwner || model('AccountOwner', accountOwnerSchema);
