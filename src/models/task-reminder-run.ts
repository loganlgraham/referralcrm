import { Schema, model, models, type Types } from 'mongoose';

const reminderRecipientSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, required: true },
    role: { type: String, required: true },
    taskCount: { type: Number, default: 0 },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    error: { type: String },
  },
  { _id: false }
);

const taskReminderRunSchema = new Schema(
  {
    frequency: { type: String, enum: ['daily', 'weekly'], required: true },
    recipients: { type: [reminderRecipientSchema], default: [] },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

taskReminderRunSchema.index({ createdAt: -1 });

export const TaskReminderRun = models.TaskReminderRun || model('TaskReminderRun', taskReminderRunSchema);

export type TaskReminderRunDocument = typeof taskReminderRunSchema extends infer U
  ? U extends Schema<infer R, any>
    ? R & { _id: Types.ObjectId }
    : never
  : never;
