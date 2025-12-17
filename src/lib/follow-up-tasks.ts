import {
  computeSlaInsights,
  sortRecommendations,
  type RecommendationPriority,
  type ReferralLike,
  type SlaRecommendation,
} from '@/utils/sla-insights';

export type FollowUpTaskRole = 'admin' | 'mc' | 'agent';

export type ManualTaskCategory = 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';

export interface ManualTask {
  id: string;
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
  createdAt: string;
}

export interface ManualTaskInput {
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
}

export interface TaskCompletionState {
  completed: boolean;
  completedAt?: string | null;
}

export type CompletionMap = Record<string, TaskCompletionState>;

export interface FollowUpTask extends SlaRecommendation {
  taskId: string;
  referralId: string;
  referralName?: string;
  completed: boolean;
  toggle: () => void;
  isManual?: boolean;
  remove?: () => void;
  role: FollowUpTaskRole;
}

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

const resolveTaskRole = (recommendationId: string): FollowUpTaskRole => {
  if (recommendationId.startsWith('mc-')) {
    return 'mc';
  }

  if (recommendationId.endsWith('-agent') || AGENT_OWNED_TASK_IDS.has(recommendationId)) {
    return 'agent';
  }

  return 'admin';
};

export const getLatestCompletionForReferral = (
  referralId: string,
  completions: Record<string, { completed: boolean; completedAt?: string | null }>
): string | null => {
  const prefix = `${referralId}::`;
  const timestamps = Object.entries(completions)
    .filter(([taskId, state]) => taskId.startsWith(prefix) && state.completed && typeof state.completedAt === 'string')
    .map(([, state]) => state.completedAt as string);

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.reduce((latest, current) => (latest > current ? latest : current));
};

interface BuildFollowUpTaskParams {
  completions: CompletionMap;
  manualTasks: Record<string, ManualTask[]>;
  toggleTask: (taskId: string, completed: boolean) => void;
  removeManualTask: (referralId: string, taskId: string) => void;
  viewerRole: FollowUpTaskRole;
}

export function buildFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } },
  { completions, manualTasks, toggleTask, removeManualTask, viewerRole }: BuildFollowUpTaskParams
) {
  const lastCompletedAt = getLatestCompletionForReferral(referral._id, completions);
  const insights = computeSlaInsights(referral, { lastCompletedAt });
  const ordered = sortRecommendations(insights.recommendations);
  const manual = manualTasks[referral._id] ?? [];

  const manualFollowUps = manual.map<FollowUpTask>((task) => {
    const taskId = `${referral._id}::manual::${task.id}`;
    const completion = completions[taskId]?.completed ?? false;
    const handleToggle = () => {
      toggleTask(taskId, !completion);
    };
    const handleRemove = () => {
      removeManualTask(referral._id, task.id);
    };

    return {
      id: task.id,
      taskId,
      referralId: referral._id,
      referralName: referral.borrower?.name,
      title: task.title,
      message: task.message,
      priority: task.priority,
      category: task.category,
      dueAt: task.dueAt ?? undefined,
      completed: completion,
      toggle: handleToggle,
      isManual: true,
      remove: handleRemove,
      supportingMetric: undefined,
      role: viewerRole,
    };
  });

  const automated = ordered
    .map<FollowUpTask>((item) => {
      const role = resolveTaskRole(item.id);
      const taskId = `${referral._id}::${item.id}`;
      const completion = completions[taskId]?.completed ?? false;
      const handleToggle = () => {
        toggleTask(taskId, !completion);
      };

      return {
        ...item,
        taskId,
        referralId: referral._id,
        referralName: referral.borrower?.name,
        completed: completion,
        toggle: handleToggle,
        role,
      };
    })
    .filter((task) => task.role === viewerRole);

  const visibleManualTasks = manualFollowUps.filter((task) => task.role === viewerRole);

  return [...visibleManualTasks, ...automated];
}
