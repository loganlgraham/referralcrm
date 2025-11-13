import { Schema, model, models } from 'mongoose';

const coverageSuggestionSchema = new Schema(
  {
    value: { type: String, required: true },
    normalized: { type: String, required: true, unique: true, index: true }
  },
  { timestamps: true }
);

export const CoverageSuggestion =
  models.CoverageSuggestion || model('CoverageSuggestion', coverageSuggestionSchema);

