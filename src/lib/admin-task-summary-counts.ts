import { isTerminalReferralStatus } from '@/constants/referrals';
import {
  referralMatchesTaskNetwork,
  type TaskNetworkDesignation,
  type TaskNetworkParam,
} from '@/lib/task-network';

export type SummaryDueBucket = 'overdue' | 'today' | 'upcoming' | 'other';

export interface SummaryTaskCountInput {
  referralId: string | null;
  bucket: SummaryDueBucket;
}

/**
 * All counts every open task. A specific network counts a task only when its
 * referral was loaded (including a soft-deleted referral the board still shows)
 * and that referral belongs to the network.
 */
export function countSummaryTasks(
  network: TaskNetworkParam,
  tasks: readonly SummaryTaskCountInput[],
  designationByReferral: ReadonlyMap<string, TaskNetworkDesignation | null>
): { overdueCount: number; dueTodayCount: number } {
  let overdueCount = 0;
  let dueTodayCount = 0;

  for (const task of tasks) {
    if (task.bucket !== 'overdue' && task.bucket !== 'today') continue;

    if (network !== 'all') {
      if (!task.referralId || !designationByReferral.has(task.referralId)) continue;
      const designation = designationByReferral.get(task.referralId) ?? null;
      if (!referralMatchesTaskNetwork(designation, network)) continue;
    }

    if (task.bucket === 'overdue') overdueCount += 1;
    else dueTodayCount += 1;
  }

  return { overdueCount, dueTodayCount };
}

/** Open-task referrals absent from the active set still need a designation lookup. */
export function openTaskReferralIdsMissingFrom(
  openTaskReferralIds: Iterable<string>,
  loadedReferralIds: ReadonlySet<string>
): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const id of openTaskReferralIds) {
    if (loadedReferralIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    missing.push(id);
  }

  return missing;
}

export function referralHasNoOpenTask(status: unknown, hasOpenTask: boolean): boolean {
  if (hasOpenTask) return false;
  return !isTerminalReferralStatus(status);
}
