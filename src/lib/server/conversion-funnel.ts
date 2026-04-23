import { normalizeReferralStatus, type ReferralStatus } from '@/constants/referrals';

export const FUNNEL_STAGE_ORDER = [
  'New Lead',
  'Paired',
  'In Communication',
  'Active Lead',
  'Under Contract',
  'Closed'
] as const;

export type FunnelStageName = (typeof FUNNEL_STAGE_ORDER)[number];

export const FUNNEL_TERMINAL_STATES = ['Lost', 'Terminated'] as const;
export type FunnelTerminalState = (typeof FUNNEL_TERMINAL_STATES)[number];

const STAGE_INDEX: Record<FunnelStageName, number> = FUNNEL_STAGE_ORDER.reduce(
  (acc, stage, index) => {
    acc[stage] = index;
    return acc;
  },
  {} as Record<FunnelStageName, number>
);

export function isFunnelStage(value: unknown): value is FunnelStageName {
  return (
    typeof value === 'string' && (FUNNEL_STAGE_ORDER as readonly string[]).includes(value)
  );
}

export function isFunnelTerminal(value: unknown): value is FunnelTerminalState {
  return (
    typeof value === 'string' && (FUNNEL_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

export function stageIndex(stage: FunnelStageName): number {
  return STAGE_INDEX[stage];
}

export function stagesAtOrAbove(stage: FunnelStageName): FunnelStageName[] {
  return FUNNEL_STAGE_ORDER.slice(STAGE_INDEX[stage]);
}

type AuditLike = {
  field?: unknown;
  newValue?: unknown;
  previousValue?: unknown;
  timestamp?: Date | string | null;
};

type SlaLike = {
  lastPairedAt?: Date | string | null;
  lastUnderContractAt?: Date | string | null;
  lastClosedAt?: Date | string | null;
  lastPaidAt?: Date | string | null;
} | null;

export interface FunnelReferralInput {
  _id: { toString(): string } | string;
  status?: string | ReferralStatus;
  statusLastUpdated?: Date | string | null;
  createdAt?: Date | string | null;
  referralDate?: Date | string | null;
  audit?: AuditLike[] | null;
  sla?: SlaLike;
}

export interface FunnelStageSummary {
  status: FunnelStageName;
  label: string;
  count: number;
  conversionFromPrevious: number | null;
  dropOffPercent: number | null;
  avgDaysInStage: number | null;
}

export interface ConversionFunnelResult {
  stages: FunnelStageSummary[];
  terminal: {
    lostTotal: number;
    terminatedTotal: number;
  };
}

interface BuildOptions {
  closedDealReferralIds?: Set<string> | Iterable<string>;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeAuditStage(value: unknown): FunnelStageName | FunnelTerminalState | null {
  if (typeof value !== 'string') return null;
  if (value === 'Showing Homes') return 'Active Lead';
  if (isFunnelStage(value)) return value;
  if (isFunnelTerminal(value)) return value;
  return null;
}

function normalizeCurrentStage(value: unknown): FunnelStageName | FunnelTerminalState | null {
  if (typeof value !== 'string') return null;
  if (isFunnelTerminal(value)) return value;
  const normalized = normalizeReferralStatus(value);
  if (normalized && isFunnelStage(normalized)) return normalized;
  return null;
}

interface PerReferralAnalysis {
  enteredAt: Partial<Record<FunnelStageName, Date>>;
  maxStageIndex: number;
  terminalOutcome: FunnelTerminalState | null;
}

function analyzeReferral(
  referral: FunnelReferralInput,
  closedSet: Set<string>
): PerReferralAnalysis {
  const enteredAt: Partial<Record<FunnelStageName, Date>> = {};

  const seededStart =
    toDate(referral.referralDate ?? null) ?? toDate(referral.createdAt ?? null);
  if (seededStart) {
    enteredAt['New Lead'] = seededStart;
  }

  const auditEntries = Array.isArray(referral.audit) ? referral.audit : [];
  const statusTransitions = auditEntries
    .filter((entry) => entry && entry.field === 'status')
    .map((entry) => ({
      newStage: normalizeAuditStage(entry.newValue),
      previousStage: normalizeAuditStage(entry.previousValue),
      timestamp: toDate(entry.timestamp ?? null)
    }))
    .filter((entry) => entry.timestamp !== null) as Array<{
    newStage: FunnelStageName | FunnelTerminalState | null;
    previousStage: FunnelStageName | FunnelTerminalState | null;
    timestamp: Date;
  }>;
  statusTransitions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (const transition of statusTransitions) {
    const stage = transition.newStage;
    if (stage && isFunnelStage(stage) && !enteredAt[stage]) {
      enteredAt[stage] = transition.timestamp;
    }
  }

  const sla = referral.sla ?? null;
  if (sla) {
    const pairedAt = toDate(sla.lastPairedAt ?? null);
    if (pairedAt && !enteredAt['Paired']) {
      enteredAt['Paired'] = pairedAt;
    }
    const underContractAt = toDate(sla.lastUnderContractAt ?? null);
    if (underContractAt && !enteredAt['Under Contract']) {
      enteredAt['Under Contract'] = underContractAt;
    }
    const closedAt = toDate(sla.lastClosedAt ?? null) ?? toDate(sla.lastPaidAt ?? null);
    if (closedAt && !enteredAt['Closed']) {
      enteredAt['Closed'] = closedAt;
    }
  }

  const referralId =
    typeof referral._id === 'string' ? referral._id : referral._id.toString();
  const hasClosedDeal = closedSet.has(referralId);
  if (hasClosedDeal && !enteredAt['Closed']) {
    enteredAt['Closed'] =
      toDate(sla?.lastClosedAt ?? null) ??
      toDate(sla?.lastPaidAt ?? null) ??
      toDate(referral.statusLastUpdated ?? null) ??
      toDate(referral.createdAt ?? null) ??
      new Date();
  }

  const currentNormalized = normalizeCurrentStage(referral.status);
  let maxStageIndex = -1;
  for (const stage of FUNNEL_STAGE_ORDER) {
    if (enteredAt[stage]) {
      maxStageIndex = STAGE_INDEX[stage];
    }
  }
  if (currentNormalized && isFunnelStage(currentNormalized)) {
    maxStageIndex = Math.max(maxStageIndex, STAGE_INDEX[currentNormalized]);
    if (!enteredAt[currentNormalized]) {
      const ts =
        toDate(referral.statusLastUpdated ?? null) ??
        toDate(referral.createdAt ?? null);
      if (ts) {
        enteredAt[currentNormalized] = ts;
      }
    }
  }
  if (hasClosedDeal) {
    maxStageIndex = Math.max(maxStageIndex, STAGE_INDEX['Closed']);
  }

  let terminalOutcome: FunnelTerminalState | null = null;
  if (currentNormalized && isFunnelTerminal(currentNormalized)) {
    terminalOutcome = currentNormalized;
  } else {
    for (let i = statusTransitions.length - 1; i >= 0; i -= 1) {
      const stage = statusTransitions[i].newStage;
      if (stage && isFunnelTerminal(stage)) {
        terminalOutcome = stage;
        break;
      }
    }
  }

  return { enteredAt, maxStageIndex, terminalOutcome };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function buildConversionFunnel(
  referrals: readonly FunnelReferralInput[],
  options: BuildOptions = {}
): ConversionFunnelResult {
  const closedSet =
    options.closedDealReferralIds instanceof Set
      ? options.closedDealReferralIds
      : new Set(options.closedDealReferralIds ?? []);

  const analyses = referrals.map((referral) => analyzeReferral(referral, closedSet));

  const counts = FUNNEL_STAGE_ORDER.map((_, stageIdx) =>
    analyses.reduce((sum, analysis) => (analysis.maxStageIndex >= stageIdx ? sum + 1 : sum), 0)
  );

  const stages: FunnelStageSummary[] = FUNNEL_STAGE_ORDER.map((stage, idx) => {
    const count = counts[idx];
    const prevCount = idx === 0 ? count : counts[idx - 1];
    const conversionFromPrevious =
      idx === 0
        ? count === 0
          ? null
          : 100
        : prevCount === 0
        ? null
        : (count / prevCount) * 100;
    const dropOffPercent =
      conversionFromPrevious == null ? null : Math.max(0, 100 - conversionFromPrevious);

    let avgDaysInStage: number | null = null;
    if (idx < FUNNEL_STAGE_ORDER.length - 1) {
      const nextStage = FUNNEL_STAGE_ORDER[idx + 1];
      const diffs: number[] = [];
      for (const analysis of analyses) {
        const enteredThis = analysis.enteredAt[stage];
        const enteredNext = analysis.enteredAt[nextStage];
        if (enteredThis && enteredNext) {
          const ms = enteredNext.getTime() - enteredThis.getTime();
          if (ms >= 0) {
            diffs.push(ms / MS_PER_DAY);
          }
        }
      }
      if (diffs.length > 0) {
        avgDaysInStage = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      }
    }

    return {
      status: stage,
      label: stage,
      count,
      conversionFromPrevious:
        conversionFromPrevious == null ? null : Number(conversionFromPrevious.toFixed(1)),
      dropOffPercent: dropOffPercent == null ? null : Number(dropOffPercent.toFixed(1)),
      avgDaysInStage: avgDaysInStage == null ? null : Number(avgDaysInStage.toFixed(1))
    };
  });

  let lostTotal = 0;
  let terminatedTotal = 0;
  for (const analysis of analyses) {
    if (analysis.terminalOutcome === 'Lost') lostTotal += 1;
    else if (analysis.terminalOutcome === 'Terminated') terminatedTotal += 1;
  }

  return {
    stages,
    terminal: { lostTotal, terminatedTotal }
  };
}
