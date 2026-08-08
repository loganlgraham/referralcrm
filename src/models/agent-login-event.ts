import { Schema, model, models } from 'mongoose';

const agentLoginEventSchema = new Schema(
  {
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loggedInAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true }
);

agentLoginEventSchema.index({ agentId: 1, loggedInAt: -1 });

export const AgentLoginEvent =
  models.AgentLoginEvent || model('AgentLoginEvent', agentLoginEventSchema);
