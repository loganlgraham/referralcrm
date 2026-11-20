import { Schema, model, models } from 'mongoose';

const serverDocumentSchema = new Schema(
  {
    key: { type: String, required: true, index: true },
    version: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    content: { type: Buffer, required: true },
    byteLength: { type: Number, required: true },
    sha256: { type: String, required: true },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

serverDocumentSchema.index({ key: 1, version: 1 }, { unique: true });

export const ServerDocument = models.ServerDocument || model('ServerDocument', serverDocumentSchema);
