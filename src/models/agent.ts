import { Schema, model, models } from 'mongoose';

const agentNoteSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    content: { type: String, required: true },
    hiddenFromAgent: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const coverageLocationSchema = new Schema(
  {
    label: { type: String, required: true },
    zipCodes: [{ type: String, required: true }]
  },
  { _id: false }
);

const agentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: false },
    licenseNumber: { type: String },
    statesLicensed: [{ type: String, index: true }],
    zipCoverage: [{ type: String, index: true }],
    coverageLocations: { type: [coverageLocationSchema], default: [] },
    active: { type: Boolean, default: true },
    closings12mo: { type: Number, default: 0 },
    closingRatePercentage: { type: Number, default: null },
    npsScore: { type: Number, default: null },
    avgResponseHours: { type: Number, default: null },
    brokerage: { type: String },
    markets: [{ type: String }],
    specialties: { type: [String], default: [] },
    experienceSince: { type: Date },
    notes: { type: [agentNoteSchema], default: [] }
  },
  { timestamps: true }
);

export const Agent = models.Agent || model('Agent', agentSchema);
export type AgentDocument = typeof agentSchema extends infer U
  ? U extends Schema<infer R, any>
    ? R & { _id: Schema.Types.ObjectId }
    : never
  : never;
