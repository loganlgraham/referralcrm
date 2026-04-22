import { Schema, model, models } from 'mongoose';

// Compound index to support the closing-reminders cron hot path:
// filter by closingDate range + status + feeBreakdownEmailSentAt presence.
// Mongo builds this on the next connect; no manual migration needed.
const paymentSchemaIndexes = {
  closingDateStatus: { closingDate: 1, status: 1 } as const,
  referralIdStatus: { referralId: 1, status: 1 } as const,
};

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
    closingDate: { type: Date, default: null },
    propertyCity: { type: String, default: null },
    propertyState: { type: String, default: null },
    commissionBasisPoints: { type: Number, default: null },
    commissionFlatFeeCents: { type: Number, default: null },
    referralFeeBasisPoints: { type: Number, default: null },
    side: {
      type: String,
      enum: ['buy', 'sell'],
      default: 'buy',
    },
    netReferralFeePaidCents: { type: Number, default: null },
    propertyAddress: { type: String, default: null },
    agentAttribution: {
      type: String,
      enum: ['AHA', 'AHA_OOS', 'OUTSIDE_AGENT'],
      default: null,
    },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
    usedAfc: { type: Boolean, default: true },
    usedAssignedAgent: { type: Boolean, default: true },
    underContractDate: { type: Date, default: null },
    invoiceDate: Date,
    paidDate: Date,
    notes: String,
    feeBreakdownEmailSentAt: { type: Date, default: null },
    feeBreakdownEmailSentBy: { type: String, default: null },
    closingDatePushbackCount: { type: Number, default: 0 },
    closingDatePushbacks: {
      type: [
        {
          previousClosingDate: { type: Date, required: true },
          nextClosingDate: { type: Date, required: true },
          pushedBackDays: { type: Number, required: true },
          actorRole: { type: String, default: null },
          actorId: { type: Schema.Types.ObjectId, default: null },
          timestamp: { type: Date, default: Date.now },
        }
      ],
      default: []
    }
  },
  { timestamps: true }
);

paymentSchema.index(paymentSchemaIndexes.closingDateStatus);
paymentSchema.index(paymentSchemaIndexes.referralIdStatus);

export const Payment = models.Payment || model('Payment', paymentSchema);
