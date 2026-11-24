import { Schema, model, models } from 'mongoose';

// Keep the original email outside referral queries and customer-facing serializers.
const messageSchema = new Schema(
  {
    _id: { type: String, required: true },
    referralId: { type: Schema.Types.ObjectId, required: true },
    text: String,
    html: String,
    from: String,
    to: [String],
    cc: [String],
    subject: String,
    receivedAt: Date,
    attachmentNames: [String],
    fields: [{ _id: false, label: String, value: String }],
  },
  { versionKey: false },
);

export const InboundReferralMessage =
  models.InboundReferralMessage ||
  model('InboundReferralMessage', messageSchema);
