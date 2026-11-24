import { Schema, model, models } from 'mongoose';

const revisionSchema = new Schema({
  revision: { type: Number, required: true, min: 1, max: 200 },
  requestId: { type: String, required: true },
  expectedRevision: { type: Number, required: true, min: 0, max: 199 },
  decision: { type: String, enum: ['keep', 'release'], required: true },
  reason: { type: String, required: true, maxlength: 2000 },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerName: { type: String, required: true, maxlength: 500 },
  decidedAt: { type: Date, required: true },
}, { _id: false });

const fubSopDecisionSchema = new Schema({
  // Mongo's built-in unique _id makes concurrent first writes safe even before
  // an optional secondary index has been built.
  _id: { type: String, required: true },
  organization: { type: String, enum: ['AHA'], required: true, immutable: true },
  fubAccountId: { type: String, required: true, immutable: true },
  personId: { type: Number, required: true, immutable: true },
  noteId: { type: Number, required: true, immutable: true },
  sourceAt: { type: Date, required: true, immutable: true },
  revision: { type: Number, required: true, min: 1, max: 200 },
  // The service only appends revisions; no API overwrites or deletes history.
  audit: { type: [revisionSchema], required: true },
}, { timestamps: true });

export const FubSopDecision = models.FubSopDecision || model('FubSopDecision', fubSopDecisionSchema);
