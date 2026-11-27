import { Schema, model, models, Types } from 'mongoose';

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    action: { type: String, enum: ['link', 'correct', 'unlink'], required: true },
    previousPersonId: { type: Number, default: null },
    nextPersonId: { type: Number, default: null },
  },
  { _id: false },
);

const intelligenceLinkSchema = new Schema(
  {
    organization: { type: String, enum: ['AHA', 'AFC'], required: true },
    fubAccountId: { type: String, required: true },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    participantKey: { type: String, required: true },
    fubPersonId: { type: Number, default: null },
    audit: { type: [auditSchema], default: [] },
  },
  { timestamps: true },
);

intelligenceLinkSchema.index(
  { organization: 1, fubAccountId: 1, referralId: 1, participantKey: 1 },
  { unique: true },
);

const intelligenceAgentLinkSchema = new Schema(
  {
    organization: { type: String, enum: ['AHA', 'AFC'], required: true },
    fubAccountId: { type: String, required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    fubUserId: { type: Number, required: true },
    audit: { type: [auditSchema], default: [] },
  },
  { timestamps: true },
);

intelligenceAgentLinkSchema.index(
  { organization: 1, fubAccountId: 1, agentId: 1 },
  { unique: true },
);

const accessAuditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organization: { type: String, enum: ['AHA', 'AFC'], required: true },
    fubAccountId: { type: String, required: true },
    action: { type: String, enum: ['grant', 'revoke'], required: true },
    at: { type: Date, required: true },
    before: { type: String, enum: ['absent', 'granted', 'revoked'], required: true },
    after: { type: String, enum: ['granted', 'revoked'], required: true },
  },
  { _id: false },
);

const intelligenceAccessSchema = new Schema(
  {
    organization: { type: String, enum: ['AHA', 'AFC'], required: true },
    fubAccountId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revokedAt: { type: Date, default: null },
    audit: { type: [accessAuditSchema], default: [] },
  },
  { timestamps: true },
);

intelligenceAccessSchema.index(
  { organization: 1, fubAccountId: 1, userId: 1 },
  { unique: true },
);

export const IntelligenceLink = models.IntelligenceLink || model('IntelligenceLink', intelligenceLinkSchema);
export const IntelligenceAgentLink = models.IntelligenceAgentLink || model('IntelligenceAgentLink', intelligenceAgentLinkSchema);
export const FubDashboardAccess = models.FubDashboardAccess || model('FubDashboardAccess', intelligenceAccessSchema.clone());

export const IntelligenceAccess = models.IntelligenceAccess || model('IntelligenceAccess', intelligenceAccessSchema);

export type IntelligenceLinkRecord = {
  _id: Types.ObjectId;
  organization: 'AHA' | 'AFC';
  fubAccountId: string;
  referralId: Types.ObjectId;
  participantKey: string;
  fubPersonId: number | null;
};
