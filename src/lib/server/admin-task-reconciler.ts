import { addDays } from 'date-fns';
import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';
import { Types } from 'mongoose';

import { AdminTask, type AdminTaskLean } from '@/models/admin-task';

const SLA_TIME_ZONE = 'America/Denver';
import { Referral } from '@/models/referral';
import { normalizeReferralStatus, type ReferralStatus } from '@/constants/referrals';
import {
  GLOBAL_ON_CREATED_RULES,
  PAIRED_RULES,
  IN_COMMUNICATION_SHORT_RULES,
  IN_COMMUNICATION_LONG_RULES,
  ACTIVE_LEAD_RULES,
  UNDER_CONTRACT_RULES,
  AHA_OOS_GLOBAL_ON_CREATED_RULES,
  AHA_OOS_PAIRED_RULES,
  AHA_OOS_IN_COMMUNICATION_SHORT_RULES,
  AHA_OOS_IN_COMMUNICATION_LONG_RULES,
  AHA_OOS_ACTIVE_LEAD_RULES,
  AHA_OOS_UNDER_CONTRACT_RULES,
  AHA_GLOBAL_ON_CREATED_RULES,
  AHA_PAIRED_RULES,
  AHA_IN_COMMUNICATION_SHORT_RULES,
  AHA_IN_COMMUNICATION_LONG_RULES,
  AHA_ACTIVE_LEAD_RULES,
  AHA_UNDER_CONTRACT_RULES,
  isTimelineLongTerm,
  isTimelineShortTerm,
  type TaskRuleDefinition,
} from './admin-task-rules';

export type AdminTaskTrigger =
  | 'referral.created'
  | 'referral.status_changed'
  | 'referral.timeline_changed'
  | 'referral.agent_assigned';

import { getAhaDesignation, type AhaDesignation } from './admin-task-designation';

