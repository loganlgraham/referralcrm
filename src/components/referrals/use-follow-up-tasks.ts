"use client";

import { useMemo } from 'react';

import {
  buildFollowUpTasksForReferral,
  getLatestCompletionForReferral,
  type FollowUpTask,
  type FollowUpTaskRole,
} from '@/lib/follow-up-tasks';
import { type ReferralLike } from '@/utils/sla-insights';

import { useFollowUpTaskContext } from './follow-up-task-provider';

export { buildFollowUpTasksForReferral, getLatestCompletionForReferral } from '@/lib/follow-up-tasks';
export type { FollowUpTask, FollowUpTaskRole } from '@/lib/follow-up-tasks';

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
