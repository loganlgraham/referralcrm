import { LOST_REASON_COUNTS_AGAINST_AGENT, LOST_REASON_VALUES, type LostReason } from '@/constants/referrals';

/**
 * Draft, preview-only policy. Nothing here assigns an agent, writes a score,
 * or feeds an official ranking.
 */
export const AGENT_RECOMMENDATION_POLICY = {
  version: 'draft-2026-11-19',
  officialScoring: false,
  weights: { mc: 0.3, zip: 0.2, overall: 0.2, usedAfc: 0.15, workload: 0.15 },
  windowMonths: 24,
  /** Pseudo-referrals pulling a small record toward the pool rate. */
  priorStrength: 5,
  fubMaxAdjustment: 5,
  fubMinAssignedPeople: 5,
  fubMinComparableAgents: 3,
} as const;

export type FactorKey = keyof typeof AGENT_RECOMMENDATION_POLICY.weights;
export type AhaBucket = 'AHA' | 'AHA_OOS';
export type EvidenceStrength = 'Strong' | 'Moderate' | 'Limited';

const CLOSED_PAYMENT_STATUSES = new Set(['closed', 'payment_sent', 'paid']);
const ACTIVE_STATUSES = new Set(['Paired', 'In Communication', 'Active Lead', 'Showing Homes', 'Under Contract']);

export type HistoryPayment = {
  agentId: string | null;
  side: 'buy' | 'sell' | null;
  status: string | null;
  agentAttribution: string | null;
  usedAssignedAgent: boolean | null;
  usedAfc: boolean | null;
};

export type HistoryReferral = {
  id: string;
  createdAt: Date;
  referralDate: Date | null;
  clientType: 'Buyer' | 'Seller' | 'Both' | null;
  status: string | null;
  buyStatus: string | null;
  sellStatus: string | null;
  lostReason: string | null;
  lenderId: string | null;
  zips: string[];
  assignedAgentId: string | null;
  buySideAgentId: string | null;
  sellSideAgentId: string | null;
  payments: HistoryPayment[];
};

export type OutcomeKind = 'closed' | 'not_closed' | 'active' | 'excluded';

export type AgentOutcome = {
  referralId: string;
  agentId: string;
  outcome: OutcomeKind;
  excludedBecause: 'excused_loss' | 'closed_without_record' | null;
  lenderId: string | null;
  zips: string[];
  /** One entry per closed buy-side deal credited to this agent. null = not recorded. */
  afcAnswers: (boolean | null)[];
};

/** Earliest meaningful date, so retro-dated imports land in the right window. */
export function referralAnchorDate(referral: Pick<HistoryReferral, 'createdAt' | 'referralDate'>): Date {
  const created = referral.createdAt;
  const dated = referral.referralDate;
  if (dated !== null && !Number.isNaN(dated.getTime()) && dated.getTime() < created.getTime()) return dated;
  return created;
}

export function windowStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - AGENT_RECOMMENDATION_POLICY.windowMonths);
  return start;
}

function isLostReason(value: string | null): value is LostReason {
  return value !== null && (LOST_REASON_VALUES as readonly string[]).includes(value);
}

function creditedAgent(payment: HistoryPayment, referral: HistoryReferral): string | null {
  if (payment.agentId) return payment.agentId;
  const sideAgent = payment.side === 'sell' ? referral.sellSideAgentId : referral.buySideAgentId;
  return sideAgent ?? referral.assignedAgentId;
}

function statusForAgent(referral: HistoryReferral, agentId: string): string | null {
  if (referral.clientType === 'Both') {
    if (agentId === referral.buySideAgentId && agentId !== referral.sellSideAgentId) return referral.buyStatus ?? referral.status;
    if (agentId === referral.sellSideAgentId && agentId !== referral.buySideAgentId) return referral.sellStatus ?? referral.status;
  }
  return referral.status;
}

/**
 * One outcome per referral and agent who worked it. Agents who were reassigned
 * away are not credited with the result. Closings come from deal records, not
 * the referral status.
 */
