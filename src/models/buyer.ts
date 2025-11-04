import { Schema, model, models } from 'mongoose';

const buyerSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    currentAddress: String,
    preferences: Schema.Types.Mixed
  },
  { timestamps: true }
);

export const Buyer = models.Buyer || model('Buyer', buyerSchema);
