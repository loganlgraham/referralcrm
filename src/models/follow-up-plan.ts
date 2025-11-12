import { Schema, model, models, Types } from 'mongoose';

import { FollowUpTask } from '@/lib/follow-ups';

interface FollowUpPlanTask extends FollowUpTask {}

interface FollowUpCompletion {
  taskId: string;
  completedAt: Date;
  completedBy?: Types.ObjectId;
  completedByName?: string;
}

export interface FollowUpPlanDocument {
  _id: Types.ObjectId;
  referral: Types.ObjectId;
  generatedAt: Date;
  tasks: FollowUpPlanTask[];
  meta?: {
    source: 'ai' | 'fallback';
    reason?: string;
  };
  completed: FollowUpCompletion[];
  createdAt: Date;
  updatedAt: Date;
}

const followUpTaskSchema = new Schema<FollowUpPlanTask>(
  {
    audience: { type: String, enum: ['Agent', 'MC', 'Referral'], required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    suggestedChannel: { type: String, enum: ['Phone', 'Email', 'Text', 'Internal'], required: true },
    urgency: { type: String, enum: ['Low', 'Medium', 'High'], required: true },
  },
  { _id: false }
);

const completionSchema = new Schema<FollowUpCompletion>(
  {
    taskId: { type: String, required: true },
    completedAt: { type: Date, default: Date.now },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedByName: { type: String },
  },
  { _id: false }
);

const followUpPlanSchema = new Schema<FollowUpPlanDocument>(
  {
    referral: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, unique: true },
    generatedAt: { type: Date, required: true },
    tasks: { type: [followUpTaskSchema], default: [] },
    meta: {
      source: { type: String, enum: ['ai', 'fallback'], default: 'ai' },
      reason: { type: String },
    },
    completed: { type: [completionSchema], default: [] },
  },
  { timestamps: true }
);

export const FollowUpPlan = models.FollowUpPlan || model<FollowUpPlanDocument>('FollowUpPlan', followUpPlanSchema);
