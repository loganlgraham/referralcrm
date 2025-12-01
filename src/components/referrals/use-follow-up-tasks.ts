'use client';

import { useMemo } from 'react';

import {
  computeSlaInsights,
  sortRecommendations,
  type SlaRecommendation,
  type ReferralLike,
} from '@/utils/sla-insights';

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
}

export function buildFollowUpTasksForReferral(
  referral: ReferralLike & { borrower?: { name?: string } },
  {
    completions,
    manualTasks,
    toggleTask,
    removeManualTask,
  }: {
    completions: Record<string, { completed: boolean; completedAt?: string | null }>;
    manualTasks: Record<string, ManualTask[]>;
    toggleTask: (taskId: string, completed: boolean) => void;
    removeManualTask: (referralId: string, taskId: string) => void;
  }
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
    };
  });

  const automated = ordered.map<FollowUpTask>((item) => {
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
    };
  });

  return [...manualFollowUps, ...automated];
}

export function useFollowUpTasks(referral: ReferralLike & { borrower?: { name?: string } }) {
  const { completions, toggleTask, manualTasks, removeManualTask } = useFollowUpTaskContext();

  return useMemo(
    () =>
      buildFollowUpTasksForReferral(referral, {
        completions,
        manualTasks,
        toggleTask,
        removeManualTask,
      }),
    [completions, manualTasks, referral, removeManualTask, toggleTask]
  );
}
