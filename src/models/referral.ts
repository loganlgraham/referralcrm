import { Schema, model, models, Types } from 'mongoose';

import { REFERRAL_STATUSES } from '@/constants/referrals';

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export interface AuditEntry {
  actorId: Types.ObjectId;
  actorRole: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  timestamp: Date;
  ip?: string;
}

const attachmentSchema = new Schema(
  {
    name: String,
    url: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const auditSchema = new Schema<AuditEntry>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String },
    field: String,
    previousValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now },
    ip: String
  },
  { _id: false }
);

const referralSchema = new Schema(
  {
    createdAt: { type: Date, default: Date.now, index: true },
    source: { type: String, enum: ['Lender', 'MC'], required: true },
    borrower: {
      name: { type: String, required: true },
      email: { type: String, index: true, required: true },
      phone: { type: String, required: true }
    },
    propertyZip: { type: String, required: true, index: true },
    assignedAgent: { type: Schema.Types.ObjectId, ref: 'Agent', index: true },
    status: {
      type: String,
      enum: REFERRAL_STATUSES,
      default: 'New',
      index: true
    },
    statusLastUpdated: { type: Date, default: Date.now },
    loanType: String,
    preApprovalAmountCents: { type: Number, default: 0 },
    estPurchasePriceCents: { type: Number, default: 0 },
    commissionBasisPoints: { type: Number, default: 0 },
    referralFeeBasisPoints: { type: Number, default: 0 },
    closedPriceCents: { type: Number, default: 0 },
    referralFeeDueCents: { type: Number, default: 0 },
    notes: String,
    attachments: [attachmentSchema],
    audit: [auditSchema],
    lender: { type: Schema.Types.ObjectId, ref: 'LenderMC' },
    buyer: { type: Schema.Types.ObjectId, ref: 'Buyer' },
    sla: {
      timeToFirstAgentContactHours: { type: Number, default: null },
      timeToAssignmentHours: { type: Number, default: null },
      daysToContract: { type: Number, default: null },
      daysToClose: { type: Number, default: null }
    },
    org: { type: String, enum: ['AFC', 'AHA'], default: 'AFC' },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

referralSchema.index({ 'borrower.email': 1, createdAt: 1 }, { unique: true });

export interface ReferralDocument {
  _id: Types.ObjectId;
  createdAt: Date;
  source: 'Lender' | 'MC';
  borrower: {
    name: string;
    email: string;
    phone: string;
  };
  propertyZip: string;
  assignedAgent?: Types.ObjectId;
  status: ReferralStatus;
  statusLastUpdated?: Date;
  loanType?: string;
  preApprovalAmountCents?: number;
  estPurchasePriceCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  referralFeeDueCents?: number;
  lender?: Types.ObjectId;
  org: 'AFC' | 'AHA';
  deletedAt?: Date;
  audit?: AuditEntry[];
}

export const Referral = models.Referral || model<ReferralDocument>('Referral', referralSchema);
