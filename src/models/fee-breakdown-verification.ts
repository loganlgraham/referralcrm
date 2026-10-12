import { Schema, Types, model, models } from 'mongoose';

import {
  FEE_VERIFICATION_FIELDS,
  FEE_VERIFICATION_STATUSES,
  type FeeVerificationField,
  type FeeVerificationStatus,
} from '@/lib/fee-verification';

export interface FeeBreakdownVerificationLean {
  _id: Types.ObjectId;
  paymentId: Types.ObjectId;
  referralId: Types.ObjectId;
  agentId?: Types.ObjectId | null;
  recipientEmail: string;
  recipientName?: string | null;
  borrowerName?: string | null;
  propertyAddress?: string | null;
  snapshot: {
    contractPriceCents: number;
    commissionBasisPoints?: number | null;
    commissionFlatFeeCents?: number | null;
    referralFeeBasisPoints: number;
    closingDate?: Date | null;
  };
  status: FeeVerificationStatus;
  respondedAt?: Date | null;
  corrections?: Array<{ field: FeeVerificationField; correctValue: string }>;
  note?: string | null;
  expiresAt: Date;
}

const correctionSchema = new Schema(
  {
    field: { type: String, enum: FEE_VERIFICATION_FIELDS, required: true },
    correctValue: { type: String, required: true },
  },
  { _id: false }
);

const feeBreakdownVerificationSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
    recipientEmail: { type: String, required: true },
    recipientName: { type: String, default: null },
    borrowerName: { type: String, default: null },
    propertyAddress: { type: String, default: null },
    snapshot: {
      contractPriceCents: { type: Number, required: true },
      commissionBasisPoints: { type: Number, default: null },
      commissionFlatFeeCents: { type: Number, default: null },
      referralFeeBasisPoints: { type: Number, required: true },
      closingDate: { type: Date, default: null },
    },
    status: { type: String, enum: FEE_VERIFICATION_STATUSES, default: 'pending' },
    respondedAt: { type: Date, default: null },
    corrections: { type: [correctionSchema], default: [] },
    note: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const FeeBreakdownVerification =
  models.FeeBreakdownVerification ||
  model('FeeBreakdownVerification', feeBreakdownVerificationSchema);
