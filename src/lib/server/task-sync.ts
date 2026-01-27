/**
 * Task Sync Functions
 *
 * Deterministic task generation and reconciliation system.
 * Key behaviors:
 * - Only creates missing tasks (never deletes)
 * - Never resets completion status on existing tasks
 * - Archives tasks that no longer apply (e.g., wrong timeline set)
 * - Uses ruleId uniqueness to prevent duplicates
 * - Tracks anchor dates for proper due date calculation
 */

import { Types } from 'mongoose';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTask, type TaskAnchor } from '@/models/follow-up-task';
import { Referral, type ReferralDocument } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import type { ReferralTimeline } from '@/constants/referrals';
import {
  CREATED_TASKS,
  PAIRED_TASKS,
  IN_COMMUNICATION_SHORT_TASKS,
  IN_COMMUNICATION_LONG_TASKS,
  UNDER_CONTRACT_TASKS,
  DEAL_CLOSED_TASKS,
  AGENT_ONBOARDING_TASKS,
  getTaskRulesForStatus,
  calculateDueDate,
  isOOSReferral,
  isShortTimeline,
  isLongTimeline,
  type TaskRuleDefinition,
} from './task-rules';

export interface SyncResult {
  created: number;
  skipped: number;
  archived: number;
  errors: string[];
}

export interface ExpectedTask {
  ruleId: string;
  title: string;
  type: string;
  message: string;
  category: string;
  dueAt: Date;
  anchor: TaskAnchor;
  statusWhenCreated: string | null;
}

/**
 * Generate expected system tasks for a referral (pure function, no DB access).
 * 
 * @param referral - The referral document
 * @param deals - Array of Payment documents (deals) for this referral
 * @param now - Current timestamp
 * @returns Array of expected task definitions
 */
