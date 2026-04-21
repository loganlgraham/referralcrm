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
  AHA_PRE_UC_RULES,
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
  /** True when any attached agent (assigned/buy/sell) has ahaDesignation === 'AHA' or 'AGIT'. Uses AHA task template. */
  hasAhaAgentAttached?: boolean;
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

function getBaseDateForAhaPreUc(referral: ReferralSnapshot): Date {
  const created = referral.createdAt ? new Date(referral.createdAt) : new Date();
  const statusUpdated = referral.statusLastUpdated
    ? new Date(referral.statusLastUpdated)
    : null;
  const lastPaired =
    referral.sla?.lastPairedAt && !Number.isNaN(new Date(referral.sla.lastPairedAt).getTime())
      ? new Date(referral.sla.lastPairedAt)
      : null;
  return lastPaired ?? statusUpdated ?? created;
}

function getApplicableRules(
  referral: ReferralSnapshot,
  trigger: AdminTaskTrigger
): TaskRuleDefinition[] {
  const status = normalizeReferralStatus(referral.status) ?? 'New Lead';
  const timeline = referral.timeline ?? 'not_specified';

  if (referral.hasAhaAgentAttached) {
    if (status === 'Under Contract') {
      return [...AHA_UNDER_CONTRACT_RULES];
    }
    // Only create AHA pre-UC tasks on status change, not on agent assignment
    if (trigger === 'referral.status_changed') {
      return [...AHA_PRE_UC_RULES];
    }
    return [];
  }

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

  if (status === 'Active Lead') {
    rules.push(...ACTIVE_LEAD_RULES);
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

  if (referral.hasAhaAgentAttached) {
    if (trigger === 'referral.status_changed') {
      if (status === 'Under Contract') {
        toDismiss.push(
          ...AHA_PRE_UC_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
        );
      } else {
        toDismiss.push(
          ...AHA_UNDER_CONTRACT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
        );
      }
    }
    return toDismiss;
  }

  toDismiss.push(
    ...AHA_PRE_UC_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' })),
    ...AHA_UNDER_CONTRACT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
  );

  if (trigger === 'referral.status_changed') {
    if (status !== 'New Lead') {
      toDismiss.push(
        ...GLOBAL_ON_CREATED_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
      );
    }
    if (status !== 'Paired') {
      toDismiss.push(
        ...PAIRED_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
      );
    }
    if (status !== 'In Communication') {
      toDismiss.push(
        ...IN_COMMUNICATION_SHORT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' })),
        ...IN_COMMUNICATION_LONG_RULES.map((r) => ({
          ruleKey: r.ruleKey,
          cycleKey: 'month',
        }))
      );
    }
    if (status !== 'Active Lead') {
      toDismiss.push(
        ...ACTIVE_LEAD_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
      );
    }
    if (status !== 'Under Contract') {
      toDismiss.push(
        ...UNDER_CONTRACT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
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
        ...IN_COMMUNICATION_SHORT_RULES.map((r) => ({ ruleKey: r.ruleKey, cycleKey: '*' }))
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
    // Use per-entry key so re-entering status creates fresh tasks (even same day)
    return `entry-${baseDate.getTime()}`;
  }
  if (rule.cycleType === 'month') {
    const dueDate = addDays(baseDate, rule.dueOffsetDays);
    return formatInTimeZone(dueDate, SLA_TIME_ZONE, 'yyyy-MM');
  }
  return formatInTimeZone(baseDate, SLA_TIME_ZONE, 'yyyy-MM');
}

function dueTimeDenver(date: Date): Date {
  const dateStr = formatInTimeZone(date, SLA_TIME_ZONE, 'yyyy-MM-dd');
  const [y, m, d] = dateStr.split('-').map(Number);
  // 8 AM in Denver timezone
  const eightAmLocal = new Date(y, m - 1, d, 8, 0, 0);
  return zonedTimeToUtc(eightAmLocal, SLA_TIME_ZONE);
}

function computeDueAt(rule: TaskRuleDefinition, baseDate: Date): Date {
  return dueTimeDenver(addDays(baseDate, rule.dueOffsetDays));
}

/**
 * Dismiss any open tasks for this (referral, ruleKey) whose cycleKey is not
 * the current cycle. Without this, monthly rules (e.g. long-term check-ins)
 * stack a new open row every cycle forever because the unique index allows
 * distinct cycleKeys per referral+ruleKey.
 */
async function markPriorCyclesDismissed(params: {
  referralId: Types.ObjectId;
  ruleKey: string;
  currentCycleKey: string;
  actorId: string;
  now: Date;
}): Promise<void> {
  const { referralId, ruleKey, currentCycleKey, actorId, now } = params;
  await AdminTask.updateMany(
    {
      referralId,
      ruleKey,
      status: 'open',
      cycleKey: { $ne: currentCycleKey },
    },
    {
      $set: {
        status: 'dismissed',
        dismissedAt: now,
        dismissedBy: actorId,
        updatedBy: actorId,
      },
    }
  );
}

/** True when any attached agent has AHA or AGIT designation. Uses AHA task template (not AHA_OOS standard template). */
function hasAhaAgentAttached(referral: {
  assignedAgent?: { ahaDesignation?: string | null } | null;
  buySideAgent?: { ahaDesignation?: string | null } | null;
  sellSideAgent?: { ahaDesignation?: string | null } | null;
}): boolean {
  return (
    referral.assignedAgent?.ahaDesignation === 'AHA' ||
    referral.assignedAgent?.ahaDesignation === 'AGIT' ||
    referral.buySideAgent?.ahaDesignation === 'AHA' ||
    referral.buySideAgent?.ahaDesignation === 'AGIT' ||
    referral.sellSideAgent?.ahaDesignation === 'AHA' ||
    referral.sellSideAgent?.ahaDesignation === 'AGIT'
  );
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
    .select('_id status statusLastUpdated timeline createdAt sla assignedAgent buySideAgent sellSideAgent')
    .populate('assignedAgent', 'ahaDesignation')
    .populate('buySideAgent', 'ahaDesignation')
    .populate('sellSideAgent', 'ahaDesignation')
    .lean();

  if (!referral) return;

  const ref = referral as unknown as {
    _id: Types.ObjectId;
    status?: string;
    statusLastUpdated?: Date | null;
    timeline?: string | null;
    createdAt: Date;
    sla?: ReferralSnapshot['sla'];
    assignedAgent?: { ahaDesignation?: string | null } | null;
    buySideAgent?: { ahaDesignation?: string | null } | null;
    sellSideAgent?: { ahaDesignation?: string | null } | null;
  };

  const snapshot: ReferralSnapshot = {
    _id: ref._id,
    status: ref.status ?? 'New Lead',
    statusLastUpdated: ref.statusLastUpdated,
    timeline: ref.timeline ?? 'not_specified',
    createdAt: ref.createdAt ?? new Date(),
    sla: ref.sla,
    hasAhaAgentAttached: hasAhaAgentAttached(ref),
  };

  const status = normalizeReferralStatus(snapshot.status) ?? 'New Lead';
  const now = new Date();

  const applicableRules = getApplicableRules(snapshot, trigger);
  const rulesToDismiss = getRulesToDismiss(snapshot, trigger);

  const baseDate =
    snapshot.hasAhaAgentAttached && status !== 'Under Contract'
      ? getBaseDateForAhaPreUc(snapshot)
      : getBaseDateForStatus(snapshot, status);

  const dismisserId = actorId ?? 'system';

  for (const { ruleKey, cycleKey } of rulesToDismiss) {
    const query: Record<string, unknown> = {
      referralId: ref._id,
      ruleKey,
      status: 'open',
    };
    // 'month' and '*' are both treated as "every open cycle for this rule";
    // a concrete cycleKey string only dismisses that exact cycle.
    if (cycleKey !== '*' && cycleKey !== 'month') {
      query.cycleKey = cycleKey;
    }
    await AdminTask.updateMany(query, {
      $set: {
        status: 'dismissed',
        dismissedAt: now,
        dismissedBy: dismisserId,
        updatedBy: dismisserId,
      },
    });
  }

  for (const rule of applicableRules) {
    let cycleKey: string;
    let dueAt: Date;

    if (rule.cycleType === 'month') {
      const daysSinceBase = Math.floor(
        (now.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      const cycleIndex = Math.max(0, Math.floor(daysSinceBase / 30));
      const cycleStart = addDays(baseDate, cycleIndex * 30);
      dueAt = dueTimeDenver(addDays(cycleStart, rule.dueOffsetDays));
      cycleKey = formatInTimeZone(dueAt, SLA_TIME_ZONE, 'yyyy-MM');

      // For monthly rules, sweep any still-open rows from prior cycles of the
      // same rule. Without this, each month adds a new open row forever
      // (e.g. long-term check-ins stacking 3+ copies on one referral).
      await markPriorCyclesDismissed({
        referralId: ref._id,
        ruleKey: rule.ruleKey,
        currentCycleKey: cycleKey,
        actorId: dismisserId,
        now,
      });
    } else {
      cycleKey = computeCycleKey(rule, baseDate, snapshot);
      dueAt = computeDueAt(rule, baseDate);
    }

    const existing = await AdminTask.findOne({
      referralId: ref._id,
      ruleKey: rule.ruleKey,
      cycleKey,
    }).lean<AdminTaskLean | null>();

    if (existing) {
      if (existing.status === 'completed' || existing.status === 'dismissed') {
        continue;
      }
    }

    try {
      await AdminTask.findOneAndUpdate(
        {
          referralId: ref._id,
          ruleKey: rule.ruleKey,
          cycleKey,
        },
        {
          $setOnInsert: {
            referralId: ref._id,
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
    } catch (error) {
      // Concurrent reconcilers racing on the same unique key can throw
      // E11000 — treat as a no-op since the other writer already inserted.
      const code = (error as { code?: number } | null)?.code;
      if (code !== 11000) {
        throw error;
      }
    }
  }
}
