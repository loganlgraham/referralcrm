import { Schema, model, models } from 'mongoose';

const emailAddressHealthSchema = new Schema(
  {
    /** Always stored lowercase so lookups match however the address was typed. */
    address: { type: String, required: true, unique: true, index: true },
    bouncing: { type: Boolean, default: false, index: true },
    /**
     * While the address is bouncing it stays off CC lines until this moment passes, at which
     * point it gets one probe send. Each further bounce backs the window off further.
     */
    suppressedUntil: { type: Date, default: null },
    consecutiveBounces: { type: Number, default: 0 },
    lastBounceAt: { type: Date, default: null },
    lastBounceReason: { type: String, default: null },
    lastDeliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const EmailAddressHealth =
  models.EmailAddressHealth || model('EmailAddressHealth', emailAddressHealthSchema);
