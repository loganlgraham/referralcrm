'use client';

import { useMemo, useEffect } from 'react';

import type { ReferralLike } from '@/utils/sla-insights';
import { getStaticFollowUpTasksForReferral } from '@/lib/server/static-follow-up-tasks';
import type { SlaRecommendation } from '@/utils/sla-insights';

import { useFollowUpTaskContext, type ManualTask, type TaskMetadata } from './follow-up-task-provider';

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

export interface FollowUpTask extends SlaRecommendation {
  taskId: string;
  referralId: string;
  referralName?: string;
  completed: boolean;
  toggle: () => void;
  isManual?: boolean;
  isHistorical?: boolean;
  statusWhenCreated?: string;
  remove?: () => void;
  role: FollowUpTaskRole;
}

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

// All static tasks are admin-only tasks (for AHA OOS referrals)
// This ensures only admin users see these tasks, not agents or MCs
const resolveTaskRole = (_recommendationId: string): FollowUpTaskRole => {
  return 'admin';
};

export function buildFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } },
  {
    completions,
    manualTasks,
    shownTasks,
    taskMetadata,
    toggleTask,
    removeManualTask,
    markTasksAsShown,
    storeTaskMetadata,
    viewerRole,
  }: {
    completions: Record<string, { completed: boolean; completedAt?: string | null }>;
    manualTasks: Record<string, ManualTask[]>;
    shownTasks: Record<string, string[]>;
    taskMetadata: Record<string, TaskMetadata>;
    toggleTask: (taskId: string, completed: boolean) => void;
    removeManualTask: (referralId: string, taskId: string) => void;
    markTasksAsShown: (referralId: string, taskIds: string[]) => void;
    storeTaskMetadata: (tasks: Array<{ taskId: string; metadata: TaskMetadata }>) => void;
    viewerRole: FollowUpTaskRole;
  }
) {
  // Get static tasks for this referral
  const staticTasks = getStaticFollowUpTasksForReferral(referral);
  const manual = manualTasks[referral._id] ?? [];

  const manualFollowUps = manual
    .map<FollowUpTask>((task) => {
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

  // All static tasks are marked as 'admin' role, so they will only be visible to admin users
  const automated = staticTasks
    .map<FollowUpTask>((item) => {
      const role = resolveTaskRole(item.id); // Always returns 'admin'
      const taskId = `${referral._id}::${item.id}`;
      const completion = completions[taskId]?.completed ?? false;
      const handleToggle = () => {
        toggleTask(taskId, !completion);
      };

      return {
        id: item.id,
        title: item.title,
        message: item.message,
        priority: item.priority,
        category: item.category,
        dueAt: item.dueAt ?? undefined,
        supportingMetric: item.supportingMetric,
        taskId,
        referralId: referral._id,
        referralName: referral.borrower?.name,
        completed: completion,
        toggle: handleToggle,
        role,
      };
    })
    .filter((task) => task.role === viewerRole); // Filter: only show tasks matching viewerRole (admin only)

  const visibleManualTasks = manualFollowUps.filter((task) => task.role === viewerRole);

  // Combine current tasks
  const currentTasks = [...visibleManualTasks, ...automated];
  const currentTaskIds = new Set(currentTasks.map((t) => t.id));

  // Find historical tasks that should still be shown
  const previouslyShownTaskIds = shownTasks[referral._id] ?? [];
  const historicalTasks: FollowUpTask[] = [];

  for (const taskId of previouslyShownTaskIds) {
    // Skip if task is in current task list
    if (currentTaskIds.has(taskId)) {
      continue;
    }

    // Get full task ID for lookup
    const fullTaskId = `${referral._id}::${taskId}`;
    const manualFullTaskId = `${referral._id}::manual::${taskId}`;
    
    // Check if task is completed
    const isCompleted = completions[fullTaskId]?.completed || completions[manualFullTaskId]?.completed || false;
    
    // Only include incomplete historical tasks
    if (isCompleted) {
      continue;
    }

    // Get task metadata
    const metadata = taskMetadata[fullTaskId] || taskMetadata[manualFullTaskId];
    if (!metadata) {
      continue; // Skip if no metadata found
    }

    const historicalTaskId = metadata.isManual ? manualFullTaskId : fullTaskId;
    const handleToggle = () => {
      toggleTask(historicalTaskId, !isCompleted);
    };

    historicalTasks.push({
      id: taskId,
      taskId: historicalTaskId,
      referralId: referral._id,
      referralName: referral.borrower?.name,
      title: metadata.title,
      message: metadata.message,
      priority: metadata.priority,
      category: metadata.category,
      dueAt: metadata.dueAt,
      supportingMetric: metadata.supportingMetric,
      completed: isCompleted,
      toggle: handleToggle,
      isManual: metadata.isManual,
      isHistorical: true,
      statusWhenCreated: metadata.statusWhenCreated,
      role: viewerRole, // Use viewer role for historical tasks
    });
  }

  // Combine current and historical tasks
  const allTasks = [...currentTasks, ...historicalTasks];

  return {
    tasks: allTasks,
    currentTasks,
    referralId: referral._id,
    referralStatus: referral.status,
  };
}

export function useFollowUpTasks(
  referral: ReferralLike & { borrower?: { name?: string } },
  viewerRole: FollowUpTaskRole = 'admin'
) {
  const { 
    completions, 
    toggleTask, 
    manualTasks, 
    removeManualTask,
    shownTasks,
    taskMetadata,
    markTasksAsShown,
    storeTaskMetadata,
    loadReferralStates,
  } = useFollowUpTaskContext();

  const result = useMemo(
    () =>
      buildFollowUpTasksForReferral(referral, {
        completions,
        manualTasks,
        shownTasks,
        taskMetadata,
        toggleTask,
        removeManualTask,
        markTasksAsShown,
        storeTaskMetadata,
        viewerRole,
      }),
    [completions, manualTasks, shownTasks, taskMetadata, referral, removeManualTask, toggleTask, markTasksAsShown, storeTaskMetadata, viewerRole]
  );

  const taskIdsKey = useMemo(() => result.tasks.map((task) => task.id).join('|'), [result.tasks]);

  useEffect(() => {
    loadReferralStates([referral._id]);
  }, [loadReferralStates, referral._id]);

  // Side effects: Mark tasks as shown and store metadata
  useEffect(() => {
    const { tasks, currentTasks, referralId, referralStatus } = result;
    
    // Mark all task IDs as shown
    const allTaskIds = tasks.map((t) => t.id);
    const existingShownTasks = shownTasks[referralId] || [];
    
    // Only update if there are new task IDs
    const hasNewTasks = allTaskIds.some(id => !existingShownTasks.includes(id));
    if (hasNewTasks) {
      markTasksAsShown(referralId, allTaskIds);
    }

    // Store metadata for new tasks (only those not already in metadata)
    const metadataToStore = currentTasks
      .filter((task) => {
        const fullTaskId = task.taskId;
        return !taskMetadata[fullTaskId];
      })
      .map((task) => ({
        taskId: task.taskId,
        metadata: {
          title: task.title,
          message: task.message,
          priority: task.priority,
          category: task.category,
          dueAt: task.dueAt,
          supportingMetric: task.supportingMetric,
          isManual: task.isManual,
          createdAt: new Date().toISOString(),
          statusWhenCreated: referralStatus,
        },
      }));

    if (metadataToStore.length > 0) {
      storeTaskMetadata(metadataToStore);
    }
  }, [result, shownTasks, taskMetadata, markTasksAsShown, storeTaskMetadata, viewerRole, taskIdsKey]);

  return result.tasks;
}
