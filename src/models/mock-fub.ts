import { Schema, model, models, Types } from 'mongoose';

export const MOCK_FUB_STEP_NAMES = [
  'resolve_customer',
  'assign_agent',
  'populate_fields',
  'add_note',
] as const;

export type MockFubStepName = (typeof MOCK_FUB_STEP_NAMES)[number];
export type MockFubStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'ambiguous'
  | 'skipped';
export type MockFubAttemptStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial_failure'
  | 'ambiguous';

const mockFubStepSchema = new Schema(
  {
    name: { type: String, enum: MOCK_FUB_STEP_NAMES, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'succeeded', 'failed', 'ambiguous', 'skipped'],
      default: 'pending',
      required: true,
    },
    attempts: { type: Number, default: 0 },
    operationKey: { type: String, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    result: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const mockFubSendAttemptSchema = new Schema(
  {
    fixtureRunId: { type: String, required: true },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    approvalKey: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customerName: { type: String, required: true },
    selectedAgentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    selectedAgentName: { type: String, required: true },
    selectionSource: { type: String, enum: ['auto', 'manual'], required: true },
    fubUserId: { type: Number, required: true },
    personId: { type: Number, default: null },
    status: {
      type: String,
      enum: ['pending', 'running', 'success', 'partial_failure', 'ambiguous'],
      default: 'pending',
      required: true,
    },
    steps: { type: [mockFubStepSchema], default: [] },
    approvedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mockFubSendAttemptSchema.index({ fixtureRunId: 1, referralId: 1 }, { unique: true });

const mockFubNoteSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    body: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const mockFubPersonSchema = new Schema(
  {
    fixtureRunId: { type: String, required: true },
    personId: { type: Number, required: true },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    assignedUserId: { type: Number, default: null },
    fields: { type: Schema.Types.Mixed, default: {} },
    notes: { type: [mockFubNoteSchema], default: [] },
    operationKeys: { type: [String], default: [] },
  },
  { timestamps: true },
);

mockFubPersonSchema.index({ fixtureRunId: 1, personId: 1 }, { unique: true });
mockFubPersonSchema.index({ fixtureRunId: 1, referralId: 1 }, { unique: true });

export type MockFubStepRecord = {
  name: MockFubStepName;
  status: MockFubStepStatus;
  attempts: number;
  operationKey: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
};

export type MockFubSendAttemptRecord = {
  _id: Types.ObjectId;
  fixtureRunId: string;
  referralId: Types.ObjectId;
  approvalKey: string;
  actorId: Types.ObjectId;
  customerName: string;
  selectedAgentId: Types.ObjectId;
  selectedAgentName: string;
  selectionSource: 'auto' | 'manual';
  fubUserId: number;
  personId?: number | null;
  status: MockFubAttemptStatus;
  steps: MockFubStepRecord[];
  approvedAt: Date;
  completedAt?: Date | null;
};

export const MockFubSendAttempt =
  models.MockFubSendAttempt || model('MockFubSendAttempt', mockFubSendAttemptSchema);
export const FubSendAttempt = models.FubSendAttempt || model('FubSendAttempt', mockFubSendAttemptSchema.clone());
export const MockFubPerson = models.MockFubPerson || model('MockFubPerson', mockFubPersonSchema);
