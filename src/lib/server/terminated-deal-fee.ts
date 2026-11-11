export interface TerminationSnapshotFields {
  terminatedAt: Date | null;
  terminatedExpectedAmountCents: number | null;
}

interface TerminationSnapshotArgs {
  previousStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  expectedAmountBeforeTerminationCents: number | null | undefined;
  now: Date;
}

const normalizeCents = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/**
 * Fields to write when a deal's status changes. Only a fresh transition into `terminated` captures
 * the fee; retries and reason edits on an already-terminated deal keep the original snapshot, and
 * reactivation clears it so a later termination captures the fee owed at that point.
 */
export function resolveTerminationSnapshotUpdate(
  args: TerminationSnapshotArgs
): Partial<TerminationSnapshotFields> {
  const wasTerminated = args.previousStatus === 'terminated';
  const isTerminated = args.nextStatus === 'terminated';
  if (isTerminated && !wasTerminated) {
    return {
      terminatedAt: args.now,
      terminatedExpectedAmountCents: normalizeCents(args.expectedAmountBeforeTerminationCents),
    };
  }
  if (wasTerminated && args.nextStatus != null && !isTerminated) {
    return { terminatedAt: null, terminatedExpectedAmountCents: null };
  }
  return {};
}

export interface TerminatedDealFeeInput {
  terminatedExpectedAmountCents?: number | null;
  expectedAmountCents?: number | null;
  contractPriceCents?: number | null;
  commissionBasisPoints?: number | null;
  commissionFlatFeeCents?: number | null;
  referralFeeBasisPoints?: number | null;
  usedAssignedAgent?: boolean | null;
  agentAttribution?: string | null;
  referral?: { origin?: string | null } | null;
}

/**
 * Referral fee lost when the deal was terminated. Uses the amount saved at termination (an explicit
 * $0 is honored). Older deals without a saved amount are recovered only from this deal's own fee
 * inputs; the referral-wide fee is never used because it may belong to the other side of a
 * buy-and-sell referral and is cleared on termination anyway.
 */
export function resolveTerminatedDealLostFeeCents(payment: TerminatedDealFeeInput): number {
  if (
    typeof payment.terminatedExpectedAmountCents === 'number' &&
    Number.isFinite(payment.terminatedExpectedAmountCents)
  ) {
    return normalizeCents(payment.terminatedExpectedAmountCents);
  }

  const isNoFeeDeal =
    payment.referral?.origin === 'agent' ||
    payment.usedAssignedAgent === false ||
    payment.agentAttribution === 'OUTSIDE_AGENT';
  if (isNoFeeDeal) {
    return 0;
  }

  const remainingExpected = normalizeCents(payment.expectedAmountCents);
  if (remainingExpected > 0) {
    return remainingExpected;
  }

  const referralFeeBasisPoints = payment.referralFeeBasisPoints;
  if (referralFeeBasisPoints == null || referralFeeBasisPoints <= 0) {
    return 0;
  }

  const flatFee = payment.commissionFlatFeeCents;
  if (flatFee != null && flatFee > 0) {
    return normalizeCents((flatFee * referralFeeBasisPoints) / 10_000);
  }

  const contractPrice = payment.contractPriceCents;
  const commissionBasisPoints = payment.commissionBasisPoints;
  if (contractPrice != null && contractPrice > 0 && commissionBasisPoints != null && commissionBasisPoints > 0) {
    return normalizeCents((contractPrice * commissionBasisPoints * referralFeeBasisPoints) / 100_000_000);
  }

  return 0;
}

/**
 * Date a terminated deal is reported under. Deals terminated after `terminatedAt` was introduced use
 * the termination time; older deals keep the generic payment date they were reported under before.
 */
export function resolveTerminationReportDate(
  payment: { terminatedAt?: Date | string | null },
  legacyDate: Date
): Date {
  if (payment.terminatedAt != null) {
    const terminatedAt = new Date(payment.terminatedAt);
    if (!Number.isNaN(terminatedAt.getTime())) {
      return terminatedAt;
    }
  }
  return legacyDate;
}
