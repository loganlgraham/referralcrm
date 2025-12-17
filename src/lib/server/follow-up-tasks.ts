import {
  computeSlaInsights,
  sortRecommendations,
  type SlaRecommendation,
  type ReferralLike,
} from '@/utils/sla-insights';

export type FollowUpTaskRole = 'admin' | 'mc' | 'agent';

const AGENT_OWNED_TASK_IDS = new Set<string>([
  'schedule-first-showings',
  'buyers-agency-agreement',
  'schedule-listing-consult',
  'listing-paperwork',
  'prep-listing',
  'prep-photos',
  'target-list-date',
  'review-conversion-plan',
  'review-conversion-plan-agent',
  'schedule-inspection',
  'schedule-inspection-agent',
  'order-appraisal',
  'order-appraisal-agent',
  'share-closing-timeline',
  'share-closing-timeline-agent',
  'check-escrow-milestones',
  'check-escrow-milestones-agent',
  'confirm-referral-fee',
  'confirm-referral-fee-agent',
  'capture-termination-reason',
  'capture-termination-reason-agent',
]);

function resolveTaskRole(recommendationId: string): FollowUpTaskRole {
  if (recommendationId.startsWith('mc-')) {
    return 'mc';
  }

  if (recommendationId.endsWith('-agent') || AGENT_OWNED_TASK_IDS.has(recommendationId)) {
    return 'agent';
  }

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
 */
export function computeFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } },
  viewerRole: FollowUpTaskRole
): ServerFollowUpTask[] {
  // Compute tasks fresh - no completion state needed since we're computing from scratch
  const insights = computeSlaInsights(referral);
  const ordered = sortRecommendations(insights.recommendations);

  const tasks = ordered
    .map<ServerFollowUpTask>((item) => {
      const role = resolveTaskRole(item.id);
      const taskId = `${referral._id}::${item.id}`;

      return {
        taskId,
        referralId: referral._id,
        referralName: referral.borrower?.name,
        title: item.title,
        message: item.message,
        priority: item.priority,
        category: item.category,
        dueAt: item.dueAt ?? null,
        supportingMetric: item.supportingMetric,
        role,
      };
    })
    .filter((task) => task.role === viewerRole);

  return tasks;
}

