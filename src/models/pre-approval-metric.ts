import { Schema, model, models, Types } from 'mongoose';

const preApprovalMetricSchema = new Schema(
  {
    month: { type: Date, required: true, unique: true, index: true },
    preApprovals: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export interface PreApprovalMetricDocument {
  _id: Types.ObjectId;
  month: Date;
  preApprovals: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const PreApprovalMetric =
  models.PreApprovalMetric || model<PreApprovalMetricDocument>('PreApprovalMetric', preApprovalMetricSchema);
