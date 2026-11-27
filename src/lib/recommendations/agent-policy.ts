import { LOST_REASON_COUNTS_AGAINST_AGENT, LOST_REASON_VALUES, type LostReason } from '@/constants/referrals';
import { zipsWithinMiles } from '@/lib/recommendations/nearby-zips';
import { normalizeStateInput, zipToState } from '@/utils/location';

import { AGENT_RECOMMENDATION_POLICY, DRAFT_WORKLOAD_STAGE_WEIGHTS } from '@/lib/recommendations/agent-policy-config';
export { AGENT_RECOMMENDATION_POLICY, DRAFT_WORKLOAD_STAGE_WEIGHTS } from '@/lib/recommendations/agent-policy-config';

export type FactorKey = keyof typeof AGENT_RECOMMENDATION_POLICY.weights;
export type RateFactorKey = Exclude<FactorKey, 'workload'>;
export type AhaBucket = 'AHA' | 'AHA_OOS';
export type EvidenceStrength = 'Strong' | 'Moderate' | 'Limited';

const CLOSED_PAYMENT_STATUSES = new Set(['closed', 'payment_sent', 'paid']);
const ZIP = /^\d{5}$/u;
export type DraftWorkloadStage = keyof typeof DRAFT_WORKLOAD_STAGE_WEIGHTS;
export type WorkloadStageCounts = Record<DraftWorkloadStage, number>;

const UNDER_CONTRACT_STAGE = 'Under Contract';
const WORKLOAD_STATUSES = new Set([...Object.keys(DRAFT_WORKLOAD_STAGE_WEIGHTS), UNDER_CONTRACT_STAGE]);
const WORKLOAD_STAGES = Object.keys(DRAFT_WORKLOAD_STAGE_WEIGHTS) as DraftWorkloadStage[];