export function generateSystemTasks(
  referral: ReferralDocument & {
    assignedAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null };
    buySideAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null };
    sellSideAgent?: { ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null };
  },
  deals: Array<{ status: string; updatedAt: Date | string; _id?: Types.ObjectId | string }>,
  now: Date
): ExpectedTask[] {
  const tasks: ExpectedTask[] = [];
  const ahaBucket = referral.ahaBucket ?? null;
  const timeline = (referral.timeline as ReferralTimeline) ?? null;
  const status = referral.status;

  // Compute hasAhaOosAgentAttached
  const hasAhaOosAgentAttached = Boolean(
    (referral.assignedAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.buySideAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.sellSideAgent as any)?.ahaDesignation === 'AHA_OOS'
  );
  const isOOS = isOOSReferral(ahaBucket, hasAhaOosAgentAttached);

  // Find status transition dates from audit trail
  const audit = Array.isArray(referral.audit) ? referral.audit : [];
  const statusTransitions = new Map<string, Date>();
  
  // Find when each status was first reached
  for (const entry of audit) {
    if (entry?.field === 'status' && entry.newValue && entry.timestamp) {
      const statusValue = String(entry.newValue);
      if (!statusTransitions.has(statusValue)) {
        const timestamp = entry.timestamp instanceof Date 
          ? entry.timestamp 
          : new Date(entry.timestamp);
        if (!Number.isNaN(timestamp.getTime())) {
          statusTransitions.set(statusValue, timestamp);
        }
      }
    }
  }

  // Helper to get anchor date for a status
  const getStatusAnchorDate = (targetStatus: string): Date => {
    const transitionDate = statusTransitions.get(targetStatus);
    if (transitionDate) return transitionDate;
    
    // Fallback to statusLastUpdated if current status matches
    if (status === targetStatus && referral.statusLastUpdated) {
      const lastUpdated = referral.statusLastUpdated instanceof Date
        ? referral.statusLastUpdated
        : new Date(referral.statusLastUpdated);
      if (!Number.isNaN(lastUpdated.getTime())) {
        return lastUpdated;
      }
    }
    
    // Final fallback to createdAt
    const createdAt = referral.createdAt instanceof Date
      ? referral.createdAt
      : new Date(referral.createdAt ?? now);
    return Number.isNaN(createdAt.getTime()) ? now : createdAt;
  };

  // 1. CREATED_TASKS - Always created on referral creation (regardless of OOS)
  const createdAt = referral.createdAt instanceof Date
    ? referral.createdAt
    : new Date(referral.createdAt ?? now);
  const createdAnchorDate = Number.isNaN(createdAt.getTime()) ? now : createdAt;
  
  for (const rule of CREATED_TASKS) {
    if (!rule.oosOnly || isOOS) {
      const dueAt = calculateDueDate(createdAnchorDate, rule.dueOffset);
      tasks.push({
        ruleId: rule.ruleId,
        title: rule.title,
        type: rule.type,
        message: rule.message,
        category: rule.category,
        dueAt,
        anchor: {
          type: 'referral_created',
          value: 'created',
          at: createdAnchorDate,
        },
        statusWhenCreated: null,
      });
    }
  }

  // 2. Status-based tasks (only if OOS)
  if (isOOS) {
    // PAIRED tasks
    if (status === 'Paired' || statusTransitions.has('Paired')) {
      const pairedAnchorDate = getStatusAnchorDate('Paired');
      for (const rule of PAIRED_TASKS) {
        const dueAt = calculateDueDate(pairedAnchorDate, rule.dueOffset);
        tasks.push({
          ruleId: rule.ruleId,
          title: rule.title,
          type: rule.type,
          message: rule.message,
          category: rule.category,
          dueAt,
          anchor: {
            type: 'referral_status',
            value: 'Paired',
            at: pairedAnchorDate,
          },
          statusWhenCreated: 'Paired',
        });
      }
    }

    // IN COMMUNICATION tasks (timeline-dependent)
    if (status === 'In Communication' || statusTransitions.has('In Communication')) {
      const inCommAnchorDate = getStatusAnchorDate('In Communication');
      const shortTimeline = isShortTimeline(timeline);
      
      if (shortTimeline) {
        // Week 1/2/4/8 tasks for short timeline
        for (const rule of IN_COMMUNICATION_SHORT_TASKS) {
          const dueAt = calculateDueDate(inCommAnchorDate, rule.dueOffset);
          tasks.push({
            ruleId: rule.ruleId,
            title: rule.title,
            type: rule.type,
            message: rule.message,
            category: rule.category,
            dueAt,
            anchor: {
              type: 'referral_status',
              value: 'In Communication',
              at: inCommAnchorDate,
            },
            statusWhenCreated: 'In Communication',
          });
        }
      } else {
        // 30/60/90 day tasks for long timeline
        for (const rule of IN_COMMUNICATION_LONG_TASKS) {
          const dueAt = calculateDueDate(inCommAnchorDate, rule.dueOffset);
          tasks.push({
            ruleId: rule.ruleId,
            title: rule.title,
            type: rule.type,
            message: rule.message,
            category: rule.category,
            dueAt,
            anchor: {
              type: 'referral_status',
              value: 'In Communication',
              at: inCommAnchorDate,
            },
            statusWhenCreated: 'In Communication',
          });
        }
      }
    }

    // UNDER CONTRACT tasks
    if (status === 'Under Contract' || statusTransitions.has('Under Contract')) {
      const ucAnchorDate = getStatusAnchorDate('Under Contract');
      for (const rule of UNDER_CONTRACT_TASKS) {
        const dueAt = calculateDueDate(ucAnchorDate, rule.dueOffset);
        tasks.push({
          ruleId: rule.ruleId,
          title: rule.title,
          type: rule.type,
          message: rule.message,
          category: rule.category,
          dueAt,
          anchor: {
            type: 'referral_status',
            value: 'Under Contract',
            at: ucAnchorDate,
          },
          statusWhenCreated: 'Under Contract',
        });
      }
    }
  }

  // 3. DEAL_CLOSED tasks - triggered by deal status change to 'closed'
  for (const deal of deals) {
    if (deal.status === 'closed') {
      const dealUpdatedAt = deal.updatedAt instanceof Date
        ? deal.updatedAt
        : new Date(deal.updatedAt);
      const closedAnchorDate = Number.isNaN(dealUpdatedAt.getTime()) ? now : dealUpdatedAt;
      
      if (isOOS) {
        for (const rule of DEAL_CLOSED_TASKS) {
          const dueAt = calculateDueDate(closedAnchorDate, rule.dueOffset);
          // Use a unique ruleId per deal to allow multiple closed deals
          const dealId = (deal as any)._id instanceof Types.ObjectId 
            ? (deal as any)._id.toString() 
            : typeof (deal as any)._id === 'string'
            ? (deal as any)._id
            : 'unknown';
          const uniqueRuleId = `${rule.ruleId}::${dealId}`;
          tasks.push({
            ruleId: uniqueRuleId,
            title: rule.title,
            type: rule.type,
            message: rule.message,
            category: rule.category,
            dueAt,
            anchor: {
              type: 'deal_status',
              value: 'closed',
              at: closedAnchorDate,
            },
            statusWhenCreated: null,
          });
        }
      }
    }
  }

  return tasks;
}

