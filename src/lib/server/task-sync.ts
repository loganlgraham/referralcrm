/**
 * Task Sync Functions
 *
 * Deterministic upsert functions that create tasks based on rules.
 * Key behaviors:
 * - Only creates missing tasks (never deletes)
 * - Never resets completion status on existing tasks
 * - Uses ruleId uniqueness to prevent duplicates
 */

import { Types } from 'mongoose';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTask } from '@/models/follow-up-task';
import { Referral, type ReferralDocument } from '@/models/referral';
import { Agent } from '@/models/agent';
import type { ReferralTimeline } from '@/constants/referrals';
import {
  getTaskRulesForStatus,
  calculateDueDate,
  AGENT_ONBOARDING_TASKS,
  type TaskRuleDefinition,
} from './task-rules';

interface SyncResult {
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Sync tasks for a referral based on its current status and conditions.
 *
 * This function:
 * - Gets applicable task rules for the referral's current status
 * - Upserts tasks using $setOnInsert to never overwrite existing tasks
 * - Never deletes tasks or resets completion status
 *
 * @param referralId - The referral ID (string or ObjectId)
 */
export async function syncReferralTasks(referralId: string | Types.ObjectId): Promise<SyncResult> {
  await connectMongo();

  const result: SyncResult = { created: 0, skipped: 0, errors: [] };

  // Convert string to ObjectId if needed
  const refId = typeof referralId === 'string' ? new Types.ObjectId(referralId) : referralId;

  // Fetch the referral with populated agent references to check for OOS agents
  const referral = await Referral.findById(refId)
    .populate<{ assignedAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null } }>('assignedAgent', 'ahaDesignation')
    .populate<{ buySideAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null } }>('buySideAgent', 'ahaDesignation')
    .populate<{ sellSideAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null } }>('sellSideAgent', 'ahaDesignation')
    .lean<ReferralDocument & {
      assignedAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null };
      buySideAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null };
      sellSideAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null };
    }>();

  if (!referral) {
    result.errors.push(`Referral not found: ${referralId}`);
    return result;
  }

  const status = referral.status;
  const ahaBucket = referral.ahaBucket ?? null;
  const timeline = (referral.timeline as ReferralTimeline) ?? null;

  // Compute hasAhaOosAgentAttached: check if any attached agent has ahaDesignation === 'AHA_OOS'
  const hasAhaOosAgentAttached = Boolean(
    (referral.assignedAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.buySideAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.sellSideAgent as any)?.ahaDesignation === 'AHA_OOS'
  );

  // Get status change date (use statusLastUpdated or createdAt as fallback)
  const statusBaseDate = referral.statusLastUpdated ?? referral.createdAt ?? new Date();

  // Get applicable task rules for this status and conditions
  const rules = getTaskRulesForStatus(status, { ahaBucket, timeline, hasAhaOosAgentAttached });

  // Upsert each task
  for (const rule of rules) {
    try {
      const dueAt = calculateDueDate(new Date(statusBaseDate), rule.dueOffset);

      // Use updateOne with upsert and $setOnInsert to only set fields on insert
      // This ensures we never overwrite existing tasks (especially completion status)
      const updateResult = await FollowUpTask.updateOne(
        {
          scope: 'referral',
          ruleId: rule.ruleId,
          referralId: refId,
        },
        {
          $setOnInsert: {
            referralId: refId,
            agentId: null,
            scope: 'referral',
            type: rule.type,
            title: rule.title,
            message: rule.message,
            category: rule.category,
            dueAt,
            status: 'open',
            completedAt: null,
            completedByUserId: null,
            source: 'static',
            ruleId: rule.ruleId,
            statusWhenCreated: status,
          },
        },
        { upsert: true }
      );

      if (updateResult.upsertedCount > 0) {
        result.created++;
      } else {
        result.skipped++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to upsert task ${rule.ruleId}: ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Sync onboarding tasks for a new agent.
 *
 * This function:
 * - Creates the standard agent onboarding tasks
 * - Uses $setOnInsert to never overwrite existing tasks
 * - Never deletes tasks or resets completion status
 *
 * @param agentId - The agent ID (string or ObjectId)
 */
export async function syncAgentOnboardingTasks(agentId: string | Types.ObjectId): Promise<SyncResult> {
  await connectMongo();

  const result: SyncResult = { created: 0, skipped: 0, errors: [] };

  // Convert string to ObjectId if needed
  const agtId = typeof agentId === 'string' ? new Types.ObjectId(agentId) : agentId;

  // Fetch the agent to get createdAt date
  const agent = await Agent.findById(agtId).lean<{ _id: Types.ObjectId; createdAt?: Date }>();

  if (!agent) {
    result.errors.push(`Agent not found: ${agentId}`);
    return result;
  }

  const baseDate = agent.createdAt ?? new Date();

  // Upsert each onboarding task
  for (const rule of AGENT_ONBOARDING_TASKS) {
    try {
      const dueAt = calculateDueDate(new Date(baseDate), rule.dueOffset);

      const updateResult = await FollowUpTask.updateOne(
        {
          scope: 'agent',
          ruleId: rule.ruleId,
          agentId: agtId,
        },
        {
          $setOnInsert: {
            referralId: null,
            agentId: agtId,
            scope: 'agent',
            type: rule.type,
            title: rule.title,
            message: rule.message,
            category: rule.category,
            dueAt,
            status: 'open',
            completedAt: null,
            completedByUserId: null,
            source: 'static',
            ruleId: rule.ruleId,
            statusWhenCreated: null,
          },
        },
        { upsert: true }
      );

      if (updateResult.upsertedCount > 0) {
        result.created++;
      } else {
        result.skipped++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to upsert agent task ${rule.ruleId}: ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Sync tasks for multiple referrals (batch operation).
 * Useful for migration or bulk updates.
 *
 * @param referralIds - Array of referral IDs
 */
export async function syncReferralTasksBatch(referralIds: (string | Types.ObjectId)[]): Promise<{
  total: number;
  results: Map<string, SyncResult>;
}> {
  const results = new Map<string, SyncResult>();

  for (const referralId of referralIds) {
    const idStr = referralId.toString();
    const result = await syncReferralTasks(referralId);
    results.set(idStr, result);
  }

  return {
    total: referralIds.length,
    results,
  };
}

/**
 * Sync tasks for multiple agents (batch operation).
 * Useful for migration or bulk updates.
 *
 * @param agentIds - Array of agent IDs
 */
export async function syncAgentTasksBatch(agentIds: (string | Types.ObjectId)[]): Promise<{
  total: number;
  results: Map<string, SyncResult>;
}> {
  const results = new Map<string, SyncResult>();

  for (const agentId of agentIds) {
    const idStr = agentId.toString();
    const result = await syncAgentOnboardingTasks(agentId);
    results.set(idStr, result);
  }

  return {
    total: agentIds.length,
    results,
  };
}
