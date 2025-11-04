import { Schema, model, models } from 'mongoose';

const paymentSchema = new Schema(
  {
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
    status: {
      type: String,
      enum: ['expected', 'invoiced', 'paid', 'writtenOff'],
      default: 'expected',
      index: true
    },
    expectedAmountCents: { type: Number, required: true },
    receivedAmountCents: { type: Number, default: 0 },
    invoiceDate: Date,
    paidDate: Date,
    notes: String
  },
  { timestamps: true }
);

export const Payment = models.Payment || model('Payment', paymentSchema);
