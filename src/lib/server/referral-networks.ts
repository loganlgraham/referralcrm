import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { referralAgentSlotId } from '@/lib/referral-agent-slot';
import {
  getReferralDesignation,
  type NetworkDesignation,
  type ReferralAgentSlots,
} from '@/lib/server/referral-designation';
import { Agent } from '@/models/agent';

export interface ReferralNetworkSource {
  _id: unknown;
  assignedAgent?: unknown;
  buySideAgent?: unknown;
  sellSideAgent?: unknown;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  org?: string | null;
}

function referralDocumentId(id: unknown): string {
  if (id != null && typeof id === 'object' && 'toString' in id && typeof id.toString === 'function') {
    return id.toString();
  }
  return String(id);
}

function toAgentSlot(id: string | null): { toString(): string } | null {
  if (!id) return null;
  return { toString: () => id };
}

function toReferralAgentSlots(referral: ReferralNetworkSource): ReferralAgentSlots {
  return {
    assignedAgent: toAgentSlot(referralAgentSlotId(referral.assignedAgent)),
    buySideAgent: toAgentSlot(referralAgentSlotId(referral.buySideAgent)),
    sellSideAgent: toAgentSlot(referralAgentSlotId(referral.sellSideAgent)),
    ahaBucket: referral.ahaBucket,
    org: referral.org,
  };
}

export async function loadReferralDesignationMap(
  referrals: readonly ReferralNetworkSource[]
): Promise<Map<string, NetworkDesignation | null>> {
  await connectMongo();

  const agentIds = new Set<string>();
  for (const referral of referrals) {
    for (const slot of [referral.assignedAgent, referral.buySideAgent, referral.sellSideAgent]) {
      const id = referralAgentSlotId(slot);
      if (id) agentIds.add(id);
    }
  }

  const designationByAgent = new Map<string, NetworkDesignation | null>();
  if (agentIds.size > 0) {
    const agents = await Agent.find({
      _id: { $in: [...agentIds].map((id) => new Types.ObjectId(id)) },
    })
      .select('ahaDesignation')
      .lean<Array<{ _id: { toString(): string }; ahaDesignation?: NetworkDesignation | null }>>();

    for (const agent of agents) {
      designationByAgent.set(agent._id.toString(), agent.ahaDesignation ?? null);
    }
  }

  const byReferral = new Map<string, NetworkDesignation | null>();
  for (const referral of referrals) {
    byReferral.set(
      referralDocumentId(referral._id),
      getReferralDesignation(toReferralAgentSlots(referral), designationByAgent)
    );
  }
  return byReferral;
}
