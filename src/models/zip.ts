import { Schema, model, models } from 'mongoose';

const zipSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    agents: [{ type: Schema.Types.ObjectId, ref: 'Agent' }]
  },
  { timestamps: true }
);

zipSchema.index({ code: 1, agents: 1 });
zipSchema.index({ agents: 1 });

export const Zip = models.Zip || model('Zip', zipSchema);
