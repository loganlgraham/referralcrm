import { Types } from 'mongoose';

import { classifyDueDayBucket } from '@/lib/admin-task-day';
import { isTerminalReferralStatus } from '@/constants/referrals';
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

export async function getAdminTaskSummary(network: TaskNetworkParam): Promise<AdminTaskSummary> {
  await connectMongo();

  const tasks = await AdminTask.find({ status: 'open' })
    .select('referralId dueAt dueAtOverride snoozedUntil status')
    .lean<AdminTaskLean[]>();

  const openTaskReferralIds = new Set(
    tasks
      .map((task) => task.referralId?.toString())
      .filter((id): id is string => Boolean(id))
  );

  if (network === 'all') {
    const { dueTodayCount, overdueCount } = tasks.reduce(
      (acc, task) => {
        const effectiveDue = getEffectiveDueDate(task);
        if (!effectiveDue) return acc;
        const bucket = classifyDueDayBucket(effectiveDue);
        if (bucket === 'today') acc.dueTodayCount += 1;
        else if (bucket === 'overdue') acc.overdueCount += 1;
        return acc;
      },
      { dueTodayCount: 0, overdueCount: 0 }
    );

    const noOpenTaskCount = await Referral.countDocuments({
      deletedAt: null,
      status: { $nin: ['Closed', 'Lost', 'Terminated'] },
      _id: { $nin: [...openTaskReferralIds].map((id) => new Types.ObjectId(id)) },
    });

    return { overdueCount, dueTodayCount, noOpenTaskCount };
  }

  const referrals = await Referral.find({ deletedAt: null })
    .select('_id status assignedAgent buySideAgent sellSideAgent ahaBucket org')
    .lean<SummaryReferral[]>();

  const designationByReferral = await loadReferralDesignationMap(referrals);

  let overdueCount = 0;
  let dueTodayCount = 0;
  for (const task of tasks) {
    const referralId = task.referralId?.toString();
    const designation = referralId ? designationByReferral.get(referralId) ?? null : null;
    if (!referralMatchesTaskNetwork(designation, network)) continue;

    const effectiveDue = getEffectiveDueDate(task);
    if (!effectiveDue) continue;
    const bucket = classifyDueDayBucket(effectiveDue);
    if (bucket === 'today') dueTodayCount += 1;
    else if (bucket === 'overdue') overdueCount += 1;
  }

  let noOpenTaskCount = 0;
  for (const referral of referrals) {
    const id = referral._id.toString();
    if (isTerminalReferralStatus(referral.status)) continue;
    if (openTaskReferralIds.has(id)) continue;
    if (!referralMatchesTaskNetwork(designationByReferral.get(id) ?? null, network)) continue;
    noOpenTaskCount += 1;
  }

  return { overdueCount, dueTodayCount, noOpenTaskCount };
}
