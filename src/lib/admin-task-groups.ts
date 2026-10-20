import { normalizeReferralStatus, REFERRAL_STATUSES } from '@/constants/referrals';

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const UNASSIGNED_AGENT = 'Unassigned Agent';
const NO_PREVIOUS_TASK_KEY = 'no-previous-task';
const NO_PREVIOUS_TASK_LABEL = 'No previous task';

export type NoOpenTaskGroupBy = 'agent' | 'similar' | 'stage';

export interface NoOpenTaskGroupInput {
  status: string;
  agentName: string | null;
  lastTaskTitle: string | null;
  lastActivityAt: string | null;
}

export interface NoOpenTaskGroup<T> {
  groupKey: string;
  groupLabel: string;
  referrals: T[];
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function deriveSimilarTaskGroup(title?: string | null): { key: string; label: string } {
  const normalized = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return { key: 'other', label: 'Other' };

  const tokens = normalized.split(' ').filter(Boolean);
  const significant = tokens.filter((token) => !TITLE_STOP_WORDS.has(token));
  const baseTokens = (significant.length > 0 ? significant : tokens).slice(0, 3);

  if (baseTokens.length === 0) return { key: 'other', label: 'Other' };

  return {
    key: baseTokens.join('-'),
    label: baseTokens.map(toTitleCase).join(' '),
  };
}

function compareLastActivityDesc<T extends NoOpenTaskGroupInput>(a: T, b: T): number {
  const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
  const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
  return bTime - aTime;
}

function sortByLastActivity<T extends NoOpenTaskGroupInput>(rows: T[]): T[] {
  return rows.toSorted(compareLastActivityDesc);
}

function groupByAgent<T extends NoOpenTaskGroupInput>(referrals: readonly T[]): NoOpenTaskGroup<T>[] {
  const byAgent = new Map<string, T[]>();
  for (const referral of referrals) {
    const agentName = referral.agentName?.trim() || UNASSIGNED_AGENT;
    const rows = byAgent.get(agentName);
    if (rows) {
      rows.push(referral);
    } else {
      byAgent.set(agentName, [referral]);
    }
  }

  return [...byAgent.keys()]
    .sort((a, b) => {
      if (a === UNASSIGNED_AGENT) return 1;
      if (b === UNASSIGNED_AGENT) return -1;
      return a.localeCompare(b);
    })
    .map((agentName) => ({
      groupKey: agentName,
      groupLabel: agentName,
      referrals: sortByLastActivity(byAgent.get(agentName) ?? []),
    }));
}

function groupByStage<T extends NoOpenTaskGroupInput>(referrals: readonly T[]): NoOpenTaskGroup<T>[] {
  const byStage = new Map<string, T[]>();
  for (const referral of referrals) {
    const stage = normalizeReferralStatus(referral.status) || referral.status || 'Unknown';
    const rows = byStage.get(stage);
    if (rows) {
      rows.push(referral);
    } else {
      byStage.set(stage, [referral]);
    }
  }

  const stageOrder = (stage: string): number => {
    const index = REFERRAL_STATUSES.indexOf(stage as (typeof REFERRAL_STATUSES)[number]);
    return index === -1 ? REFERRAL_STATUSES.length : index;
  };

  return [...byStage.keys()]
    .sort((a, b) => {
      const orderDiff = stageOrder(a) - stageOrder(b);
      if (orderDiff !== 0) return orderDiff;
      return a.localeCompare(b);
    })
    .map((stage) => ({
      groupKey: stage,
      groupLabel: stage,
      referrals: sortByLastActivity(byStage.get(stage) ?? []),
    }));
}

function similarTaskGroup(title: string | null): { key: string; label: string } {
  if (!title || !title.trim()) {
    return { key: NO_PREVIOUS_TASK_KEY, label: NO_PREVIOUS_TASK_LABEL };
  }
  return deriveSimilarTaskGroup(title);
}

function groupBySimilarTask<T extends NoOpenTaskGroupInput>(referrals: readonly T[]): NoOpenTaskGroup<T>[] {
  const bySimilar = new Map<string, { label: string; referrals: T[] }>();
  for (const referral of referrals) {
    const { key, label } = similarTaskGroup(referral.lastTaskTitle);
    const existing = bySimilar.get(key);
    if (existing) {
      existing.referrals.push(referral);
    } else {
      bySimilar.set(key, { label, referrals: [referral] });
    }
  }

  return [...bySimilar.entries()]
    .sort((a, b) => {
      const countDiff = b[1].referrals.length - a[1].referrals.length;
      if (countDiff !== 0) return countDiff;
      return a[1].label.localeCompare(b[1].label);
    })
    .map(([groupKey, group]) => ({
      groupKey,
      groupLabel: group.label,
      referrals: sortByLastActivity(group.referrals),
    }));
}

export function groupNoOpenTaskReferrals<T extends NoOpenTaskGroupInput>(
  referrals: readonly T[],
  groupBy: NoOpenTaskGroupBy
): NoOpenTaskGroup<T>[] {
  switch (groupBy) {
    case 'agent':
      return groupByAgent(referrals);
    case 'similar':
      return groupBySimilarTask(referrals);
    case 'stage':
      return groupByStage(referrals);
    default: {
      const exhaustive: never = groupBy;
      return exhaustive;
    }
  }
}