export type HistoryPayment = {
  agentId: string | null;
  side: 'buy' | 'sell' | null;
  status: string | null;
  agentAttribution: string | null;
  usedAssignedAgent: boolean | null;
  propertyPostalCode: string | null;
  /** Answer recorded on the closing form. null = defaulted or not verifiable. */
  usedAfcAtClosing: boolean | null;
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
export type ContractOutcome = 'contracted' | 'no_contract' | 'excluded';
export type ExclusionReason = 'excused_loss' | 'unknown_loss_reason' | 'closed_without_record';

export type AgentOutcome = {
  referralId: string;
  agentId: string;
  outcome: OutcomeKind;
  excludedBecause: ExclusionReason | null;
  /** Counted once per referral and agent, however many contracts were written. */
  contract: ContractOutcome;
  lenderId: string | null;
  zips: string[];
  /** One entry per closed buy-side deal credited to this agent. null = unknown. */
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

type DealFacts = { closed: HistoryPayment[]; contracted: boolean; terminated: boolean; propertyZips: string[] };

function verifiedDealZip(payment: HistoryPayment): string | null {
  const zip = payment.propertyPostalCode?.trim() ?? '';
  return ZIP.test(zip) ? zip : null;
}

function evidenceZips(deals: DealFacts | undefined): string[] {
  return Array.from(new Set(deals?.propertyZips ?? []));
}

/**
 * One outcome per referral and agent who worked it. Agents who were reassigned
 * away are not credited with the result. Closings and contracts come from deal
 * records, not the referral status.
 */
export function deriveAgentOutcomes(referrals: readonly HistoryReferral[], now: Date): AgentOutcome[] {
  const start = windowStart(now).getTime();
  const outcomes: AgentOutcome[] = [];
  for (const referral of referrals) {
    const anchor = referralAnchorDate(referral).getTime();
    if (anchor < start || anchor > now.getTime()) continue;
    const current = [referral.assignedAgentId, referral.buySideAgentId, referral.sellSideAgentId].filter((id): id is string => Boolean(id));
    const facts = new Map<string, DealFacts>();
    let closedElsewhere = false;
    let contractedElsewhere = false;
    for (const payment of referral.payments) {
      if (!payment.status) continue;
      const closed = CLOSED_PAYMENT_STATUSES.has(payment.status);
      if (payment.agentAttribution === 'OUTSIDE_AGENT' || payment.usedAssignedAgent === false) {
        contractedElsewhere = true;
        if (closed) closedElsewhere = true;
        continue;
      }
      const agentId = creditedAgent(payment, referral);
      if (!agentId) continue;
      const entry = facts.get(agentId) ?? { closed: [], contracted: false, terminated: false, propertyZips: [] };
      const propertyZip = verifiedDealZip(payment);
      entry.contracted = true;
      if (closed) entry.closed.push(payment);
      if (payment.status === 'terminated') entry.terminated = true;
      if (propertyZip) entry.propertyZips.push(propertyZip);
      facts.set(agentId, entry);
    }
    for (const agentId of new Set([...current, ...facts.keys()])) {
      const deals = facts.get(agentId);
      const base = { referralId: referral.id, agentId, lenderId: referral.lenderId, zips: evidenceZips(deals) };
      if (deals && deals.closed.length > 0) {
        outcomes.push({
          ...base,
          outcome: 'closed',
          excludedBecause: null,
          contract: 'contracted',
          afcAnswers: deals.closed.filter((deal) => deal.side !== 'sell').map((deal) => deal.usedAfcAtClosing),
        });
        continue;
      }
      outcomes.push({
        ...base,
        ...resolveUnclosed(referral, agentId, { closedElsewhere, contractedElsewhere, contracted: deals?.contracted ?? false, terminated: deals?.terminated ?? false }),
        afcAnswers: [],
      });
    }
  }
  return outcomes;
}

function resolveUnclosed(
  referral: HistoryReferral,
  agentId: string,
  flags: { closedElsewhere: boolean; contractedElsewhere: boolean; contracted: boolean; terminated: boolean },
): Pick<AgentOutcome, 'outcome' | 'excludedBecause' | 'contract'> {
  const knownContract: ContractOutcome | null = flags.contracted ? 'contracted' : flags.contractedElsewhere ? 'no_contract' : null;
  if (flags.closedElsewhere) return { outcome: 'not_closed', excludedBecause: null, contract: knownContract ?? 'no_contract' };
  const status = statusForAgent(referral, agentId);
  const finished = status === 'Lost' || status === 'Terminated';
  if (flags.terminated && finished) return { outcome: 'not_closed', excludedBecause: null, contract: 'contracted' };
  if (status === 'Lost') {
    if (!isLostReason(referral.lostReason)) return { outcome: 'excluded', excludedBecause: 'unknown_loss_reason', contract: knownContract ?? 'excluded' };
    if (!LOST_REASON_COUNTS_AGAINST_AGENT[referral.lostReason]) return { outcome: 'excluded', excludedBecause: 'excused_loss', contract: knownContract ?? 'excluded' };
    return { outcome: 'not_closed', excludedBecause: null, contract: knownContract ?? 'no_contract' };
  }
  if (status === 'Terminated') return { outcome: 'not_closed', excludedBecause: null, contract: knownContract ?? 'excluded' };
  if (status === 'Closed') return { outcome: 'excluded', excludedBecause: 'closed_without_record', contract: knownContract ?? 'excluded' };
  return { outcome: 'active', excludedBecause: null, contract: knownContract ?? 'excluded' };
}

export function isActiveReferralStatus(status: string | null): boolean {
  return status !== null && WORKLOAD_STATUSES.has(status);
}

export type ActiveReferralLoadRow = {
  status: string | null;
  assignedAgentId: string | null;
  buySideAgentId: string | null;
  sellSideAgentId: string | null;
};

export type WorkloadMeasurement = {
  active: number;
  weightedActive: number;
  underContract: number;
  stageCounts: WorkloadStageCounts;
};

function emptyStageCounts(): WorkloadStageCounts {
  return {
    'New Lead': 0,
    Paired: 0,
    'In Communication': 0,
    'Active Lead': 0,
  };
}

function emptyWorkload(): WorkloadMeasurement {
  return { active: 0, weightedActive: 0, underContract: 0, stageCounts: emptyStageCounts() };
}

function normalizeWorkload(value: number | WorkloadMeasurement | undefined): WorkloadMeasurement {
  if (typeof value === 'number') {
    return { ...emptyWorkload(), active: value, weightedActive: value };
  }
  return value ?? emptyWorkload();
}

/**
 * Known active loads require a successful, complete referral read. Failed,
 * partial, or truncated reads return an empty map so every agent stays
 * unknown (neutral 50) instead of a confirmed empty load.
 */
export function measuredActiveCounts(input: {
  eligibleIds: readonly string[];
  activeReferrals: readonly ActiveReferralLoadRow[] | null;
  complete: boolean;
}): Map<string, WorkloadMeasurement> {
  if (!input.complete || input.activeReferrals === null) return new Map();
  const eligible = new Set(input.eligibleIds);
  const counts = new Map<string, WorkloadMeasurement>(input.eligibleIds.map((id) => [id, emptyWorkload()]));
  for (const row of input.activeReferrals) {
    if (!isActiveReferralStatus(row.status)) continue;
    const agents = new Set(
      [row.assignedAgentId, row.buySideAgentId, row.sellSideAgentId].filter((id): id is string => id !== null && eligible.has(id)),
    );
    for (const id of agents) {
      const current = counts.get(id) ?? emptyWorkload();
      if (row.status === UNDER_CONTRACT_STAGE) {
        counts.set(id, { ...current, underContract: current.underContract + 1 });
        continue;
      }
      const stage = row.status as DraftWorkloadStage;
      const weight = DRAFT_WORKLOAD_STAGE_WEIGHTS[stage];
      const stageCounts = { ...current.stageCounts, [stage]: current.stageCounts[stage] + 1 };
      counts.set(id, {
        active: current.active + 1,
        weightedActive: current.weightedActive + weight,
        underContract: current.underContract,
        stageCounts,
      });
    }
  }
  return counts;
}

export type CandidateAgent = {
  id: string;
  name: string;
  active: boolean;
  ahaDesignation: string | null;
  coveredZips: string[];
  statesLicensed?: string[];
  closedDealZips?: string[];
};

const EXCLUDED_AHA_NAMES = new Set(['adam pippin', 'kristen truong']);

/** Only search areas in a recorded licensed state can qualify an OOS agent. */
export function agentGeographyMatch(agent: CandidateAgent, zips: readonly string[], nearbyZips?: readonly string[]): number {
  const licensed = new Set((agent.statesLicensed ?? []).map((state) => normalizeStateInput(state.trim())).filter(Boolean));
  const destinations = zips.filter((zip) => {
    const state = zipToState(zip);
    return state !== null && licensed.has(state);
  });
  if (destinations.length === 0) return 4;
  const exact = new Set(destinations);
  if (agent.closedDealZips?.some((zip) => exact.has(zip))) return 0;
  if (agent.coveredZips.some((zip) => exact.has(zip))) return 1;
  const nearby = new Set(destinations.length === zips.length && nearbyZips
    ? nearbyZips
    : zipsWithinMiles(destinations, AGENT_RECOMMENDATION_POLICY.nearbyZipMiles));
  if (agent.closedDealZips?.some((zip) => nearby.has(zip))) return 2;
  if (agent.coveredZips.some((zip) => nearby.has(zip))) return 3;
  return 4;
}

export type EligibilityResult = {
  eligible: CandidateAgent[];
  reason: 'ok' | 'not_aha' | 'no_bucket' | 'no_zip' | 'none_eligible';
  excluded: { inactive: number; otherNetwork: number; outsideRadius: number };
};

/**
 * AHA referrals use active agents from the same bucket. Out-of-state agents
 * need closed-deal or coverage ZIP evidence and a destination-state license.
 * Local AHA agents do not need ZIP coverage.
 */
export function selectEligibleAgents(input: {
  org: string | null;
  bucket: string | null;
  zips: readonly string[];
  nearbyZips: readonly string[];
  agents: readonly CandidateAgent[];
}): EligibilityResult {
  const excluded = { inactive: 0, otherNetwork: 0, outsideRadius: 0 };
  if (input.org !== 'AHA') return { eligible: [], reason: 'not_aha', excluded };
  if (input.bucket !== 'AHA' && input.bucket !== 'AHA_OOS') return { eligible: [], reason: 'no_bucket', excluded };
  if (input.bucket === 'AHA_OOS' && input.zips.length === 0) return { eligible: [], reason: 'no_zip', excluded };
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
    if (input.bucket === 'AHA' && EXCLUDED_AHA_NAMES.has(agent.name.trim().replace(/\s+/g, ' ').toLowerCase())) continue;
    if (input.bucket === 'AHA_OOS' && agentGeographyMatch(agent, input.zips, input.nearbyZips) === 4) {
      excluded.outsideRadius += 1;
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

export type WorkloadEvidence = {
  active: number;
  weightedActive: number;
  underContract: number;
  stageCounts: WorkloadStageCounts;
  poolMedian: number;
  points: number;
  /** False when active load was never measured; scores the neutral 50 and is not called empty. */
  known: boolean;
};

export type FubAdjustment =
  | { state: 'applied'; points: number; contactedShare: number; assignedPeople: number }
  | { state: 'neutral'; reason: FubNeutralReason };

export type FubNeutralReason =
  | 'paused'
  | 'not_permitted'
  | 'not_connected'
  | 'not_linked'
  | 'unavailable'
  | 'incomplete_coverage'
  | 'small_sample'
  | 'too_few_comparable';

export type CoverageMatch = 'exact' | 'nearby' | 'not_listed';

export type AgentRecommendation = {
  agentId: string;
  name: string;
  rank: number;
  score: number;
  baseScore: number;
  /** Weighted rate factors only — no workload — used by the evidence gate. */
  outcomeScore: number;
  /** True when resolved eligible referrals meet minResolvedForEvidence. */
  adequateHistory: boolean;
  evidenceStrength: EvidenceStrength;
  coverage: CoverageMatch;
  factors: {
    mc: RateEvidence;
    overall: RateEvidence;
    contract: RateEvidence;
    zip: RateEvidence;
    usedAfc: RateEvidence;
    workload: WorkloadEvidence;
  };
  excludedOutcomes: number;
  /** Losses with no recorded reason. Shown, never counted against the agent. */
  unknownLossReasons: number;
  /** Closed purchases whose AFC answer was not recorded at closing. */
  afcUnknown: number;
  /** Active or missing-result rows that reduce confidence without lowering performance. */
  missingOutcomes: number;
  outcomeCompleteness: number;
  fub: FubAdjustment;
  reasons: string[];
};

const MODERATE_COMPLETENESS_THRESHOLD = 0.6;
const STRONG_COMPLETENESS_THRESHOLD = 0.75;

export function hasAdequateHistory(resolvedTrials: number, completeness = 1): boolean {
  return resolvedTrials >= AGENT_RECOMMENDATION_POLICY.minResolvedForEvidence && completeness >= MODERATE_COMPLETENESS_THRESHOLD;
}

/** Shrink toward the pool rate, so a 1-for-1 record cannot beat solid history. */
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
  if (!applicable) return { ...tally, baseline, adjusted: baseline, points: 50, applicable: false };
  const adjusted = shrinkRate(tally.successes, tally.trials, baseline);
  return { ...tally, baseline, adjusted, points: ratePoints(adjusted, baseline), applicable: true };
}

function pooled(tallies: readonly Tally[], fallback: number): number {
  const trials = tallies.reduce((sum, tally) => sum + tally.trials, 0);
  if (trials === 0) return fallback;
  return tallies.reduce((sum, tally) => sum + tally.successes, 0) / trials;
}

function outcomeCompleteness(resolvedTrials: number, missingOutcomes: number): number {
  const total = resolvedTrials + missingOutcomes;
  return total === 0 ? 1 : resolvedTrials / total;
}

export function evidenceStrength(overallTrials: number, mcTrials: number, zipTrials: number, completeness = 1): EvidenceStrength {
  if (overallTrials >= 15 && (mcTrials >= 5 || zipTrials >= 5) && completeness >= STRONG_COMPLETENESS_THRESHOLD) return 'Strong';
  if (overallTrials >= 5 && completeness >= MODERATE_COMPLETENESS_THRESHOLD) return 'Moderate';
  return 'Limited';
}

type MeasuredActivity = { state: 'measured'; assignedPeople: number; contactedPeople: number; coverageComplete: boolean };
export type FubActivityInput = Map<string, MeasuredActivity | { state: 'not_linked' | 'unavailable' }>;

/**
 * Optional, bounded nudge from stored Follow Up Boss activity. Paused by
 * default; agents without a link, complete coverage, or enough contacts stay
 * at 0, the comparison midpoint.
 */
export function fubAdjustments(
  agentIds: readonly string[],
  input: { permitted: boolean; connected: boolean; activity: FubActivityInput; enabled?: boolean },
): Map<string, FubAdjustment> {
  const result = new Map<string, FubAdjustment>();
  const neutralAll = (reason: FubNeutralReason) => {
    for (const id of agentIds) result.set(id, { state: 'neutral', reason });
    return result;
  };
  if (!(input.enabled ?? AGENT_RECOMMENDATION_POLICY.fubContributionEnabled)) return neutralAll('paused');
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
  /**
   * Measured draft workload. Only agents present in the map have a
   * known workload; missing entries score the neutral 50 and are not treated
   * as a confirmed empty load.
   */
  activeCounts: ReadonlyMap<string, number | WorkloadMeasurement>;
  mcId: string | null;
  zips: readonly string[];
  nearbyZips?: readonly string[];
  prioritizeGeography?: boolean;
  fub: ReadonlyMap<string, FubAdjustment>;
}): { ranked: AgentRecommendation[]; baselines: Record<RateFactorKey, number>; workloadMedian: number; provisional: boolean } {
  const target = new Set(input.zips);
  const nearby = new Set(input.nearbyZips ?? []);
  const byAgent = new Map<string, AgentOutcome[]>();
  for (const outcome of input.outcomes) byAgent.set(outcome.agentId, [...(byAgent.get(outcome.agentId) ?? []), outcome]);

  const tallies = input.candidates.map((agent) => {
    const rows = byAgent.get(agent.id) ?? [];
    const resolved = rows.filter((row) => row.outcome === 'closed' || row.outcome === 'not_closed');
    const count = (list: AgentOutcome[]): Tally => ({ successes: list.filter((row) => row.outcome === 'closed').length, trials: list.length });
    const contractRows = rows.filter((row) => row.contract !== 'excluded');
    const answers = rows.flatMap((row) => row.afcAnswers);
    const afc = answers.filter((answer): answer is boolean => answer !== null);
    const unknownLossReasons = rows.filter((row) => row.excludedBecause === 'unknown_loss_reason').length;
    const missingOutcomes = rows.filter((row) => row.excludedBecause === 'unknown_loss_reason' || row.excludedBecause === 'closed_without_record').length;
    const contract = {
      successes: contractRows.filter((row) => row.contract === 'contracted').length,
      trials: contractRows.length,
    };
    const contractHasFailure = contract.successes < contract.trials;
    return {
      agent,
      overall: count(resolved),
      mc: count(input.mcId ? resolved.filter((row) => row.lenderId === input.mcId) : []),
      zip: count(resolved.filter((row) => row.zips.some((zip) => target.has(zip)))),
      contract,
      contractApplicable: contract.trials > 0 && contractHasFailure,
      usedAfc: { successes: afc.filter(Boolean).length, trials: afc.length },
      excluded: rows.filter((row) => row.outcome === 'excluded').length,
      unknownLossReasons,
      missingOutcomes,
      afcUnknown: answers.length - afc.length,
    };
  });

  // MC and ZIP results are compared with the group's overall close rate, so the
  // only agent with history at an MC is not graded against itself.
  const overallBase = pooled(tallies.map((t) => t.overall), 0);
  const baselines: Record<RateFactorKey, number> = {
    mc: overallBase,
    overall: overallBase,
    contract: pooled(tallies.filter((t) => t.contractApplicable).map((t) => t.contract), 0),
    zip: overallBase,
    usedAfc: pooled(tallies.map((t) => t.usedAfc), 0),
  };
  const knownLoads = input.candidates
    .filter((agent) => input.activeCounts.has(agent.id))
    .map((agent) => normalizeWorkload(input.activeCounts.get(agent.id)).weightedActive);
  const workloadMedian = median(knownLoads);
  const weights = AGENT_RECOMMENDATION_POLICY.weights;

  const scored = tallies.map((t) => {
    const known = input.activeCounts.has(t.agent.id);
    const workload = known ? normalizeWorkload(input.activeCounts.get(t.agent.id)) : emptyWorkload();
    const factors = {
      mc: rate(t.mc, baselines.mc, input.mcId !== null),
      overall: rate(t.overall, baselines.overall, true),
      contract: rate(t.contract, baselines.contract, t.contractApplicable),
      zip: rate(t.zip, baselines.zip, target.size > 0),
      usedAfc: rate(t.usedAfc, baselines.usedAfc, true),
      workload: {
        active: workload.active,
        weightedActive: workload.weightedActive,
        underContract: workload.underContract,
        stageCounts: workload.stageCounts,
        poolMedian: workloadMedian,
        points: known ? workloadPoints(workload.weightedActive, workloadMedian) : 50,
        known,
      },
    };
    const completeness = outcomeCompleteness(t.overall.trials, t.missingOutcomes);
    const outcomeScore =
      weights.mc * factors.mc.points +
      weights.overall * factors.overall.points +
      weights.contract * factors.contract.points +
      weights.zip * factors.zip.points +
      weights.usedAfc * factors.usedAfc.points;
    const baseScore = outcomeScore + weights.workload * factors.workload.points;
    const fub: FubAdjustment = input.fub.get(t.agent.id) ?? { state: 'neutral', reason: 'paused' };
    const adjustment = fub.state === 'applied' ? fub.points : 0;
    const coverage: CoverageMatch = t.agent.coveredZips.some((zip) => target.has(zip))
      ? 'exact'
      : t.agent.coveredZips.some((zip) => nearby.has(zip))
        ? 'nearby'
        : 'not_listed';
    const adequateHistory = hasAdequateHistory(t.overall.trials, completeness);
    return {
      agentId: t.agent.id,
      name: t.agent.name,
      rank: 0,
      score: round1(baseScore + adjustment),
      baseScore: round1(baseScore),
      outcomeScore: round1(outcomeScore),
      adequateHistory,
      evidenceStrength: evidenceStrength(t.overall.trials, t.mc.trials, t.zip.trials, completeness),
      coverage,
      factors,
      excludedOutcomes: t.excluded,
      unknownLossReasons: t.unknownLossReasons,
      afcUnknown: t.afcUnknown,
      missingOutcomes: t.missingOutcomes,
      outcomeCompleteness: completeness,
      fub,
      reasons: [] as string[],
    } satisfies AgentRecommendation;
  });

  const geography = new Map(input.candidates.map((agent) => [agent.id, input.prioritizeGeography ? agentGeographyMatch(agent, input.zips, input.nearbyZips) : 0]));
  scored.sort((a, b) => (geography.get(a.agentId) ?? 0) - (geography.get(b.agentId) ?? 0) || compareRecommendations(a, b));
  scored.forEach((entry, index) => {
    entry.rank = index + 1;
    entry.reasons = buildReasons(entry, input.zips);
    if (input.prioritizeGeography) {
      const match = geography.get(entry.agentId);
      const reason = match === 0 ? 'Closed a deal in a looking-in ZIP'
        : match === 1 ? 'Lists a looking-in ZIP in coverage'
          : match === 2 ? 'Closed a deal within 15 miles of a looking-in ZIP'
            : 'Lists coverage within 15 miles of a looking-in ZIP';
      entry.reasons = [reason, ...entry.reasons].slice(0, 3);
    }
  });
  const provisional = scored.length > 0 && scored.every((entry) => !entry.adequateHistory);
  return { ranked: scored, baselines, workloadMedian, provisional };
}

/**
 * Evidence gate: a limited-history agent is not promoted above an adequately
 * evidenced eligible agent whose outcomes are comparable or stronger. Workload
 * alone cannot flip that. Capacity and availability are enforced earlier by
 * eligibility — blocked agents never enter this list.
 */
export function compareRecommendations(a: AgentRecommendation, b: AgentRecommendation): number {
  if (a.adequateHistory !== b.adequateHistory) {
    if (a.adequateHistory && a.outcomeScore + 1e-9 >= b.outcomeScore) return -1;
    if (b.adequateHistory && b.outcomeScore + 1e-9 >= a.outcomeScore) return 1;
  }
  if (b.score !== a.score) return b.score - a.score;
  if (b.factors.overall.trials !== a.factors.overall.trials) return b.factors.overall.trials - a.factors.overall.trials;
  if (a.factors.workload.known && b.factors.workload.known && a.factors.workload.active !== b.factors.workload.active) {
    return a.factors.workload.active - b.factors.workload.active;
  }
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
  const { mc, overall, contract, zip, usedAfc, workload } = entry.factors;
  const candidates: { lift: number; text: string }[] = [];
  const contractCountReason = !contract.applicable && contract.successes > 0
    ? plural(contract.successes, 'documented contract')
    : null;
  if (mc.applicable && mc.trials > 0) candidates.push({ lift: weights.mc * (mc.points - 50), text: `Closed ${mc.successes} of ${mc.trials} finished referrals with this MC` });
  if (overall.trials > 0) candidates.push({ lift: weights.overall * (overall.points - 50), text: `Closed ${overall.successes} of ${overall.trials} finished referrals overall` });
  if (contract.applicable && contract.trials > 0) candidates.push({ lift: weights.contract * (contract.points - 50), text: `Reached a contract on ${contract.successes} of ${plural(contract.trials, 'referral')} with known contract results` });
  if (zip.applicable && zip.trials > 0) candidates.push({ lift: weights.zip * (zip.points - 50), text: `Closed ${zip.successes} of ${zip.trials} finished referrals in ${zips.length === 1 ? `ZIP ${zips[0]}` : 'these ZIPs'}` });
  if (usedAfc.trials > 0) candidates.push({ lift: weights.usedAfc * (usedAfc.points - 50), text: `Clients financed with AFC on ${usedAfc.successes} of ${plural(usedAfc.trials, 'closed purchase')}` });
  if (workload.known) {
    candidates.push({ lift: weights.workload * (workload.points - 50), text: `${plural(workload.active, 'active referral')} right now` });
  }
  if (entry.fub.state === 'applied' && entry.fub.points !== 0) {
    candidates.push({ lift: entry.fub.points, text: `Follow Up Boss shows calls or texts to ${Math.round(entry.fub.contactedShare * 100)}% of assigned contacts` });
  }
  const summaryParts = [
    overall.successes > 0 && (workload.active > 0 || entry.unknownLossReasons > 0) ? `${overall.successes} closed` : null,
    workload.known && workload.active > 0 ? `${workload.active} active` : null,
    entry.unknownLossReasons > 0 ? `${entry.unknownLossReasons} ${entry.unknownLossReasons === 1 ? 'loss' : 'losses'} without a reason` : null,
  ].filter((part): part is string => part !== null);
  const reasons = summaryParts.length > 0 ? [summaryParts.join(' · ')] : [];
  if (contractCountReason) reasons.push(contractCountReason);
  reasons.push(...candidates.sort((a, b) => b.lift - a.lift).map((candidate) => candidate.text));
  const uniqueReasons = Array.from(new Set(reasons)).slice(0, 3);
  if (uniqueReasons.length < 3 && entry.coverage === 'exact') uniqueReasons.push(`Lists ${zips.length === 1 ? `ZIP ${zips[0]}` : 'a referral ZIP'} in coverage`);
  if (uniqueReasons.length < 3 && entry.coverage === 'nearby') uniqueReasons.push(`Covers an area within ${AGENT_RECOMMENDATION_POLICY.nearbyZipMiles} miles`);
  if (uniqueReasons.length < 3 && overall.trials === 0) uniqueReasons.push('No finished referrals in the last 24 months yet');
  return uniqueReasons.slice(0, 3);
}
