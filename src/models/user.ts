import { Schema, model, models } from 'mongoose';

const userSchema = new Schema(
  {
    name: String,
    email: { type: String, unique: true, required: true },
    role: { type: String, enum: ['admin', 'manager', 'mc', 'agent', 'viewer'], default: 'viewer' },
    org: { type: String, enum: ['AFC', 'AHA'], default: 'AFC' },
    permissions: [{ type: String }]
  },
  { timestamps: true }
);

export const User = models.User || model('User', userSchema);
