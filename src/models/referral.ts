import { Schema, model, models, Types } from 'mongoose';

import { DEFAULT_AGENT_COMMISSION_BPS, DEFAULT_REFERRAL_FEE_BPS, REFERRAL_STATUSES } from '@/constants/referrals';

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

const referralNoteSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    content: { type: String, required: true },
    hiddenFromAgent: { type: Boolean, default: false },
    hiddenFromMc: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    emailedTargets: { type: [String], enum: ['agent', 'mc', 'admin'], default: [] }
  },
  { _id: true }
);

const inboundEmailSchema = new Schema(
  {
    messageId: { type: String, required: true },
    routeHint: { type: String },
    channel: { type: String, enum: ['AHA', 'AHA_OOS'] },
    receivedAt: { type: Date, default: Date.now },
    from: { type: String },
    subject: { type: String }
  },
  { _id: false }
);

const referralSchema = new Schema(
  {
    createdAt: { type: Date, default: Date.now, index: true },
    source: { type: String, required: true, trim: true },
    endorser: { type: String, default: '' },
    clientType: {
      type: String,
      enum: ['Seller', 'Buyer', 'Both'],
      required(this: { isNew: boolean }) {
        return this.isNew;
      }
    },
    borrower: {
      firstName: { type: String, default: '', trim: true },
      lastName: { type: String, default: '', trim: true },
      name: { type: String, required: true },
      email: { type: String, index: true, required: true },
      phone: { type: String, required: true }
    },
    lookingInZip: {
      type: String,
      index: true,
      required(this: { isNew: boolean }) {
        return this.isNew;
      }
    },
    borrowerCurrentAddress: { type: String, default: '' },
    propertyAddress: { type: String, default: '' },
    propertyCity: { type: String, default: '' },
    propertyState: { type: String, default: '' },
    propertyPostalCode: { type: String, default: '' },
    dealSide: {
      type: String,
      enum: ['buy', 'sell'],
      default: 'buy',
    },
    stageOnTransfer: { type: String, default: 'Pre-Approval TBD' },
    initialNotes: { type: String, default: '' },
    loanFileNumber: {
      type: String,
      required(this: { isNew: boolean }) {
        return this.isNew;
      }
    },
    assignedAgent: { type: Schema.Types.ObjectId, ref: 'Agent', index: true },
    status: {
      type: String,
      enum: REFERRAL_STATUSES,
      default: 'New Lead',
      index: true
    },
    statusLastUpdated: { type: Date, default: Date.now },
    loanType: String,
    preApprovalAmountCents: { type: Number, default: 0 },
    estPurchasePriceCents: { type: Number, default: 0 },
    commissionBasisPoints: { type: Number, default: DEFAULT_AGENT_COMMISSION_BPS },
    referralFeeBasisPoints: { type: Number, default: DEFAULT_REFERRAL_FEE_BPS },
    closedPriceCents: { type: Number, default: 0 },
    referralFeeDueCents: { type: Number, default: 0 },
    notes: { type: [referralNoteSchema], default: [] },
    attachments: [attachmentSchema],
    inboundEmail: inboundEmailSchema,
    audit: [auditSchema],
    lender: { type: Schema.Types.ObjectId, ref: 'LenderMC' },
    buyer: { type: Schema.Types.ObjectId, ref: 'Buyer' },
    sla: {
      timeToFirstAgentContactHours: { type: Number, default: null },
      timeToAssignmentHours: { type: Number, default: null },
      daysToContract: { type: Number, default: null },
      daysToClose: { type: Number, default: null },
      contractToCloseMinutes: { type: Number, default: null },
      closedToPaidMinutes: { type: Number, default: null },
      previousContractToCloseMinutes: { type: Number, default: null },
      previousClosedToPaidMinutes: { type: Number, default: null },
      lastUnderContractAt: { type: Date, default: null },
      lastClosedAt: { type: Date, default: null },
      lastPaidAt: { type: Date, default: null }
    },
    org: { type: String, enum: ['AFC', 'AHA'], default: 'AFC' },
    ahaBucket: {
      type: String,
      enum: ['AHA', 'AHA_OOS'],
      default: null,
    },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

referralSchema.index({ 'borrower.email': 1, createdAt: 1 }, { unique: true });
referralSchema.index({ loanFileNumber: 1 }, { unique: true });
referralSchema.index(
  { 'inboundEmail.messageId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'inboundEmail.messageId': { $exists: true, $ne: null } }
  }
);

export interface ReferralDocument {
  _id: Types.ObjectId;
  createdAt: Date;
  source: string;
  borrower: {
    firstName?: string;
    lastName?: string;
    name: string;
    email: string;
    phone: string;
  };
  endorser?: string;
  clientType: 'Seller' | 'Buyer' | 'Both';
  lookingInZip: string;
  borrowerCurrentAddress?: string;
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyPostalCode?: string;
  stageOnTransfer?: string;
  initialNotes?: string;
  loanFileNumber: string;
  assignedAgent?: Types.ObjectId;
  status: ReferralStatus;
  statusLastUpdated?: Date;
  loanType?: string;
  preApprovalAmountCents?: number;
  estPurchasePriceCents?: number;
  commissionBasisPoints?: number;
  referralFeeBasisPoints?: number;
  dealSide?: 'buy' | 'sell';
  referralFeeDueCents?: number;
  sla?: {
    timeToFirstAgentContactHours?: number | null;
    timeToAssignmentHours?: number | null;
    daysToContract?: number | null;
    daysToClose?: number | null;
    contractToCloseMinutes?: number | null;
    closedToPaidMinutes?: number | null;
    previousContractToCloseMinutes?: number | null;
    previousClosedToPaidMinutes?: number | null;
    lastUnderContractAt?: Date | null;
    lastClosedAt?: Date | null;
    lastPaidAt?: Date | null;
  } | null;
  notes?: {
    _id: Types.ObjectId;
    author: Types.ObjectId;
    authorName: string;
    authorRole: string;
    content: string;
    hiddenFromAgent?: boolean;
    hiddenFromMc?: boolean;
    createdAt: Date;
    emailedTargets?: ('agent' | 'mc' | 'admin')[];
  }[];
  lender?: Types.ObjectId;
  org: 'AFC' | 'AHA';
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  deletedAt?: Date;
  audit?: AuditEntry[];
  inboundEmail?: {
    messageId: string;
    routeHint?: string;
    channel?: 'AHA' | 'AHA_OOS' | null;
    receivedAt?: Date;
    from?: string;
    subject?: string;
  };
}

export const Referral = models.Referral || model<ReferralDocument>('Referral', referralSchema);