export function deriveAgentOutcomes(referrals: readonly HistoryReferral[], now: Date): AgentOutcome[] {
  const start = windowStart(now).getTime();
  const outcomes: AgentOutcome[] = [];
  for (const referral of referrals) {
    const anchor = referralAnchorDate(referral).getTime();
    if (anchor < start || anchor > now.getTime()) continue;
    const current = new Set([referral.assignedAgentId, referral.buySideAgentId, referral.sellSideAgentId].filter((id): id is string => Boolean(id)));
    const credited = new Map<string, HistoryPayment[]>();
    let closedElsewhere = false;
    for (const payment of referral.payments) {
      if (!payment.status || !CLOSED_PAYMENT_STATUSES.has(payment.status)) continue;
      if (payment.agentAttribution === 'OUTSIDE_AGENT' || payment.usedAssignedAgent === false) {
        closedElsewhere = true;
        continue;
      }
      const agentId = creditedAgent(payment, referral);
      if (!agentId) continue;
      credited.set(agentId, [...(credited.get(agentId) ?? []), payment]);
    }
    const agents = new Set([...current, ...credited.keys()]);
    for (const agentId of agents) {
      const base = { referralId: referral.id, agentId, lenderId: referral.lenderId, zips: referral.zips };
      const deals = credited.get(agentId);
      if (deals && deals.length > 0) {
        outcomes.push({
          ...base,
          outcome: 'closed',
          excludedBecause: null,
          afcAnswers: deals.filter((deal) => deal.side !== 'sell').map((deal) => (typeof deal.usedAfc === 'boolean' ? deal.usedAfc : null)),
        });
        continue;
      }
      outcomes.push({ ...base, ...resolveUnclosed(referral, agentId, closedElsewhere), afcAnswers: [] });
    }
  }
  return outcomes;
}

function resolveUnclosed(referral: HistoryReferral, agentId: string, closedElsewhere: boolean): Pick<AgentOutcome, 'outcome' | 'excludedBecause'> {
  if (closedElsewhere) return { outcome: 'not_closed', excludedBecause: null };
  const status = statusForAgent(referral, agentId);
  if (status === 'Lost') {
    if (isLostReason(referral.lostReason) && !LOST_REASON_COUNTS_AGAINST_AGENT[referral.lostReason]) {
      return { outcome: 'excluded', excludedBecause: 'excused_loss' };
    }
    return { outcome: 'not_closed', excludedBecause: null };
  }
  if (status === 'Terminated') return { outcome: 'not_closed', excludedBecause: null };
  if (status === 'Closed') return { outcome: 'excluded', excludedBecause: 'closed_without_record' };
  return { outcome: 'active', excludedBecause: null };
}

export function isActiveReferralStatus(status: string | null): boolean {
  return status !== null && ACTIVE_STATUSES.has(status);
}

export type CandidateAgent = {
  id: string;
  name: string;
  active: boolean;
  ahaDesignation: string | null;
  coveredZips: string[];
};

export type EligibilityResult = {
  eligible: CandidateAgent[];
  reason: 'ok' | 'not_aha' | 'no_bucket' | 'no_zip' | 'none_eligible';
  excluded: { inactive: number; otherNetwork: number; noZipCoverage: number };
};

/**
 * AHA referrals use agents from the same bucket. Out-of-state agents must list
 * a referral ZIP; local AHA agents rarely list ZIPs, so coverage is not required.
 */
export function selectEligibleAgents(input: {
  org: string | null;
  bucket: string | null;
  zips: readonly string[];
  agents: readonly CandidateAgent[];
}): EligibilityResult {
  const excluded = { inactive: 0, otherNetwork: 0, noZipCoverage: 0 };
  if (input.org !== 'AHA') return { eligible: [], reason: 'not_aha', excluded };
  if (input.bucket !== 'AHA' && input.bucket !== 'AHA_OOS') return { eligible: [], reason: 'no_bucket', excluded };
  if (input.bucket === 'AHA_OOS' && input.zips.length === 0) return { eligible: [], reason: 'no_zip', excluded };
  const target = new Set(input.zips);
  const eligible: CandidateAgent[] = [];
  for (const agent of input.agents) {
    if (!agent.active) {
      excluded.inactive += 1;
      continue;
    }
    if (agent.ahaDesignation !== input.bucket) {
      excluded.otherNetwork += 1;
      continue;
    }
    if (input.bucket === 'AHA_OOS' && !agent.coveredZips.some((zip) => target.has(zip))) {
      excluded.noZipCoverage += 1;
      continue;
    }
    eligible.push(agent);
  }
  return { eligible, reason: eligible.length > 0 ? 'ok' : 'none_eligible', excluded };
}

