import mongoose, { Schema, models, model } from 'mongoose';

const UserSchema = new Schema(
  {
    name: String,
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, required: true },
    emailVerified: Date,
    image: String,
    role: { type: String, enum: ['agent', 'mortgage-consultant', 'admin'], default: null },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const User = models.User || model('User', UserSchema);
