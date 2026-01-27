import { addDays, addMonths, isAfter, isBefore, startOfDay } from 'date-fns';
import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';

import { STATIC_FOLLOW_UP_TASKS, type StaticTaskDefinition } from '@/constants/static-follow-up-tasks';
import { normalizeReferralStatus, type ReferralTimeline } from '@/constants/referrals';
import type { ReferralLike } from '@/utils/sla-insights';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

export type RecommendationPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface StaticFollowUpTask {
  id: string;
  title: string;
  message: string;
  priority: RecommendationPriority;
  category: 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';
  dueAt?: string | null;
  supportingMetric?: string;
}

/**
 * Calculate due date from statusLastUpdated + offset
 */
function calculateDueDate(
  statusLastUpdated: Date | string | null | undefined,
  createdAt: Date | string | undefined,
  offset: { days?: number; months?: number }
): Date | null {
  const baseDate = statusLastUpdated
    ? new Date(statusLastUpdated)
    : createdAt
      ? new Date(createdAt)
      : null;

  if (!baseDate || isNaN(baseDate.getTime())) {
    return null;
  }

  let dueDate = new Date(baseDate);

  if (offset.months) {
    dueDate = addMonths(dueDate, offset.months);
  }

  if (offset.days) {
    dueDate = addDays(dueDate, offset.days);
  }

  return dueDate;
}

/**
 * Format due date in MT timezone
 */
