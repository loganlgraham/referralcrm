import { Schema, model, models, Types } from 'mongoose';

// Task types matching the static-follow-up-tasks.ts definitions
export type FollowUpTaskType = 'Task' | 'Call' | 'Email' | 'Text' | 'Auto-Email';
export type FollowUpTaskCategory = 'ops' | 'communication' | 'pipeline' | 'finance';
export type FollowUpTaskScope = 'referral' | 'agent';
export type FollowUpTaskStatus = 'open' | 'completed' | 'archived';
export type FollowUpTaskSource = 'static' | 'manual';
export type AnchorType = 'referral_created' | 'referral_status' | 'deal_status';

export interface TaskAnchor {
  type: AnchorType;
  value: string; // e.g., 'Paired', 'In Communication', 'closed'
  at: Date; // when the triggering event occurred
}

// Anchor schema for tracking trigger context
const taskAnchorSchema = new Schema<TaskAnchor>(
  {
    type: {
      type: String,
      enum: ['referral_created', 'referral_status', 'deal_status'],
      required: true,
    },
    value: {
      type: String,
      required: true,
    },
    at: {
      type: Date,
      required: true,
    },
  },
  { _id: false }
);

export interface FollowUpTaskDocument {
  _id: Types.ObjectId;
  referralId: Types.ObjectId | null;
  agentId: Types.ObjectId | null;
  scope: FollowUpTaskScope;
  type: FollowUpTaskType;
  title: string;
  message: string;
  category: FollowUpTaskCategory;
  dueAt: Date;
  status: FollowUpTaskStatus;
  completedAt: Date | null;
  completedByUserId: Types.ObjectId | null;
  source: FollowUpTaskSource;
  ruleId: string | null;
  statusWhenCreated: string | null;
  anchor: TaskAnchor | null;
  createdAt: Date;
  updatedAt: Date;
}

// Lean version for queries (plain object without Mongoose methods)
export interface FollowUpTaskLean {
  _id: Types.ObjectId;
  referralId: Types.ObjectId | null;
  agentId: Types.ObjectId | null;
  scope: FollowUpTaskScope;
  type: FollowUpTaskType;
  title: string;
  message: string;
  category: FollowUpTaskCategory;
  dueAt: Date;
  status: FollowUpTaskStatus;
  completedAt: Date | null;
  completedByUserId: Types.ObjectId | null;
  source: FollowUpTaskSource;
  ruleId: string | null;
  statusWhenCreated: string | null;
  anchor: TaskAnchor | null;
  createdAt: Date;
  updatedAt: Date;
}

// API response type with string IDs
export interface FollowUpTaskResponse {
  _id: string;
  referralId: string | null;
  agentId: string | null;
  scope: FollowUpTaskScope;
  type: FollowUpTaskType;
  title: string;
  message: string;
  category: FollowUpTaskCategory;
  dueAt: string;
  status: FollowUpTaskStatus;
  completedAt: string | null;
  completedByUserId: string | null;
  source: FollowUpTaskSource;
  ruleId: string | null;
  statusWhenCreated: string | null;
  anchor: TaskAnchor | null;
  createdAt: string;
  updatedAt: string;
}

const followUpTaskSchema = new Schema<FollowUpTaskDocument>(
  {
    referralId: {
      type: Schema.Types.ObjectId,
      ref: 'Referral',
      default: null,
      index: true,
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      default: null,
      index: true,
    },
    scope: {
      type: String,
      enum: ['referral', 'agent'],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['Task', 'Call', 'Email', 'Text', 'Auto-Email'],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: ['ops', 'communication', 'pipeline', 'finance'],
      required: true,
    },
    dueAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'completed', 'archived'],
      default: 'open',
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    completedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    source: {
      type: String,
      enum: ['static', 'manual'],
      required: true,
    },
    ruleId: {
      type: String,
      default: null,
      sparse: true,
    },
    statusWhenCreated: {
      type: String,
      default: null,
    },
    anchor: {
      type: taskAnchorSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique index for static referral tasks: prevents duplicate tasks for the same rule on a referral
followUpTaskSchema.index(
  { scope: 1, ruleId: 1, referralId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      scope: 'referral',
      ruleId: { $ne: null },
      source: 'static',
    },
  }
);

// Unique index for static agent tasks: prevents duplicate tasks for the same rule on an agent
followUpTaskSchema.index(
  { scope: 1, ruleId: 1, agentId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      scope: 'agent',
      ruleId: { $ne: null },
      source: 'static',
    },
  }
);

// Compound index for querying referral tasks by status and due date
followUpTaskSchema.index({ referralId: 1, status: 1, dueAt: 1 });

// Compound index for querying agent tasks by status and due date
followUpTaskSchema.index({ agentId: 1, status: 1, dueAt: 1 });

// Compound index for Task Board queries (all open tasks sorted by due date)
followUpTaskSchema.index({ status: 1, dueAt: 1 });

// Helper to convert document to API response format
export function toFollowUpTaskResponse(task: FollowUpTaskLean): FollowUpTaskResponse {
  return {
    _id: task._id.toString(),
    referralId: task.referralId?.toString() ?? null,
    agentId: task.agentId?.toString() ?? null,
    scope: task.scope,
    type: task.type,
    title: task.title,
    message: task.message,
    category: task.category,
    dueAt: task.dueAt.toISOString(),
    status: task.status,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedByUserId: task.completedByUserId?.toString() ?? null,
    source: task.source,
    ruleId: task.ruleId,
    statusWhenCreated: task.statusWhenCreated,
    anchor: task.anchor,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export const FollowUpTask =
  models.FollowUpTask || model<FollowUpTaskDocument>('FollowUpTask', followUpTaskSchema);