export type RateEvidence = {
  successes: number;
  trials: number;
  baseline: number;
  adjusted: number;
  points: number;
  applicable: boolean;
};

export type WorkloadEvidence = { active: number; poolMedian: number; points: number };

export type FubAdjustment =
  | { state: 'applied'; points: number; contactedShare: number; assignedPeople: number }
  | { state: 'neutral'; reason: FubNeutralReason };

export type FubNeutralReason =
  | 'not_permitted'
  | 'not_connected'
  | 'not_linked'
  | 'unavailable'
  | 'incomplete_coverage'
  | 'small_sample'
  | 'too_few_comparable';

export type AgentRecommendation = {
  agentId: string;
  name: string;
  rank: number;
  score: number;
  baseScore: number;
  evidenceStrength: EvidenceStrength;
  coversZip: boolean;
  factors: {
    mc: RateEvidence;
    zip: RateEvidence;
    overall: RateEvidence;
    usedAfc: RateEvidence;
    workload: WorkloadEvidence;
  };
  excludedOutcomes: number;
  fub: FubAdjustment;
  reasons: string[];
};

/** Shrink toward the pool rate, so a 1-for-1 record cannot beat a 30-for-60 record. */
export function shrinkRate(successes: number, trials: number, baseline: number): number {
  const k = AGENT_RECOMMENDATION_POLICY.priorStrength;
  return (successes + k * baseline) / (trials + k);
}

/** 0–100, where the pool rate (and having no evidence) is exactly 50. */
export function ratePoints(adjusted: number, baseline: number): number {
  if (adjusted >= baseline) {
    const headroom = 1 - baseline;
    return headroom <= 0 ? 50 : 50 + (50 * (adjusted - baseline)) / headroom;
  }
  return baseline <= 0 ? 50 : 50 - (50 * (baseline - adjusted)) / baseline;
}

