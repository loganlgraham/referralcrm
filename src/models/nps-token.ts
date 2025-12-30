import { Schema, model, models } from 'mongoose';

const npsTokenSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['lender', 'agent'], required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    targetId: { type: Schema.Types.ObjectId, required: true }, // lenderId or agentId
    recipientEmail: { type: String, required: true },
    recipientName: { type: String, required: true },
    submitted: { type: Boolean, default: false },
    score: { type: Number, default: null },
    submittedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const NPSToken = models.NPSToken || model('NPSToken', npsTokenSchema);

