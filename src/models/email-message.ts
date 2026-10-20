import { Schema, model, models } from 'mongoose';

export const EMAIL_MESSAGE_STATUSES = [
  'sent',
  'delivered',
  'bounced',
  'complained',
  'delayed',
  /** Accepted by Resend but never sent, e.g. an attachment it could not fetch. */
  'failed',
  /** Never handed to Resend because every To recipient was in a bounce backoff window. */
  'suppressed',
] as const;

export type EmailMessageStatus = (typeof EMAIL_MESSAGE_STATUSES)[number];

const emailMessageSchema = new Schema(
  {
    /**
     * Resend's own id for the message, used to correlate delivery webhooks back to this record.
     * Absent on suppressed sends, which never reach Resend, so the unique index is sparse.
     */
    resendId: { type: String, default: null, unique: true, sparse: true, index: true },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    /** Addresses withheld from the To line because they were bouncing at send time. */
    withheldTo: { type: [String], default: [] },
    /** Addresses that were withheld from the CC line because they were bouncing at send time. */
    withheldCc: { type: [String], default: [] },
    subject: { type: String, default: '' },
    status: { type: String, enum: EMAIL_MESSAGE_STATUSES, default: 'sent', index: true },
    /** The specific recipients that failed, which may be CC addresses rather than the To address. */
    failedRecipients: { type: [String], default: [] },
    failureReason: { type: String, default: null },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', default: null, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
    lenderId: { type: Schema.Types.ObjectId, ref: 'LenderMC', default: null },
    sentAt: { type: Date, default: Date.now },
    lastEventAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailMessageSchema.index({ status: 1, sentAt: -1 });

export const EmailMessage = models.EmailMessage || model('EmailMessage', emailMessageSchema);
