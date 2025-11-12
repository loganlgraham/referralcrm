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
}

export function useFollowUpTasks(referral: ReferralLike & { borrower?: { name?: string } }) {
  const { completions, toggleTask } = useFollowUpTaskContext();

  return useMemo(() => {
    const insights = computeSlaInsights(referral);
    const ordered = sortRecommendations(insights.recommendations);
    return ordered.map<FollowUpTask>((item) => {
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
  }, [completions, referral, toggleTask]);
}