interface AgentLike {
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
}

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
  designation: AhaDesignation;
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
  const d = referral.designation;

  const rules: TaskRuleDefinition[] = [];

  if (trigger === 'referral.created' && status === 'New Lead') {
    if (d === 'AHA_OOS') rules.push(...AHA_OOS_GLOBAL_ON_CREATED_RULES);
    else if (d === 'AHA') rules.push(...AHA_GLOBAL_ON_CREATED_RULES);
    else rules.push(...GLOBAL_ON_CREATED_RULES);
  }

  if (status === 'Paired') {
    if (d === 'AHA_OOS') rules.push(...AHA_OOS_PAIRED_RULES);
    else if (d === 'AHA') rules.push(...AHA_PAIRED_RULES);
    else rules.push(...PAIRED_RULES);
  }

  if (status === 'In Communication') {
    if (isTimelineShortTerm(timeline)) {
      if (d === 'AHA_OOS') rules.push(...AHA_OOS_IN_COMMUNICATION_SHORT_RULES);
      else if (d === 'AHA') rules.push(...AHA_IN_COMMUNICATION_SHORT_RULES);
      else rules.push(...IN_COMMUNICATION_SHORT_RULES);
    } else if (isTimelineLongTerm(timeline)) {
      if (d === 'AHA_OOS') rules.push(...AHA_OOS_IN_COMMUNICATION_LONG_RULES);
      else if (d === 'AHA') rules.push(...AHA_IN_COMMUNICATION_LONG_RULES);
      else rules.push(...IN_COMMUNICATION_LONG_RULES);
    }
  }

  if (status === 'Active Lead') {
    if (d === 'AHA_OOS') rules.push(...AHA_OOS_ACTIVE_LEAD_RULES);
    else if (d === 'AHA') rules.push(...AHA_ACTIVE_LEAD_RULES);
    else rules.push(...ACTIVE_LEAD_RULES);
  }

  if (status === 'Under Contract') {
    if (d === 'AHA_OOS') rules.push(...AHA_OOS_UNDER_CONTRACT_RULES);
    else if (d === 'AHA') rules.push(...AHA_UNDER_CONTRACT_RULES);
    else rules.push(...UNDER_CONTRACT_RULES);
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

  const addRule = (r: TaskRuleDefinition, cycleKey: string) =>
    toDismiss.push({ ruleKey: r.ruleKey, cycleKey });

  if (trigger === 'referral.status_changed') {
    if (status !== 'New Lead') {
      [...GLOBAL_ON_CREATED_RULES, ...AHA_OOS_GLOBAL_ON_CREATED_RULES, ...AHA_GLOBAL_ON_CREATED_RULES].forEach((r) => addRule(r, '*'));
    }
    if (status !== 'Paired') {
      [...PAIRED_RULES, ...AHA_OOS_PAIRED_RULES, ...AHA_PAIRED_RULES].forEach((r) => addRule(r, '*'));
    }
    if (status !== 'In Communication') {
      [IN_COMMUNICATION_SHORT_RULES, AHA_OOS_IN_COMMUNICATION_SHORT_RULES, AHA_IN_COMMUNICATION_SHORT_RULES].flat().forEach((r) => addRule(r, '*'));
      [IN_COMMUNICATION_LONG_RULES, AHA_OOS_IN_COMMUNICATION_LONG_RULES, AHA_IN_COMMUNICATION_LONG_RULES].flat().forEach((r) => addRule(r, 'month'));
    }
    if (status !== 'Active Lead') {
      [...ACTIVE_LEAD_RULES, ...AHA_OOS_ACTIVE_LEAD_RULES, ...AHA_ACTIVE_LEAD_RULES].forEach((r) => addRule(r, '*'));
    }
    if (status !== 'Under Contract') {
      [...UNDER_CONTRACT_RULES, ...AHA_OOS_UNDER_CONTRACT_RULES, ...AHA_UNDER_CONTRACT_RULES].forEach((r) => addRule(r, '*'));
    }
  }

  if (trigger === 'referral.agent_assigned') {
    const d = referral.designation;
    const dismissOtherDesignations = (defaultRules: TaskRuleDefinition[], oosRules: TaskRuleDefinition[], ahaRules: TaskRuleDefinition[], cycleKey: string) => {
      if (d !== 'default') defaultRules.forEach((r) => addRule(r, cycleKey));
      if (d !== 'AHA_OOS') oosRules.forEach((r) => addRule(r, cycleKey));
      if (d !== 'AHA') ahaRules.forEach((r) => addRule(r, cycleKey));
    };
    if (status === 'New Lead') dismissOtherDesignations(GLOBAL_ON_CREATED_RULES, AHA_OOS_GLOBAL_ON_CREATED_RULES, AHA_GLOBAL_ON_CREATED_RULES, '*');
    if (status === 'Paired') dismissOtherDesignations(PAIRED_RULES, AHA_OOS_PAIRED_RULES, AHA_PAIRED_RULES, '*');
    if (status === 'In Communication') {
      if (isTimelineShortTerm(timeline)) dismissOtherDesignations(IN_COMMUNICATION_SHORT_RULES, AHA_OOS_IN_COMMUNICATION_SHORT_RULES, AHA_IN_COMMUNICATION_SHORT_RULES, '*');
      else if (isTimelineLongTerm(timeline)) dismissOtherDesignations(IN_COMMUNICATION_LONG_RULES, AHA_OOS_IN_COMMUNICATION_LONG_RULES, AHA_IN_COMMUNICATION_LONG_RULES, 'month');
    }
    if (status === 'Active Lead') dismissOtherDesignations(ACTIVE_LEAD_RULES, AHA_OOS_ACTIVE_LEAD_RULES, AHA_ACTIVE_LEAD_RULES, '*');
    if (status === 'Under Contract') dismissOtherDesignations(UNDER_CONTRACT_RULES, AHA_OOS_UNDER_CONTRACT_RULES, AHA_UNDER_CONTRACT_RULES, '*');
  }

  if (trigger === 'referral.timeline_changed' && status === 'In Communication') {
    if (isTimelineShortTerm(timeline)) {
      [IN_COMMUNICATION_LONG_RULES, AHA_OOS_IN_COMMUNICATION_LONG_RULES, AHA_IN_COMMUNICATION_LONG_RULES].flat().forEach((r) => addRule(r, 'month'));
    } else if (isTimelineLongTerm(timeline)) {
      [IN_COMMUNICATION_SHORT_RULES, AHA_OOS_IN_COMMUNICATION_SHORT_RULES, AHA_IN_COMMUNICATION_SHORT_RULES].flat().forEach((r) => addRule(r, '*'));
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
    // Use per-entry key so re-entering status creates fresh tasks (even same day)
    return `entry-${baseDate.getTime()}`;
  }
  if (rule.cycleType === 'month') {
    const dueDate = addDays(baseDate, rule.dueOffsetDays);
    return formatInTimeZone(dueDate, SLA_TIME_ZONE, 'yyyy-MM');
  }
  return formatInTimeZone(baseDate, SLA_TIME_ZONE, 'yyyy-MM');
}

function startOfDayDenver(date: Date): Date {
  const dateStr = formatInTimeZone(date, SLA_TIME_ZONE, 'yyyy-MM-dd');
  const [y, m, d] = dateStr.split('-').map(Number);
  const midnightLocal = new Date(y, m - 1, d, 0, 0, 0);
  return zonedTimeToUtc(midnightLocal, SLA_TIME_ZONE);
}

function computeDueAt(rule: TaskRuleDefinition, baseDate: Date): Date {
  return startOfDayDenver(addDays(baseDate, rule.dueOffsetDays));
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
    .populate('assignedAgent', 'ahaDesignation')
    .populate('buySideAgent', 'ahaDesignation')
    .populate('sellSideAgent', 'ahaDesignation')
    .lean();

  if (!referral) return;

  const designation = getAhaDesignation(referral as { assignedAgent?: AgentLike | null; buySideAgent?: AgentLike | null; sellSideAgent?: AgentLike | null });

  const snapshot: ReferralSnapshot = {
    _id: referral._id as Types.ObjectId,
    status: referral.status ?? 'New Lead',
    statusLastUpdated: referral.statusLastUpdated,
    timeline: referral.timeline ?? 'not_specified',
    createdAt: referral.createdAt ?? new Date(),
    sla: referral.sla,
    designation,
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
              updatedBy: actorId ?? 'system',
            },
          }
        );
      }
    } else {
      // Dismiss matching ruleKey regardless of cycleKey when wildcard
      const query: Record<string, unknown> = {
        referralId: referral._id,
        ruleKey,
        status: 'open',
      };
      if (cycleKey !== '*') {
        query.cycleKey = cycleKey;
      }
      await AdminTask.updateMany(
        query,
        {
          $set: {
            status: 'dismissed',
            dismissedAt: now,
            dismissedBy: actorId ?? 'system',
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
      dueAt = startOfDayDenver(addDays(cycleStart, rule.dueOffsetDays));
      cycleKey = formatInTimeZone(dueAt, SLA_TIME_ZONE, 'yyyy-MM');
    } else {
      cycleKey = computeCycleKey(rule, baseDate, snapshot);
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
        },
      },
      { upsert: true }
    );
  }
}