/**
 * Reconcile system tasks for a referral.
 * 
 * This function:
 * 1. Fetches referral with deals and current tasks
 * 2. Generates expected task set
 * 3. Upserts missing tasks
 * 4. Archives tasks that no longer apply (e.g., wrong timeline set)
 * 5. Never deletes or resets completed tasks
 * 
 * @param referralId - The referral ID (string or ObjectId)
 * @param options - Optional reconciliation options
 */
export async function reconcileSystemTasks(
  referralId: string | Types.ObjectId,
  options: {
    statusChangedTo?: string;
    statusChangedAt?: Date;
    timelineChanged?: boolean;
  } = {}
): Promise<SyncResult> {
  await connectMongo();

  const result: SyncResult = { created: 0, skipped: 0, archived: 0, errors: [] };
  const refId = typeof referralId === 'string' ? new Types.ObjectId(referralId) : referralId;
  const now = new Date();

  // Fetch referral with populated agents
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

  // Fetch deals (payments) for this referral
  const deals = await Payment.find({ referralId: refId })
    .select('status updatedAt _id')
    .lean<Array<{ status: string; updatedAt: Date | string; _id: Types.ObjectId }>>();

  // Generate expected tasks
  const expectedTasks = generateSystemTasks(referral, deals, now);

  // Get current timeline to determine which tasks should be archived
  const timeline = (referral.timeline as ReferralTimeline) ?? null;
  const shortTimeline = isShortTimeline(timeline);
  const longTimeline = isLongTimeline(timeline);

  // Rule IDs for timeline-specific tasks
  const shortTimelineRuleIds = IN_COMMUNICATION_SHORT_TASKS.map((r) => r.ruleId);
  const longTimelineRuleIds = IN_COMMUNICATION_LONG_TASKS.map((r) => r.ruleId);

  // Archive wrong timeline tasks if in In Communication status
  if (referral.status === 'In Communication') {
    if (shortTimeline) {
      // Archive long timeline tasks (30/60/90 day)
      const archiveResult = await FollowUpTask.updateMany(
        {
          referralId: refId,
          ruleId: { $in: longTimelineRuleIds },
          status: 'open',
          source: 'static',
        },
        { $set: { status: 'archived' } }
      );
      result.archived += archiveResult.modifiedCount;
    } else if (longTimeline) {
      // Archive short timeline tasks (week 1/2/4/8)
      const archiveResult = await FollowUpTask.updateMany(
        {
          referralId: refId,
          ruleId: { $in: shortTimelineRuleIds },
          status: 'open',
          source: 'static',
        },
        { $set: { status: 'archived' } }
      );
      result.archived += archiveResult.modifiedCount;
    }
  }

  // Upsert expected tasks
  for (const expectedTask of expectedTasks) {
    try {
      const updateResult = await FollowUpTask.updateOne(
        {
          scope: 'referral',
          ruleId: expectedTask.ruleId,
          referralId: refId,
          source: 'static',
        },
        {
          $setOnInsert: {
            referralId: refId,
            agentId: null,
            scope: 'referral',
            type: expectedTask.type as any,
            title: expectedTask.title,
            message: expectedTask.message,
            category: expectedTask.category as any,
            dueAt: expectedTask.dueAt,
            status: 'open',
            completedAt: null,
            completedByUserId: null,
            source: 'static',
            ruleId: expectedTask.ruleId,
            statusWhenCreated: expectedTask.statusWhenCreated,
            anchor: expectedTask.anchor,
          },
          // Update anchor and dueAt if task exists but anchor changed
          $set: {
            anchor: expectedTask.anchor,
            dueAt: expectedTask.dueAt,
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
      result.errors.push(`Failed to upsert task ${expectedTask.ruleId}: ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Create deal-closed tasks when a deal status changes to 'closed'.
 * 
 * @param referralId - The referral ID
 * @param dealId - The deal (Payment) ID
 * @param closedAt - When the deal was closed
 */
export async function createDealClosedTasks(
  referralId: string | Types.ObjectId,
  dealId: string | Types.ObjectId,
  closedAt: Date
): Promise<SyncResult> {
  await connectMongo();

  const result: SyncResult = { created: 0, skipped: 0, archived: 0, errors: [] };
  const refId = typeof referralId === 'string' ? new Types.ObjectId(referralId) : referralId;
  const dealObjId = typeof dealId === 'string' ? new Types.ObjectId(dealId) : dealId;

  // Fetch referral to check OOS status
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

  const ahaBucket = referral.ahaBucket ?? null;
  const hasAhaOosAgentAttached = Boolean(
    (referral.assignedAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.buySideAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.sellSideAgent as any)?.ahaDesignation === 'AHA_OOS'
  );
  const isOOS = isOOSReferral(ahaBucket, hasAhaOosAgentAttached);

  if (!isOOS) {
    // Not OOS, skip
    return result;
  }

  // Create tasks for each DEAL_CLOSED rule
  for (const rule of DEAL_CLOSED_TASKS) {
    try {
      const dueAt = calculateDueDate(closedAt, rule.dueOffset);
      const uniqueRuleId = `${rule.ruleId}::${dealObjId.toString()}`;

      const updateResult = await FollowUpTask.updateOne(
        {
          scope: 'referral',
          ruleId: uniqueRuleId,
          referralId: refId,
          source: 'static',
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
            ruleId: uniqueRuleId,
            statusWhenCreated: null,
            anchor: {
              type: 'deal_status',
              value: 'closed',
              at: closedAt,
            },
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
      result.errors.push(`Failed to upsert deal-closed task ${rule.ruleId}: ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Sync onboarding tasks for a new agent.
 *
 * @param agentId - The agent ID (string or ObjectId)
 */
export async function syncAgentOnboardingTasks(agentId: string | Types.ObjectId): Promise<SyncResult> {
  await connectMongo();

  const result: SyncResult = { created: 0, skipped: 0, archived: 0, errors: [] };
  const agtId = typeof agentId === 'string' ? new Types.ObjectId(agentId) : agentId;

  const agent = await Agent.findById(agtId).lean<{ _id: Types.ObjectId; createdAt?: Date }>();

  if (!agent) {
    result.errors.push(`Agent not found: ${agentId}`);
    return result;
  }

  const baseDate = agent.createdAt ?? new Date();

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
            anchor: null,
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
 * Legacy function for backward compatibility.
 * Use reconcileSystemTasks() instead.
 */
export async function syncReferralTasks(referralId: string | Types.ObjectId): Promise<SyncResult> {
  return reconcileSystemTasks(referralId);
}

/**
 * Sync tasks for multiple referrals (batch operation).
 */
export async function syncReferralTasksBatch(referralIds: (string | Types.ObjectId)[]): Promise<{
  total: number;
  results: Map<string, SyncResult>;
}> {
  const results = new Map<string, SyncResult>();

  for (const referralId of referralIds) {
    const idStr = referralId.toString();
    const result = await reconcileSystemTasks(referralId);
    results.set(idStr, result);
  }

  return {
    total: referralIds.length,
    results,
  };
}

/**
 * Sync tasks for multiple agents (batch operation).
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
