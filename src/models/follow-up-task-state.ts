import { Schema, model, models } from 'mongoose';

export type FollowUpTaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type FollowUpManualTaskCategory = 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';

export interface FollowUpTaskCompletion {
  taskId: string;
  completed: boolean;
  completedAt?: string | null;
}

export interface FollowUpManualTask {
  id: string;
  title: string;
  message: string;
  dueAt?: string | null;
  priority: FollowUpTaskPriority;
  category: FollowUpManualTaskCategory;
  createdAt: string;
}

export interface FollowUpTaskMetadata {
  taskId: string;
  title: string;
  message: string;
  priority: FollowUpTaskPriority;
  category: FollowUpManualTaskCategory;
  dueAt?: string | null;
  supportingMetric?: string;
  isManual?: boolean;
  createdAt: string;
  statusWhenCreated?: string;
}

const completionSchema = new Schema<FollowUpTaskCompletion>(
  {
    taskId: { type: String, required: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: String, default: null },
  },
  { _id: false }
);

const manualTaskSchema = new Schema<FollowUpManualTask>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    dueAt: { type: String, default: null },
    priority: { type: String, required: true },
    category: { type: String, required: true },
    createdAt: { type: String, required: true },
  },
  { _id: false }
);

const taskMetadataSchema = new Schema<FollowUpTaskMetadata>(
  {
    taskId: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    priority: { type: String, required: true },
    category: { type: String, required: true },
    dueAt: { type: String, default: null },
    supportingMetric: { type: String, default: null },
    isManual: { type: Boolean, default: false },
    createdAt: { type: String, required: true },
    statusWhenCreated: { type: String, default: null },
  },
  { _id: false }
);

const followUpTaskStateSchema = new Schema(
  {
    referralId: { type: String, required: true, index: true, unique: true },
    completions: { type: [completionSchema], default: [] },
    manualTasks: { type: [manualTaskSchema], default: [] },
    shownTasks: { type: [String], default: [] },
    taskMetadata: { type: [taskMetadataSchema], default: [] },
  },
  { timestamps: true }
);

export interface FollowUpTaskStateDocument {
  _id: string;
  referralId: string;
  completions: FollowUpTaskCompletion[];
  manualTasks: FollowUpManualTask[];
  shownTasks: string[];
  taskMetadata: FollowUpTaskMetadata[];
  createdAt: Date;
  updatedAt: Date;
}

export const FollowUpTaskState =
  models.FollowUpTaskState || model<FollowUpTaskStateDocument>('FollowUpTaskState', followUpTaskStateSchema);
