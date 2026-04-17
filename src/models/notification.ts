import { Schema, model, models } from 'mongoose';

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { 
      type: String, 
      enum: ['note', 'status_change', 'email_response', 'update_request_response', 'nps_survey_completed', 'checkin_no_response_24h', 'referral_created'], 
      required: true 
    },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    borrowerName: { type: String, required: true },
    actorRole: { type: String, required: true },
    actorName: { type: String, required: true },
    content: { type: String, required: true },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

// Compound index for efficient queries
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = models.Notification || model('Notification', notificationSchema);
