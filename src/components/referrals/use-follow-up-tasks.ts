'use client';

import { useMemo } from 'react';

import type { ReferralLike } from '@/utils/sla-insights';
import { getStaticFollowUpTasksForReferral } from '@/lib/server/static-follow-up-tasks';
import type { SlaRecommendation } from '@/utils/sla-insights';

import { useFollowUpTaskContext, type ManualTask } from './follow-up-task-provider';

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
    toggleTask,
    removeManualTask,
    viewerRole,
  }: {
    completions: Record<string, { completed: boolean; completedAt?: string | null }>;
    manualTasks: Record<string, ManualTask[]>;
    toggleTask: (taskId: string, completed: boolean) => void;
    removeManualTask: (referralId: string, taskId: string) => void;
    viewerRole: FollowUpTaskRole;
  }
) {
  // Get static tasks for this referral
  const staticTasks = getStaticFollowUpTasksForReferral(referral);
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

  return [...visibleManualTasks, ...automated];
}

export function useFollowUpTasks(
  referral: ReferralLike & { borrower?: { name?: string } },
  viewerRole: FollowUpTaskRole = 'admin'
) {
  const { completions, toggleTask, manualTasks, removeManualTask } = useFollowUpTaskContext();

  return useMemo(
    () =>
      buildFollowUpTasksForReferral(referral, {
        completions,
        manualTasks,
        toggleTask,
        removeManualTask,
        viewerRole,
      }),
    [completions, manualTasks, referral, removeManualTask, toggleTask, viewerRole]
  );
}
