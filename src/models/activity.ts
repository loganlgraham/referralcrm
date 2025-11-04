import { Schema, model, models } from 'mongoose';

const activitySchema = new Schema(
  {
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
    actor: { type: String, enum: ['Agent', 'MC', 'System'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    channel: { type: String, enum: ['call', 'sms', 'email', 'note'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

activitySchema.index({ referralId: 1, createdAt: -1 });

export const Activity = models.Activity || model('Activity', activitySchema);
