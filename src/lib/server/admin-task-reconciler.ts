import { addDays, format, startOfDay } from 'date-fns';
import { Types } from 'mongoose';

import { AdminTask, type AdminTaskLean } from '@/models/admin-task';
import { Referral } from '@/models/referral';
import { normalizeReferralStatus, type ReferralStatus } from '@/constants/referrals';
import {
  GLOBAL_ON_CREATED_RULES,
  PAIRED_RULES,
  IN_COMMUNICATION_SHORT_RULES,
  IN_COMMUNICATION_LONG_RULES,
  UNDER_CONTRACT_RULES,
  isTimelineLongTerm,
  isTimelineShortTerm,
  type TaskRuleDefinition,
} from './admin-task-rules';

export type AdminTaskTrigger =
  | 'referral.created'
  | 'referral.status_changed'
  | 'referral.timeline_changed'
  | 'referral.agent_assigned';

interface ReferralSnapshot {
  _id: Types.ObjectId;
  status: string;
  statusLastUpdated?: Date | null;
  timeline?: string | null;
  createdAt: Date;
  sla?: {
    lastPairedAt?: Date | null;
    lastUnderContractAt?: Date | null;
  } | null;
}

function getBaseDateForStatus(
  referral: ReferralSnapshot,
  status: ReferralStatus
): Date {
  const statusUpdated = referral.statusLastUpdated
    ? new Date(referral.statusLastUpdated)
    : null;
  const createdAt = referral.createdAt
    ? new Date(referral.createdAt)
    : new Date();

  if (status === 'New Lead') {
    return createdAt;
  }
  if (status === 'Paired' && referral.sla?.lastPairedAt) {
    const pairedAt = new Date(referral.sla.lastPairedAt);
    if (!Number.isNaN(pairedAt.getTime())) return pairedAt;
  }
  if (status === 'Under Contract' && referral.sla?.lastUnderContractAt) {
    const ucAt = new Date(referral.sla.lastUnderContractAt);
    if (!Number.isNaN(ucAt.getTime())) return ucAt;
  }
  return statusUpdated ?? createdAt;
}

function getApplicableRules(
  referral: ReferralSnapshot,
  trigger: AdminTaskTrigger
): TaskRuleDefinition[] {
  const status = normalizeReferralStatus(referral.status) ?? 'New Lead';
  const timeline = referral.timeline ?? 'not_specified';

  const rules: TaskRuleDefinition[] = [];

  if (trigger === 'referral.created' && status === 'New Lead') {
    rules.push(...GLOBAL_ON_CREATED_RULES);
  }

  if (status === 'Paired') {
    rules.push(...PAIRED_RULES);
  }

  if (status === 'In Communication') {
    if (isTimelineShortTerm(timeline)) {
      rules.push(...IN_COMMUNICATION_SHORT_RULES);
    } else if (isTimelineLongTerm(timeline)) {
      rules.push(...IN_COMMUNICATION_LONG_RULES);
    }
  }

  if (status === 'Under Contract') {
    rules.push(...UNDER_CONTRACT_RULES);
  }

  return rules;
}

function getRulesToDismiss(
  referral: ReferralSnapshot,
  trigger: AdminTaskTrigger
): { ruleKey: string; cycleKey: string }[] {
  const status = normalizeReferralStatus(referral.status) ?? 'New Lead';
  const timeline = referral.timeline ?? 'not_specified';

  const toDismiss: { ruleKey: string; cycleKey: string }[] = [];

  if (trigger === 'referral.status_changed') {
    if (status !== 'New Lead') {
      toDismiss.push(
        ...GLOBAL_ON_CREATED_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: 'once' }))
      );
    }
    if (status !== 'Paired') {
      toDismiss.push(
        ...PAIRED_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: 'once' }))
      );
    }
    if (status !== 'In Communication') {
      toDismiss.push(
        ...IN_COMMUNICATION_SHORT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: 'once' })),
        ...IN_COMMUNICATION_LONG_RULES.map((r) => ({
          ruleKey: r.ruleKey,
          cycleKey: 'month',
        }))
      );
    }
    if (status !== 'Under Contract') {
      toDismiss.push(
        ...UNDER_CONTRACT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: 'once' }))
      );
    }
  }

  if (trigger === 'referral.timeline_changed' && status === 'In Communication') {
    if (isTimelineShortTerm(timeline)) {
      toDismiss.push(
        ...IN_COMMUNICATION_LONG_RULES.map((r) => ({
          ruleKey: r.ruleKey,
          cycleKey: 'month',
        }))
      );
    } else if (isTimelineLongTerm(timeline)) {
      toDismiss.push(
        ...IN_COMMUNICATION_SHORT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: 'once' }))
      );
    }
  }

  return toDismiss;
}

