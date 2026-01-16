import { addDays, addMonths, isAfter, isBefore } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

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

  const daysUntilDue = Math.floor((dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

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

/**
 * Get static follow-up tasks for a referral based on its status
 * Only applies tasks to referrals with AHA OOS agents attached
 * NOTE: These tasks are ADMIN-ONLY and will be filtered by role in the calling functions
 */
export function getStaticFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } }
): StaticFollowUpTask[] {
  // Only apply tasks to referrals where any attached agent has ahaDesignation === 'AHA_OOS'
  if (!referral.hasAhaOosAgentAttached) {
    return [];
  }

  const normalizedStatus = normalizeReferralStatus(referral.status);
  if (!normalizedStatus) {
    return [];
  }

  // Get tasks for this status
  const statusTasks = STATIC_FOLLOW_UP_TASKS[normalizedStatus] || [];

  // Also check "Active Lead" tasks if status is "Showing Homes" (normalized to "Active Lead")
  const additionalTasks =
    normalizedStatus === 'Active Lead' && referral.status === 'Showing Homes'
      ? []
      : [];

  const allTasks = [...statusTasks, ...additionalTasks];

  const now = new Date();
  const tasks: StaticFollowUpTask[] = [];

  for (const taskDef of allTasks) {
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

    // Build supporting metric
    let supportingMetric: string | undefined;
    if (dueDate) {
      const daysUntilDue = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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
