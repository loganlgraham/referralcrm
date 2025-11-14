'use client';

import { useMemo } from 'react';

import {
  computeSlaInsights,
  sortRecommendations,
  type SlaRecommendation,
  type ReferralLike,
} from '@/utils/sla-insights';

import { useFollowUpTaskContext } from './follow-up-task-provider';

export interface FollowUpTask extends SlaRecommendation {
  taskId: string;
  referralId: string;
  referralName?: string;
  completed: boolean;
  toggle: () => void;
  isManual?: boolean;
  remove?: () => void;
}

export function useFollowUpTasks(referral: ReferralLike & { borrower?: { name?: string } }) {
  const { completions, toggleTask, manualTasks, removeManualTask } = useFollowUpTaskContext();

  return useMemo(() => {
    const insights = computeSlaInsights(referral);
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
  }, [completions, manualTasks, referral, removeManualTask, toggleTask]);
}