function computeCycleKey(
  rule: TaskRuleDefinition,
  baseDate: Date,
  referral: ReferralSnapshot
): string {
  if (rule.cycleType === 'once') {
    return 'once';
  }
  if (rule.cycleType === 'month') {
    const dueDate = addDays(baseDate, rule.dueOffsetDays);
    return format(dueDate, 'yyyy-MM');
  }
  return 'once';
}

function computeDueAt(rule: TaskRuleDefinition, baseDate: Date): Date {
  return startOfDay(addDays(baseDate, rule.dueOffsetDays));
}

export async function generateAndReconcileAdminTasks({
  referralId,
  trigger,
  actorId,
}: {
  referralId: string;
  trigger: AdminTaskTrigger;
  actorId?: string;
}): Promise<void> {
  const referral = await Referral.findById(referralId)
    .select('_id status statusLastUpdated timeline createdAt sla')
    .lean<ReferralSnapshot | null>();

  if (!referral) return;

  const snapshot: ReferralSnapshot = {
    _id: referral._id as Types.ObjectId,
    status: referral.status ?? 'New Lead',
    statusLastUpdated: referral.statusLastUpdated,
    timeline: referral.timeline ?? 'not_specified',
    createdAt: referral.createdAt ?? new Date(),
    sla: referral.sla,
  };

  const status = normalizeReferralStatus(snapshot.status) ?? 'New Lead';
  const now = new Date();

  const applicableRules = getApplicableRules(snapshot, trigger);
  const rulesToDismiss = getRulesToDismiss(snapshot, trigger);

  for (const { ruleKey, cycleKey } of rulesToDismiss) {
    if (cycleKey === 'month') {
      const openLongTerm = await AdminTask.find({
        referralId: referral._id,
        ruleKey,
        status: 'open',
      }).lean();
      for (const task of openLongTerm) {
        await AdminTask.updateOne(
          { _id: task._id },
          {
            $set: {
              status: 'dismissed',
              dismissedAt: now,
              dismissedBy: actorId ?? 'system',
              updatedAt: now,
              updatedBy: actorId ?? 'system',
            },
          }
        );
      }
    } else {
      await AdminTask.updateMany(
        {
          referralId: referral._id,
          ruleKey,
          cycleKey: 'once',
          status: 'open',
        },
        {
          $set: {
            status: 'dismissed',
            dismissedAt: now,
            dismissedBy: actorId ?? 'system',
            updatedAt: now,
            updatedBy: actorId ?? 'system',
          },
        }
      );
    }
  }

  const baseDate = getBaseDateForStatus(snapshot, status);

  for (const rule of applicableRules) {
    let cycleKey: string;
    let dueAt: Date;

    if (rule.cycleType === 'month') {
      const daysSinceBase = Math.floor(
        (now.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      const cycleIndex = Math.max(0, Math.floor(daysSinceBase / 30));
      const cycleStart = addDays(baseDate, cycleIndex * 30);
      dueAt = addDays(cycleStart, rule.dueOffsetDays);
      cycleKey = format(dueAt, 'yyyy-MM');
    } else {
      cycleKey = 'once';
      dueAt = computeDueAt(rule, baseDate);
    }

    const existing = await AdminTask.findOne({
      referralId: referral._id,
      ruleKey: rule.ruleKey,
      cycleKey,
    }).lean<AdminTaskLean | null>();

    if (existing) {
      if (existing.status === 'completed' || existing.status === 'dismissed') {
        continue;
      }
    }

    await AdminTask.findOneAndUpdate(
      {
        referralId: referral._id,
        ruleKey: rule.ruleKey,
        cycleKey,
      },
      {
        $setOnInsert: {
          referralId: referral._id,
          title: rule.title,
          description: rule.description,
          category: rule.category,
          priority: rule.priority,
          status: 'open',
          dueAt,
          ruleKey: rule.ruleKey,
          cycleKey,
          createdBy: 'system',
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }
}