/** Equal to the pool median scores 50; lighter loads score higher. */
export function workloadPoints(active: number, poolMedian: number): number {
  return (100 * (poolMedian + 1)) / (poolMedian + 1 + (active + 1));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

type Tally = { successes: number; trials: number };

function rate(tally: Tally, baseline: number, applicable: boolean): RateEvidence {
  if (!applicable) return { successes: 0, trials: 0, baseline, adjusted: baseline, points: 50, applicable: false };
  const adjusted = shrinkRate(tally.successes, tally.trials, baseline);
  return { ...tally, baseline, adjusted, points: ratePoints(adjusted, baseline), applicable: true };
}

function pooled(tallies: readonly Tally[], fallback: number): number {
  const trials = tallies.reduce((sum, tally) => sum + tally.trials, 0);
  if (trials === 0) return fallback;
  return tallies.reduce((sum, tally) => sum + tally.successes, 0) / trials;
}

export function evidenceStrength(overallTrials: number, mcTrials: number, zipTrials: number): EvidenceStrength {
  if (overallTrials >= 15 && (mcTrials >= 5 || zipTrials >= 5)) return 'Strong';
  if (overallTrials >= 5) return 'Moderate';
  return 'Limited';
}

type MeasuredActivity = { state: 'measured'; assignedPeople: number; contactedPeople: number; coverageComplete: boolean };
export type FubActivityInput = Map<string, MeasuredActivity | { state: 'not_linked' | 'unavailable' }>;

/**
 * Optional, bounded nudge from stored Follow Up Boss activity. Agents without a
 * link, complete coverage, or enough contacts stay at 0, the comparison midpoint.
 */
export function fubAdjustments(agentIds: readonly string[], input: { permitted: boolean; connected: boolean; activity: FubActivityInput }): Map<string, FubAdjustment> {
  const result = new Map<string, FubAdjustment>();
  const neutralAll = (reason: FubNeutralReason) => {
    for (const id of agentIds) result.set(id, { state: 'neutral', reason });
    return result;
  };
  if (!input.permitted) return neutralAll('not_permitted');
  if (!input.connected) return neutralAll('not_connected');
  const comparable: { id: string; share: number; assigned: number }[] = [];
  for (const id of agentIds) {
    const stored = input.activity.get(id);
    if (!stored || stored.state !== 'measured') {
      result.set(id, { state: 'neutral', reason: stored?.state === 'unavailable' ? 'unavailable' : 'not_linked' });
      continue;
    }
    const entry: MeasuredActivity = stored;
    if (!entry.coverageComplete) {
      result.set(id, { state: 'neutral', reason: 'incomplete_coverage' });
    } else if (entry.assignedPeople < AGENT_RECOMMENDATION_POLICY.fubMinAssignedPeople) {
      result.set(id, { state: 'neutral', reason: 'small_sample' });
    } else {
      comparable.push({ id, share: Math.min(1, entry.contactedPeople / entry.assignedPeople), assigned: entry.assignedPeople });
    }
  }
  if (comparable.length < AGENT_RECOMMENDATION_POLICY.fubMinComparableAgents) {
    for (const entry of comparable) result.set(entry.id, { state: 'neutral', reason: 'too_few_comparable' });
    return result;
  }
  const mid = median(comparable.map((entry) => entry.share));
  const max = AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment;
  for (const entry of comparable) {
    const points = Math.max(-max, Math.min(max, Math.round(20 * (entry.share - mid) * 10) / 10));
    result.set(entry.id, { state: 'applied', points, contactedShare: entry.share, assignedPeople: entry.assigned });
  }
  return result;
}

export function rankAgents(input: {
  candidates: readonly CandidateAgent[];
  outcomes: readonly AgentOutcome[];
  activeCounts: ReadonlyMap<string, number>;
  mcId: string | null;
  zips: readonly string[];
  fub: ReadonlyMap<string, FubAdjustment>;
}): { ranked: AgentRecommendation[]; baselines: Record<Exclude<FactorKey, 'workload'>, number>; workloadMedian: number } {
  const target = new Set(input.zips);
  const byAgent = new Map<string, AgentOutcome[]>();
  for (const outcome of input.outcomes) byAgent.set(outcome.agentId, [...(byAgent.get(outcome.agentId) ?? []), outcome]);

  const tallies = input.candidates.map((agent) => {
    const rows = byAgent.get(agent.id) ?? [];
    const resolved = rows.filter((row) => row.outcome === 'closed' || row.outcome === 'not_closed');
    const count = (list: AgentOutcome[]): Tally => ({ successes: list.filter((row) => row.outcome === 'closed').length, trials: list.length });
    const afc = rows.flatMap((row) => row.afcAnswers).filter((answer): answer is boolean => answer !== null);
    return {
      agent,
      overall: count(resolved),
      mc: count(input.mcId ? resolved.filter((row) => row.lenderId === input.mcId) : []),
      zip: count(resolved.filter((row) => row.zips.some((zip) => target.has(zip)))),
      usedAfc: { successes: afc.filter(Boolean).length, trials: afc.length },
      excluded: rows.filter((row) => row.outcome === 'excluded').length,
    };
  });

  const overallBase = pooled(tallies.map((t) => t.overall), 0);
  const baselines = {
    overall: overallBase,
    mc: pooled(tallies.map((t) => t.mc), overallBase),
    zip: pooled(tallies.map((t) => t.zip), overallBase),
    usedAfc: pooled(tallies.map((t) => t.usedAfc), 0),
  };
  const workloadMedian = median(input.candidates.map((agent) => input.activeCounts.get(agent.id) ?? 0));
  const weights = AGENT_RECOMMENDATION_POLICY.weights;

  const scored = tallies.map((t) => {
    const factors = {
      mc: rate(t.mc, baselines.mc, input.mcId !== null),
      zip: rate(t.zip, baselines.zip, target.size > 0),
      overall: rate(t.overall, baselines.overall, true),
      usedAfc: rate(t.usedAfc, baselines.usedAfc, true),
      workload: (() => {
        const active = input.activeCounts.get(t.agent.id) ?? 0;
        return { active, poolMedian: workloadMedian, points: workloadPoints(active, workloadMedian) };
      })(),
    };
    const baseScore =
      weights.mc * factors.mc.points +
      weights.zip * factors.zip.points +
      weights.overall * factors.overall.points +
      weights.usedAfc * factors.usedAfc.points +
      weights.workload * factors.workload.points;
    const fub = input.fub.get(t.agent.id) ?? { state: 'neutral', reason: 'not_connected' };
    const adjustment = fub.state === 'applied' ? fub.points : 0;
    return {
      agentId: t.agent.id,
      name: t.agent.name,
      rank: 0,
      score: round1(baseScore + adjustment),
      baseScore: round1(baseScore),
      evidenceStrength: evidenceStrength(t.overall.trials, t.mc.trials, t.zip.trials),
      coversZip: t.agent.coveredZips.some((zip) => target.has(zip)),
      factors,
      excludedOutcomes: t.excluded,
      fub,
      reasons: [] as string[],
    } satisfies AgentRecommendation;
  });

  scored.sort(compareRecommendations);
  scored.forEach((entry, index) => {
    entry.rank = index + 1;
    entry.reasons = buildReasons(entry, input.zips);
  });
  return { ranked: scored, baselines, workloadMedian };
}

/** Score, then more finished referrals, lighter load, name, and id, so ties never flip. */
export function compareRecommendations(a: AgentRecommendation, b: AgentRecommendation): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.factors.overall.trials !== a.factors.overall.trials) return b.factors.overall.trials - a.factors.overall.trials;
  if (a.factors.workload.active !== b.factors.workload.active) return a.factors.workload.active - b.factors.workload.active;
  const byName = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function buildReasons(entry: AgentRecommendation, zips: readonly string[]): string[] {
  const weights = AGENT_RECOMMENDATION_POLICY.weights;
  const { mc, zip, overall, usedAfc, workload } = entry.factors;
  const candidates: { lift: number; text: string }[] = [];
  if (mc.applicable && mc.trials > 0) candidates.push({ lift: weights.mc * (mc.points - 50), text: `Closed ${mc.successes} of ${mc.trials} finished referrals with this MC` });
  if (zip.applicable && zip.trials > 0) candidates.push({ lift: weights.zip * (zip.points - 50), text: `Closed ${zip.successes} of ${zip.trials} finished referrals in ${zips.length === 1 ? `ZIP ${zips[0]}` : 'these ZIPs'}` });
  if (overall.trials > 0) candidates.push({ lift: weights.overall * (overall.points - 50), text: `Closed ${overall.successes} of ${overall.trials} finished referrals overall` });
  if (usedAfc.trials > 0) candidates.push({ lift: weights.usedAfc * (usedAfc.points - 50), text: `Clients financed with AFC on ${usedAfc.successes} of ${plural(usedAfc.trials, 'closed purchase')}` });
  candidates.push({ lift: weights.workload * (workload.points - 50), text: `${plural(workload.active, 'active referral')} right now` });
  if (entry.fub.state === 'applied' && entry.fub.points !== 0) {
    candidates.push({ lift: entry.fub.points, text: `Follow Up Boss shows calls or texts to ${Math.round(entry.fub.contactedShare * 100)}% of assigned contacts` });
  }
  const reasons = candidates.sort((a, b) => b.lift - a.lift).slice(0, 3).map((candidate) => candidate.text);
  if (reasons.length < 3 && entry.coversZip) reasons.push(`Lists ${zips.length === 1 ? `ZIP ${zips[0]}` : 'a referral ZIP'} in coverage`);
  if (reasons.length < 3 && overall.trials === 0) reasons.push('No finished referrals in the last 24 months yet');
  return reasons.slice(0, 3);
}
