import { Types } from 'mongoose';

import {
  AGENT_RECOMMENDATION_POLICY,
  type AgentRecommendation,
} from '@/lib/recommendations/agent-policy';
import type { AgentRecommendationResponse } from '@/lib/recommendations/agent-recommendation-response';
import { buildAgentRecommendations } from '@/lib/server/agent-recommendations';
import { logReferralActivity } from '@/lib/server/activities';
import { Referral } from '@/models/referral';

export type AutoSuggestEnv = {
  ALLOW_AGENT_AUTO_ASSIGN?: string | undefined;
  VERCEL_ENV?: string | undefined;
};

export type AgentSuggestionStatus = 'applied' | 'none' | 'skipped';

export type AgentSuggestionSnapshot = {
  agentId: Types.ObjectId | null;
  agentName: string | null;
  policyVersion: string;
  provisional: boolean;
  reasons: string[];
  status: AgentSuggestionStatus;
  skippedReason: string | null;
  updatedAt: Date;
};

export type AutoSuggestResult =
  | { outcome: 'applied'; agentId: string; agentName: string }
  | { outcome: 'none'; reason: string }
  | { outcome: 'skipped'; reason: string };

/** Hosted Vercel previews share production data — never persist auto-assign there. */
export function canPersistAutoAgentAssignment(env: AutoSuggestEnv = process.env as AutoSuggestEnv): boolean {
  if (env.VERCEL_ENV === 'preview') return false;
  return env.ALLOW_AGENT_AUTO_ASSIGN === 'true';
}

export function isValidAutoSuggestion(result: AgentRecommendationResponse): AgentRecommendation | null {
  if (result.state !== 'ready' || result.provisional) return null;
  const top = result.recommendations[0] ?? null;
  if (!top || !top.adequateHistory) return null;
  return top;
}

function suggestionSnapshot(input: {
  status: AgentSuggestionStatus;
  top?: AgentRecommendation | null;
  skippedReason?: string | null;
  provisional?: boolean;
}): AgentSuggestionSnapshot {
  return {
    agentId: input.top ? new Types.ObjectId(input.top.agentId) : null,
    agentName: input.top?.name ?? null,
    policyVersion: AGENT_RECOMMENDATION_POLICY.version,
    provisional: input.provisional ?? Boolean(input.top && !input.top.adequateHistory),
    reasons: input.top?.reasons.slice(0, 3) ?? [],
    status: input.status,
    skippedReason: input.skippedReason ?? null,
    updatedAt: new Date(),
  };
}

function hasAssignedAgent(referral: {
  assignedAgent?: Types.ObjectId | string | null;
  buySideAgent?: Types.ObjectId | string | null;
}): boolean {
  return Boolean(referral.assignedAgent || referral.buySideAgent);
}

/**
 * After AHA / AHA OOS intake: populate buy-side agent from the draft engine when
 * the fixture/local gate allows. Never overwrites an existing assignment.
 */
