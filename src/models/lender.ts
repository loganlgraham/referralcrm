import { Schema, model, models } from 'mongoose';

const lenderNoteSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    content: { type: String, required: true },
    hiddenFromMc: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const lenderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: false },
    nmlsId: { type: String, required: true },
    licensedStates: [{ type: String, index: true }],
    team: String,
    region: String,
    notes: { type: [lenderNoteSchema], default: [] }
  },
  { timestamps: true }
);

export const LenderMC = models.LenderMC || model('LenderMC', lenderSchema);
