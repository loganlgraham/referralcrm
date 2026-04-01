import { Schema, model, models, Types } from 'mongoose';
export {
  getEffectiveDueDate,
  getTaskResolvedAt,
  wasTaskResolvedOnOrBeforeDueDate,
  type AdminTaskTimingFields
} from '@/lib/admin-task-timeliness';

export type AdminTaskStatus = 'open' | 'completed' | 'dismissed';

export type AdminTaskCategory = 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';

export type AdminTaskPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface AdminTaskDocument {
  _id: Types.ObjectId;
  referralId: Types.ObjectId;
  title: string;
  description?: string;
  category?: AdminTaskCategory;
  priority?: AdminTaskPriority;
  status: AdminTaskStatus;
  dueAt?: Date;
  dueAtOverride?: Date;
  snoozedUntil?: Date;
  ruleKey?: string | null;
  cycleKey: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy?: string;
  completedAt?: Date;
  completedBy?: string;
  dismissedAt?: Date;
  dismissedBy?: string;
}

export interface AdminTaskLean extends AdminTaskDocument {
  _id: Types.ObjectId;
}

const adminTaskSchema = new Schema<AdminTaskDocument>(
  {
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: undefined },
    category: {
      type: String,
      enum: ['assignment', 'communication', 'pipeline', 'finance', 'ops'],
      default: undefined,
    },
    priority: {
      type: String,
      enum: ['urgent', 'high', 'medium', 'low'],
      default: undefined,
    },
    status: {
      type: String,
      enum: ['open', 'completed', 'dismissed'],
      required: true,
      default: 'open',
    },
    dueAt: { type: Date, default: undefined },
    dueAtOverride: { type: Date, default: undefined },
    snoozedUntil: { type: Date, default: undefined },
    ruleKey: { type: String, default: null },
    cycleKey: { type: String, required: true },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, default: undefined },
    completedAt: { type: Date, default: undefined },
    completedBy: { type: String, default: undefined },
    dismissedAt: { type: Date, default: undefined },
    dismissedBy: { type: String, default: undefined },
  },
  { timestamps: true }
);

adminTaskSchema.index({ referralId: 1, status: 1 });
adminTaskSchema.index({ status: 1, dueAt: 1 });
adminTaskSchema.index(
  { referralId: 1, ruleKey: 1, cycleKey: 1 },
  {
    unique: true,
    partialFilterExpression: { ruleKey: { $exists: true, $ne: null } },
  }
);

export const AdminTask =
  models.AdminTask || model<AdminTaskDocument>('AdminTask', adminTaskSchema);
