import { Schema, model, models } from 'mongoose';

const zipSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    city: { type: String, required: true },
    state: { type: String, required: true }
  },
  { timestamps: true }
);

export const Zip = models.Zip || model('Zip', zipSchema);
