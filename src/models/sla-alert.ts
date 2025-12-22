import { Schema, model, models, Types } from 'mongoose';

import { type RecommendationPriority } from '@/utils/sla-insights';

export type SlaAlertStatus = 'open' | 'resolved';

const referralSnapshotSchema = new Schema(
  {
    borrowerName: { type: String, default: null },
    referralStatus: { type: String, default: null },
    org: { type: String, default: null },
    ahaBucket: { type: String, default: null },
    assignedAgentName: { type: String, default: null },
    lenderName: { type: String, default: null },
    lookingInZip: { type: String, default: null },
  },
  { _id: false }
);

const slaAlertSchema = new Schema(
  {
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
    recommendationId: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    priority: { type: String, enum: ['urgent', 'high', 'medium', 'low'], required: true },
    category: { type: String, required: true },
    supportingMetric: { type: String, default: null },
    dueAt: { type: Date, default: null },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    firstDetectedAt: { type: Date, default: Date.now },
    lastEvaluatedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    lastNotifiedAt: { type: Date, default: null },
    referralSnapshot: { type: referralSnapshotSchema, default: () => ({}) },
  },
  { timestamps: true }
);

slaAlertSchema.index({ referralId: 1, recommendationId: 1 }, { unique: true });
slaAlertSchema.index({ status: 1, priority: 1, dueAt: 1 });

export interface SlaAlertDocument {
  _id: Types.ObjectId;
  referralId: Types.ObjectId;
  recommendationId: string;
  title: string;
  message: string;
  priority: RecommendationPriority;
  category: string;
  supportingMetric?: string | null;
  dueAt?: Date | null;
  status: SlaAlertStatus;
  firstDetectedAt?: Date;
  lastEvaluatedAt?: Date;
  resolvedAt?: Date | null;
  lastNotifiedAt?: Date | null;
  referralSnapshot?: {
    borrowerName?: string | null;
    referralStatus?: string | null;
    org?: string | null;
    ahaBucket?: string | null;
    assignedAgentName?: string | null;
    lenderName?: string | null;
    lookingInZip?: string | null;
  } | null;
}

export const SlaAlert = models.SlaAlert || model<SlaAlertDocument>('SlaAlert', slaAlertSchema);
