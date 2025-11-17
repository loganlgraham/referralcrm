import { Schema, model, models } from 'mongoose';

const paymentSchema = new Schema(
  {
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
    status: {
      type: String,
      enum: [
        'under_contract',
        'past_inspection',
        'past_appraisal',
        'clear_to_close',
        'closed',
        'payment_sent',
        'paid',
        'terminated',
      ],
      default: 'under_contract',
      index: true
    },
    expectedAmountCents: { type: Number, required: true },
    receivedAmountCents: { type: Number, default: 0 },
    contractPriceCents: { type: Number, default: null },
    terminatedReason: {
      type: String,
      enum: ['inspection', 'appraisal', 'financing', 'changed_mind'],
      default: null,
    },
    commissionBasisPoints: { type: Number, default: null },
    referralFeeBasisPoints: { type: Number, default: null },
    side: {
      type: String,
      enum: ['buy', 'sell'],
      default: 'buy',
    },
    agentAttribution: {
      type: String,
      enum: ['AHA', 'AHA_OOS', 'OUTSIDE_AGENT'],
      default: null,
    },
    expectedCloseDate: { type: Date, default: null },
    closeDateHistory: {
      type: [
        {
          previousDate: { type: Date, default: null },
          nextDate: { type: Date, default: null },
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: String, default: null },
        }
      ],
      default: [],
    },
    usedAfc: { type: Boolean, default: true },
    usedAssignedAgent: { type: Boolean, default: true },
    invoiceDate: Date,
    paidDate: Date,
    notes: String
  },
  { timestamps: true }
);

export const Payment = models.Payment || model('Payment', paymentSchema);