function formatDueDate(date: Date): string {
  return formatInTimeZone(date, SLA_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Determine task priority based on due date
 */
function calculatePriority(dueAt: Date | null, now: Date = new Date()): RecommendationPriority {
  if (!dueAt) {
    return 'medium';
  }

  // Normalize both dates to start of day in MT timezone
  const nowMT = zonedTimeToUtc(startOfDay(now), SLA_TIME_ZONE);
  const dueMT = zonedTimeToUtc(startOfDay(dueAt), SLA_TIME_ZONE);

  const daysUntilDue = Math.floor((dueMT.getTime() - nowMT.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) {
    return 'urgent'; // Overdue
  } else if (daysUntilDue <= 1) {
    return 'high'; // Due today or tomorrow
  } else if (daysUntilDue <= 3) {
    return 'medium'; // Due within 3 days
  } else {
    return 'low'; // Due later
  }
}

/**
 * Check if task conditions are met
 */
function meetsConditions(
  task: StaticTaskDefinition,
  referral: ReferralLike
): boolean {
  if (!task.conditions) {
    return true;
  }

  // Check timeline condition
  if (task.conditions.timeline && task.conditions.timeline.length > 0) {
    const referralTimeline = referral.timeline;
    if (!referralTimeline || !task.conditions.timeline.includes(referralTimeline)) {
      return false;
    }
  }

  // Check min status age
  if (task.conditions.minStatusAgeDays !== undefined) {
    const daysInStatus = referral.daysInStatus ?? 0;
    if (daysInStatus < task.conditions.minStatusAgeDays) {
      return false;
    }
  }

  return true;
}

// Deal statuses that should trigger "Closed" tasks
const CLOSED_DEAL_STATUSES = ['closed', 'payment_sent', 'paid'];

/**
 * Get static follow-up tasks for a referral based on its status
 * Only applies tasks to referrals with AHA OOS agents attached
 * NOTE: These tasks are ADMIN-ONLY and will be filtered by role in the calling functions
 * EXCEPTION: The 'assign-agent-status' task shows for ALL referrals (regardless of AHA designation)
 * EXCEPTION: "Closed" tasks are triggered by deal status (not referral status) and show for ALL referrals
 */
export function getStaticFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } }
): StaticFollowUpTask[] {
  const normalizedStatus = normalizeReferralStatus(referral.status);
  
  // Check if deal status indicates the deal is closed
  const isDealClosed = CLOSED_DEAL_STATUSES.includes(referral.dealStatus ?? '');
  
  // Determine the effective status for task lookup:
  // - If deal is closed, we want to include "Closed" tasks
  // - Otherwise, use the normalized referral status
  const effectiveStatusForTasks = isDealClosed ? 'Closed' : normalizedStatus;
  
  if (!effectiveStatusForTasks) {
    return [];
  }

  // Get tasks for the referral status (if any)
  const statusTasks = normalizedStatus ? (STATIC_FOLLOW_UP_TASKS[normalizedStatus] || []) : [];
  
  // Get "Closed" tasks if deal is closed (these are deal-status-driven, not referral-status-driven)
  const closedTasks = isDealClosed ? (STATIC_FOLLOW_UP_TASKS['Closed'] || []) : [];
  
  // Combine tasks, avoiding duplicates if referral status somehow equals 'Closed'
  const allStatusTasks = normalizedStatus === 'Closed' 
    ? statusTasks 
    : [...statusTasks, ...closedTasks];

  // Special case: 'New Lead' status has the 'assign-agent-status' task that applies to ALL referrals
  // regardless of AHA designation. For other statuses, require AHA_OOS attached agent.
  const hasAssignmentTask = allStatusTasks.some((task) => task.id === 'assign-agent-status');
  const isNewLeadStatus = normalizedStatus === 'New Lead';

  // If this is not New Lead status and doesn't have assignment task, and deal isn't closed,
  // require AHA_OOS agent
  if (!isNewLeadStatus && !hasAssignmentTask && !isDealClosed && !referral.hasAhaOosAgentAttached) {
    return [];
  }

  // Also check "Active Lead" tasks if status is "Showing Homes" (normalized to "Active Lead")
  const additionalTasks =
    normalizedStatus === 'Active Lead' && referral.status === 'Showing Homes'
      ? []
      : [];

  const allTasks = [...allStatusTasks, ...additionalTasks];

  const now = new Date();
  const tasks: StaticFollowUpTask[] = [];

  for (const taskDef of allTasks) {
    // Check if this is a "Closed" task (triggered by deal status)
    const isClosedTask = closedTasks.some((t) => t.id === taskDef.id);
    
    // Special gating for 'assign-agent-status' task
    if (taskDef.id === 'assign-agent-status') {
      // Show for ALL referrals (regardless of AHA designation) if agent or lender is missing
      const hasAgent = Boolean(referral.assignedAgent || referral.buySideAgent || referral.sellSideAgent);
      const hasLender = Boolean(referral.lender);
      if (hasAgent && hasLender) {
        continue; // Skip if both agent and lender are assigned
      }
      // If we reach here, agent or lender is missing - proceed to show the task
      // Skip all AHA designation checks below for this task
    } else if (isClosedTask) {
      // "Closed" tasks (from deal status) show for ALL referrals - no AHA requirement
      // Skip AHA designation checks for these tasks
    } else {
      // For all other tasks, check AHA designation requirements
      if (taskDef.ahaDesignation === 'AHA') {
        // For AHA-only tasks, require AHA designation (not AHA_OOS, not AGIT)
        if (!referral.hasAhaAgentAttached) {
          continue; // Skip this task if no AHA agent attached
        }
      } else if (taskDef.ahaDesignation === 'AHA_OOS') {
        // For AHA_OOS tasks, require AHA_OOS designation
        if (!referral.hasAhaOosAgentAttached) {
          continue; // Skip this task if no AHA_OOS agent attached
        }
      } else {
        // For tasks without designation, require AHA_OOS (existing default behavior)
        if (!referral.hasAhaOosAgentAttached) {
          continue; // Skip this task if no AHA_OOS agent attached
        }
      }
    }

    // Check conditions
    if (!meetsConditions(taskDef, referral)) {
      continue;
    }

    // Calculate due date
    const dueDate = calculateDueDate(
      referral.statusLastUpdated,
      referral.createdAt,
      taskDef.dueOffset
    );

    // Calculate priority
    const priority = calculatePriority(dueDate, now);

    // Format due date string
    const dueAt = dueDate ? formatDueDate(dueDate) : null;

    // Build supporting metric (using same timezone normalization)
    let supportingMetric: string | undefined;
    if (dueDate) {
      const nowMT = zonedTimeToUtc(startOfDay(now), SLA_TIME_ZONE);
      const dueMT = zonedTimeToUtc(startOfDay(dueDate), SLA_TIME_ZONE);
      const daysUntilDue = Math.floor((dueMT.getTime() - nowMT.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilDue < 0) {
        supportingMetric = `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'}`;
      } else if (daysUntilDue === 0) {
        supportingMetric = 'Due today';
      } else if (daysUntilDue === 1) {
        supportingMetric = 'Due tomorrow';
      } else {
        supportingMetric = `Due in ${daysUntilDue} days`;
      }
    }

    tasks.push({
      id: taskDef.id,
      title: taskDef.title,
      message: taskDef.messageTemplate, // Will be enhanced by OpenAI later
      priority,
      category: taskDef.category,
      dueAt,
      supportingMetric,
    });
  }

  return tasks;
}
