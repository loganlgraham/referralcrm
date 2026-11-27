import { Schema, model, models } from 'mongoose';

// A contact can be linked to multiple referrals. Reserve the same start across all of them.
const schema = new Schema({
  _id: { type: String, required: true },
  referralId: { type: Schema.Types.ObjectId, required: true },
  actorId: { type: Schema.Types.ObjectId, required: true },
  enrollmentId: Number,
}, { timestamps: true });

export const FubAutomationStart = models.FubAutomationStart || model('FubAutomationStart', schema);
