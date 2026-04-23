/**
 * Canonical dashboard math helpers.
 *
 * Several dashboards (Main, MC, Agent, AGIT, Admin) independently re-implement
 * close-rate, attach-rate, and percentage calculations. This module exports the
 * reference implementations so metric definitions don't drift between tabs.
 */

/**
 * Compute a simple cohort close rate as a percentage.
 *
 * @param closedCount - Number of deals closed attributable to the cohort.
 * @param cohortSize  - Number of referrals in the cohort denominator.
 * @returns Percentage in [0, 100]. Returns 0 when the cohort is empty.
 */
export function computeCohortCloseRate(closedCount: number, cohortSize: number): number {
  if (!Number.isFinite(closedCount) || !Number.isFinite(cohortSize)) return 0;
  if (cohortSize <= 0) return 0;
  if (closedCount <= 0) return 0;
  return (closedCount / cohortSize) * 100;
}

/**
 * Safe percentage helper. Returns 0 when denominator is 0 (not NaN).
 */
export function safePercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

/**
 * Clamp a percentage-like value to [0, 100].
 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
