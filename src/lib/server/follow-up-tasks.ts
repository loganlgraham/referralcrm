import type { ReferralLike } from '@/utils/sla-insights';
import { getStaticFollowUpTasksForReferral } from './static-follow-up-tasks';
import { enhanceTaskMessage } from './enhance-task-messages';

export type FollowUpTaskRole = 'admin' | 'mc' | 'agent';

// All static tasks are admin-only tasks (for AHA OOS referrals)
// This ensures only admin users see these tasks, not agents or MCs
function resolveTaskRole(_recommendationId: string): FollowUpTaskRole {
  return 'admin';
}

export interface ServerFollowUpTask {
  taskId: string;
  referralId: string;
  referralName?: string;
  title: string;
  message: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  category: 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';
  dueAt?: string | null;
  supportingMetric?: string;
  role: FollowUpTaskRole;
}

/**
 * Server-side function to compute follow-up tasks for a referral.
 * This version doesn't require completion state or manual tasks,
 * as those are stored client-side in localStorage.
 * Uses static task definitions instead of dynamic AI-generated tasks.
 */
export async function computeFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } },
  viewerRole: FollowUpTaskRole
): Promise<ServerFollowUpTask[]> {
  // Get static tasks for this referral
  const staticTasks = getStaticFollowUpTasksForReferral(referral);

  // Enhance messages with OpenAI (in parallel)
  const enhancedMessages = await Promise.all(
    staticTasks.map((task) =>
      enhanceTaskMessage({
        taskTitle: task.title,
        taskMessageTemplate: task.message,
        referral,
      })
    )
  );

  // Map to ServerFollowUpTask format
  // All static tasks are marked as 'admin' role, so they will only be visible to admin users
  const tasks = staticTasks
    .map<ServerFollowUpTask>((item, index) => {
      const role = resolveTaskRole(item.id); // Always returns 'admin'
      const taskId = `${referral._id}::${item.id}`;

      return {
        taskId,
        referralId: referral._id,
        referralName: referral.borrower?.name,
        title: item.title,
        message: enhancedMessages[index] || item.message, // Use enhanced message or fallback
        priority: item.priority,
        category: item.category,
        dueAt: item.dueAt ?? null,
        supportingMetric: item.supportingMetric,
        role,
      };
    })
    .filter((task) => task.role === viewerRole); // Filter: only show tasks matching viewerRole (admin only)

  return tasks;
}

