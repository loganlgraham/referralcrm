import { Schema, model, models } from 'mongoose';

const lenderSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    nmlsId: { type: String, required: true },
    team: String,
    region: String
  },
  { timestamps: true }
);

export const LenderMC = models.LenderMC || model('LenderMC', lenderSchema);
