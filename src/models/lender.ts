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
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    nmlsId: { type: String, required: true },
    team: String,
    region: String,
    notes: { type: [lenderNoteSchema], default: [] }
  },
  { timestamps: true }
);

export const LenderMC = models.LenderMC || model('LenderMC', lenderSchema);
