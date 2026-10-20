import { Types } from 'mongoose';

import { classifyDueDayBucket } from '@/lib/admin-task-day';
import {
  countSummaryTasks,
  openTaskReferralIdsMissingFrom,
  referralHasNoOpenTask,
  type SummaryDueBucket,
} from '@/lib/admin-task-summary-counts';
import { connectMongo } from '@/lib/mongoose';
import { loadReferralDesignationMap, type ReferralNetworkSource } from '@/lib/server/referral-networks';
import { referralMatchesTaskNetwork, type TaskNetworkParam } from '@/lib/task-network';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';
import { Referral } from '@/models/referral';

export interface AdminTaskSummary {
  overdueCount: number;
  dueTodayCount: number;
  noOpenTaskCount: number;
}

interface SummaryReferral extends Omit<ReferralNetworkSource, '_id'> {
  _id: { toString(): string };
  status?: string;
}

function summaryBucket(task: AdminTaskLean): SummaryDueBucket {
  const effectiveDue = getEffectiveDueDate(task);
  if (!effectiveDue) return 'other';
  const bucket = classifyDueDayBucket(effectiveDue);
  if (bucket === 'overdue' || bucket === 'today' || bucket === 'upcoming') return bucket;
  const exhaustive: never = bucket;
  return exhaustive;
}

export async function getAdminTaskSummary(network: TaskNetworkParam): Promise<AdminTaskSummary> {
  await connectMongo();

  const [tasks, activeReferrals] = await Promise.all([
    AdminTask.find({ status: 'open' })
      .select('referralId dueAt dueAtOverride snoozedUntil status')
      .lean<AdminTaskLean[]>(),
    Referral.find({ deletedAt: null })
      .select('_id status assignedAgent buySideAgent sellSideAgent ahaBucket org')
      .lean<SummaryReferral[]>(),
  ]);

  const openTaskReferralIds = tasks.flatMap((task) => {
    const id = task.referralId?.toString();
    return id ? [id] : [];
  });
  const openTaskReferralIdSet = new Set(openTaskReferralIds);
  const summaryTasks = tasks.map((task) => ({
    referralId: task.referralId?.toString() ?? null,
    bucket: summaryBucket(task),
  }));

  const activeIds = new Set(activeReferrals.map((referral) => referral._id.toString()));
  const missingIds = network === 'all'
    ? []
    : openTaskReferralIdsMissingFrom(openTaskReferralIds, activeIds).filter((id) => Types.ObjectId.isValid(id));
  const extraReferrals = missingIds.length === 0
    ? []
    : await Referral.find({ _id: { $in: missingIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id status assignedAgent buySideAgent sellSideAgent ahaBucket org')
      .lean<SummaryReferral[]>();

  const designationByReferral = network === 'all'
    ? null
    : await loadReferralDesignationMap([...activeReferrals, ...extraReferrals]);

  const { overdueCount, dueTodayCount } = countSummaryTasks(
    network,
    summaryTasks,
    designationByReferral ?? new Map()
  );

  let noOpenTaskCount = 0;
  for (const referral of activeReferrals) {
    const id = referral._id.toString();
    if (!referralHasNoOpenTask(referral.status, openTaskReferralIdSet.has(id))) continue;
    if (
      designationByReferral
      && !referralMatchesTaskNetwork(designationByReferral.get(id) ?? null, network)
    ) {
      continue;
    }
    noOpenTaskCount += 1;
  }

  return { overdueCount, dueTodayCount, noOpenTaskCount };
}
