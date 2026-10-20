export const FEE_VERIFICATION_STATUSES = ['pending', 'confirmed', 'disputed', 'superseded'] as const;
export type FeeVerificationStatus = (typeof FEE_VERIFICATION_STATUSES)[number];
/** Status mirrored onto the payment: only the latest emailed link's response. */
export type FeeBreakdownVerificationStatus = Exclude<FeeVerificationStatus, 'superseded'>;

export const FEE_VERIFICATION_FIELDS = ['contractPrice', 'commission', 'referralFee', 'closingDate'] as const;
export type FeeVerificationField = (typeof FEE_VERIFICATION_FIELDS)[number];

export const FEE_VERIFICATION_TTL_DAYS = 60;

export function hasFeeBreakdownFinancialData<
  T extends {
    contractPriceCents?: number | null;
    commissionBasisPoints?: number | null;
    commissionFlatFeeCents?: number | null;
    referralFeeBasisPoints?: number | null;
  },
>(
  payment: T
): payment is T & { contractPriceCents: number; referralFeeBasisPoints: number } {
  const hasCommission =
    (payment.commissionBasisPoints != null && payment.commissionBasisPoints > 0) ||
    (payment.commissionFlatFeeCents != null && payment.commissionFlatFeeCents > 0);
  return (
    typeof payment.contractPriceCents === 'number' &&
    payment.contractPriceCents > 0 &&
    hasCommission &&
    typeof payment.referralFeeBasisPoints === 'number'
  );
}

export type FeeVerificationLandingView = 'review' | 'report' | 'confirmed' | 'reported' | 'invalid';

/** Where a fee link should open, including links that were already answered. */
export function feeVerificationLandingView(
  status: FeeVerificationStatus,
  action: string | null
): FeeVerificationLandingView {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'disputed':
      return 'reported';
    case 'superseded':
      return 'invalid';
    case 'pending':
      return action === 'report' ? 'report' : 'review';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function feeVerificationFieldLabel(field: FeeVerificationField): string {
  switch (field) {
    case 'contractPrice':
      return 'Contract price';
    case 'commission':
      return 'Agent commission';
    case 'referralFee':
      return 'Referral fee';
    case 'closingDate':
      return 'Closing date';
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

export interface FeeVerificationSnapshot {
  contractPriceCents: number;
  commissionBasisPoints: number | null;
  commissionFlatFeeCents: number | null;
  referralFeeBasisPoints: number;
}

export interface FeeVerificationAmounts {
  contractPriceCents: number;
  isFlatFee: boolean;
  commissionPercent: number | null;
  commissionCents: number;
  referralFeePercent: number;
  referralFeeCents: number;
  netCommissionCents: number;
}

export function computeFeeVerificationAmounts(snapshot: FeeVerificationSnapshot): FeeVerificationAmounts {
  const isFlatFee = snapshot.commissionFlatFeeCents != null && snapshot.commissionFlatFeeCents > 0;
  const commissionCents = isFlatFee
    ? (snapshot.commissionFlatFeeCents as number)
    : Math.round((snapshot.contractPriceCents * (snapshot.commissionBasisPoints ?? 0)) / 10000);
  const referralFeeCents = Math.round((commissionCents * snapshot.referralFeeBasisPoints) / 10000);
  return {
    contractPriceCents: snapshot.contractPriceCents,
    isFlatFee,
    commissionPercent: isFlatFee ? null : (snapshot.commissionBasisPoints ?? 0) / 100,
    commissionCents,
    referralFeePercent: snapshot.referralFeeBasisPoints / 100,
    referralFeeCents,
    netCommissionCents: commissionCents - referralFeeCents,
  };
}
