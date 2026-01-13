import { Schema, model, models } from 'mongoose';

const referralMetadataSchema = new Schema(
  {
    type: { type: String, required: true, enum: ['source', 'endorser', 'agent_source'], index: true },
    value: { type: String, required: true, trim: true },
    usageCount: { type: Number, default: 1, min: 0 },
    lastUsedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Compound index to ensure uniqueness of type + value (case-insensitive)
referralMetadataSchema.index({ type: 1, value: 1 }, { unique: true });

// Index for querying by type
referralMetadataSchema.index({ type: 1, lastUsedAt: -1 });

export interface ReferralMetadataDocument {
  _id: string;
  type: 'source' | 'endorser' | 'agent_source';
  value: string;
  usageCount: number;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const ReferralMetadata =
  models.ReferralMetadata || model<ReferralMetadataDocument>('ReferralMetadata', referralMetadataSchema);