export async function applyIntakeAgentSuggestion(referralId: string): Promise<AutoSuggestResult> {
  if (!canPersistAutoAgentAssignment()) {
    return { outcome: 'skipped', reason: 'hosted_preview_or_gate_off' };
  }
  if (!Types.ObjectId.isValid(referralId)) {
    return { outcome: 'skipped', reason: 'invalid_id' };
  }

  const referral = await Referral.findById(referralId)
    .select('org ahaBucket lookingInZip lookingInZips lender assignedAgent buySideAgent sellSideAgent agentSelectionSource agentSuggestion createdAt')
    .lean<{
      _id: Types.ObjectId;
      org?: string | null;
      ahaBucket?: string | null;
      lookingInZip?: string | null;
      lookingInZips?: string[] | null;
      lender?: Types.ObjectId | string | null;
      assignedAgent?: Types.ObjectId | string | null;
      buySideAgent?: Types.ObjectId | string | null;
      sellSideAgent?: Types.ObjectId | string | null;
      agentSelectionSource?: 'auto' | 'manual' | null;
      createdAt?: Date;
    } | null>();

  if (!referral) return { outcome: 'skipped', reason: 'not_found' };
  if (referral.org !== 'AHA') return { outcome: 'skipped', reason: 'not_aha' };
  if (referral.ahaBucket !== 'AHA' && referral.ahaBucket !== 'AHA_OOS') {
    return { outcome: 'skipped', reason: 'no_bucket' };
  }
  if (hasAssignedAgent(referral)) {
    await Referral.updateOne(
      { _id: referral._id },
      {
        $set: {
          agentSuggestion: suggestionSnapshot({
            status: 'skipped',
            skippedReason: 'already_assigned',
          }),
        },
      },
    );
    return { outcome: 'skipped', reason: 'already_assigned' };
  }

  const ranked = await buildAgentRecommendations({
    referral: {
      _id: referral._id,
      org: referral.org,
      ahaBucket: referral.ahaBucket,
      lookingInZip: referral.lookingInZip,
      lookingInZips: referral.lookingInZips,
      lender: referral.lender,
    },
    mcOverride: undefined,
    zipOverride: null,
    fubPermitted: false,
  });

  const top = isValidAutoSuggestion(ranked);
  if (!top) {
    const noneSnapshot = suggestionSnapshot({
      status: 'none',
      provisional: ranked.provisional,
      skippedReason: ranked.state === 'ready' ? 'insufficient_evidence' : ranked.state,
    });
    await Referral.updateOne(
      { _id: referral._id, assignedAgent: null, buySideAgent: null },
      { $set: { agentSuggestion: noneSnapshot } },
    );
    return { outcome: 'none', reason: noneSnapshot.skippedReason ?? 'none' };
  }

  const applied = suggestionSnapshot({ status: 'applied', top });
  const updated = await Referral.findOneAndUpdate(
    {
      _id: referral._id,
      $or: [{ assignedAgent: null }, { assignedAgent: { $exists: false } }],
      $and: [{ $or: [{ buySideAgent: null }, { buySideAgent: { $exists: false } }] }],
    },
    {
      $set: {
        buySideAgent: new Types.ObjectId(top.agentId),
        assignedAgent: new Types.ObjectId(top.agentId),
        dealSide: 'buy',
        agentSelectionSource: 'auto',
        agentSuggestion: applied,
        'sla.timeToAssignmentHours': 0,
      },
      $push: {
        audit: {
          actorRole: 'system',
          field: 'buySideAgent',
          previousValue: null,
          newValue: top.agentId,
          timestamp: new Date(),
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    return { outcome: 'skipped', reason: 'already_assigned' };
  }

  await logReferralActivity({
    referralId: referral._id,
    actorRole: 'system',
    channel: 'update',
    content: `Auto-suggested buy agent ${top.name} from draft AHA recommendation policy.`,
  }).catch(() => undefined);

  return { outcome: 'applied', agentId: top.agentId, agentName: top.name };
}

/**
 * MC/ZIP changes may refresh the stored suggestion, but never silently change
 * an already selected agent (auto or manual).
 */
export async function refreshAgentSuggestion(referralId: string): Promise<AutoSuggestResult> {
  if (!Types.ObjectId.isValid(referralId)) {
    return { outcome: 'skipped', reason: 'invalid_id' };
  }

  const referral = await Referral.findById(referralId)
    .select('org ahaBucket lookingInZip lookingInZips lender assignedAgent buySideAgent agentSelectionSource')
    .lean<{
      _id: Types.ObjectId;
      org?: string | null;
      ahaBucket?: string | null;
      lookingInZip?: string | null;
      lookingInZips?: string[] | null;
      lender?: Types.ObjectId | string | null;
      assignedAgent?: Types.ObjectId | string | null;
      buySideAgent?: Types.ObjectId | string | null;
      agentSelectionSource?: 'auto' | 'manual' | null;
    } | null>();

  if (!referral) return { outcome: 'skipped', reason: 'not_found' };
  if (referral.org !== 'AHA') return { outcome: 'skipped', reason: 'not_aha' };
  if (referral.ahaBucket !== 'AHA' && referral.ahaBucket !== 'AHA_OOS') {
    return { outcome: 'skipped', reason: 'no_bucket' };
  }

  const ranked = await buildAgentRecommendations({
    referral: {
      _id: referral._id,
      org: referral.org,
      ahaBucket: referral.ahaBucket,
      lookingInZip: referral.lookingInZip,
      lookingInZips: referral.lookingInZips,
      lender: referral.lender,
    },
    mcOverride: undefined,
    zipOverride: null,
    fubPermitted: false,
  });

  const top = isValidAutoSuggestion(ranked);
  const assigned = hasAssignedAgent(referral);

  // Already selected (auto or manual): refresh suggestion metadata only.
  if (assigned) {
    await Referral.updateOne(
      { _id: referral._id },
      {
        $set: {
          agentSuggestion: suggestionSnapshot({
            status: 'skipped',
            top: top ?? undefined,
            provisional: ranked.provisional,
            skippedReason: 'already_assigned',
          }),
        },
      },
    );
    return { outcome: 'skipped', reason: 'already_assigned' };
  }

  // Empty slots: only auto-apply when the fixture/local gate allows.
  if (!canPersistAutoAgentAssignment()) {
    await Referral.updateOne(
      { _id: referral._id },
      {
        $set: {
          agentSuggestion: suggestionSnapshot({
            status: 'skipped',
            top: top ?? undefined,
            provisional: ranked.provisional,
            skippedReason: 'hosted_preview_or_gate_off',
          }),
        },
      },
    );
    return { outcome: 'skipped', reason: 'hosted_preview_or_gate_off' };
  }

  return applyIntakeAgentSuggestion(referralId);
}
