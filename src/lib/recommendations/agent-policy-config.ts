/**
 * Draft, preview-only policy. Nothing here assigns an agent, writes a score,
 * or feeds an official ranking.
 */
export const AGENT_RECOMMENDATION_POLICY = {
  version: 'draft-2026-11-27',
  officialScoring: false,
  weights: { mc: 0.3, overall: 0.2, contract: 0.15, workload: 0.15, zip: 0.1, usedAfc: 0.1 },
  windowMonths: 24,
  /** Pseudo-referrals pulling a small record toward the pool rate. */
  priorStrength: 10,
  /** Resolved referrals needed before history is treated as adequate. */
  minResolvedForEvidence: 5,
  /** Licensed OOS agents can match closed-deal or coverage ZIPs within this radius. */
  nearbyZipMiles: 15,
  fubContributionEnabled: false,
  fubMaxAdjustment: 5,
  fubMinAssignedPeople: 5,
  fubMinComparableAgents: 3,
} as const;

export const DRAFT_WORKLOAD_STAGE_WEIGHTS = {
  'New Lead': 1,
  Paired: 2,
  'In Communication': 3,
  'Active Lead': 4,
} as const;
