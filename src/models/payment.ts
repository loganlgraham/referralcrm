import { Schema, model, models } from 'mongoose';

const paymentSchema = new Schema(
  {
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
    status: {
      type: String,
      enum: ['under_contract', 'closed', 'paid', 'terminated'],
      default: 'under_contract',
      index: true
    },
    expectedAmountCents: { type: Number, required: true },
    receivedAmountCents: { type: Number, default: 0 },
    terminatedReason: {
      type: String,
      enum: ['inspection', 'appraisal', 'financing', 'changed_mind'],
      default: null,
    },
    agentAttribution: {
      type: String,
      enum: ['AHA', 'AHA_OOS'],
      default: null,
    },
    usedAfc: { type: Boolean, default: false },
    invoiceDate: Date,
    paidDate: Date,
    notes: String
  },
  { timestamps: true }
);

export const Payment = models.Payment || model('Payment', paymentSchema);
