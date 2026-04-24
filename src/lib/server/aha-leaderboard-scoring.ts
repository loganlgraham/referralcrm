export const AHA_NEUTRAL_SCORE = 50;

export interface AhaRankSortFields {
  id: string;
  score: number;
  referralCount: number;
  netCommissionCents: number;
}

export function normalizeAhaKpiMap(
  rawMap: Map<string, number>,
  lowerIsBetter: boolean,
  neutralScore = AHA_NEUTRAL_SCORE
): Map<string, number> {
  if (rawMap.size === 0) {
    return new Map();
  }

  const values = Array.from(rawMap.values());
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalized = new Map<string, number>();

  for (const [id, rawValue] of rawMap) {
    if (max === min) {
      normalized.set(id, neutralScore);
      continue;
    }

    const score = lowerIsBetter
      ? ((max - rawValue) / (max - min)) * 100
      : ((rawValue - min) / (max - min)) * 100;
    normalized.set(id, Math.max(0, Math.min(100, score)));
  }

  return normalized;
}

export function computeAhaReliabilityFactor(
  referralCount: number,
  minReferralsForFullReliability: number
): number {
  if (minReferralsForFullReliability <= 0 || referralCount <= 0) {
    return 0;
  }
  return Math.min(1, Math.sqrt(referralCount / minReferralsForFullReliability));
}

export function computeCappedActivityUsageScore(
  totalEvents: number,
  activeDays: number,
  maxEventsPerActiveDay = 2
): number {
  const safeTotalEvents = Number.isFinite(totalEvents) ? Math.max(0, Math.floor(totalEvents)) : 0;
  const safeActiveDays = Number.isFinite(activeDays) ? Math.max(0, Math.floor(activeDays)) : 0;
  const safeMaxEventsPerActiveDay = Number.isFinite(maxEventsPerActiveDay)
    ? Math.max(1, Math.floor(maxEventsPerActiveDay))
    : 1;
  if (safeActiveDays === 0) {
    return 0;
  }

  const cappedEvents = Math.min(safeTotalEvents, safeActiveDays * safeMaxEventsPerActiveDay);
  const bonusEvents = Math.max(0, cappedEvents - safeActiveDays);
  return safeActiveDays + bonusEvents;
}

export function compareAhaRankedAgents(a: AhaRankSortFields, b: AhaRankSortFields): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (b.referralCount !== a.referralCount) {
    return b.referralCount - a.referralCount;
  }
  if (b.netCommissionCents !== a.netCommissionCents) {
    return b.netCommissionCents - a.netCommissionCents;
  }
  return a.id.localeCompare(b.id);
}
