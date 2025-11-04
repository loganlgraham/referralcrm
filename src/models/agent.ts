import { Schema, model, models } from 'mongoose';

const agentSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    statesLicensed: [{ type: String, index: true }],
    zipCoverage: [{ type: String, index: true }],
    active: { type: Boolean, default: true },
    closings12mo: { type: Number, default: 0 },
    npsScore: { type: Number, default: null },
    avgResponseHours: { type: Number, default: null },
    brokerage: { type: String },
    markets: [{ type: String }]
  },
  { timestamps: true }
);

agentSchema.index({ statesLicensed: 1 });
agentSchema.index({ zipCoverage: 1 });

export const Agent = models.Agent || model('Agent', agentSchema);
export type AgentDocument = typeof agentSchema extends infer U
  ? U extends Schema<infer R, any>
    ? R & { _id: Schema.Types.ObjectId }
    : never
  : never;
