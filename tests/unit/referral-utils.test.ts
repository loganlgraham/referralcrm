import {
  calculateReferralFeeDue,
  defaultReferralFeeBasisPoints,
  resolveAgentDealExpectedCents,
  resolveDealReferralFeeBasisPoints
} from '@/utils/referral';

describe('defaultReferralFeeBasisPoints', () => {
  it('uses 25% at or below $400k and 35% above', () => {
    expect(defaultReferralFeeBasisPoints(399_999_00)).toBe(2500);
    expect(defaultReferralFeeBasisPoints(400_000_00)).toBe(2500);
    expect(defaultReferralFeeBasisPoints(400_000_01)).toBe(3500);
    expect(defaultReferralFeeBasisPoints(500_000_00)).toBe(3500);
  });
});

describe('calculateReferralFeeDue', () => {
  it('uses tiered defaults when override not provided', () => {
    expect(calculateReferralFeeDue(350_000_00, 3000)).toBeGreaterThan(0);
  });

  it('respects override basis points', () => {
    const result = calculateReferralFeeDue(500_000_00, 3000, 4000);
    expect(result).toBe(Math.round(((500_000_00 * 3000) / 10000) * (4000 / 10000)));
  });

  it('returns zero when override basis points are explicitly 0 (no tier fallback)', () => {
    expect(calculateReferralFeeDue(500_000_00, 3000, 0)).toBe(0);
  });

  it('computes $5,250 for a $500k deal at 3% commission and the 35% tier', () => {
    expect(calculateReferralFeeDue(500_000_00, 300)).toBe(525_000);
  });
});

describe('resolveDealReferralFeeBasisPoints', () => {
  it('keeps an explicit override and explicit 0%', () => {
    expect(resolveDealReferralFeeBasisPoints(500_000_00, 4000)).toBe(4000);
    expect(resolveDealReferralFeeBasisPoints(500_000_00, 0)).toBe(0);
  });

  it('falls back to the $400k tier when the stored fee is missing', () => {
    expect(resolveDealReferralFeeBasisPoints(399_999_00, null)).toBe(2500);
    expect(resolveDealReferralFeeBasisPoints(500_000_00, null)).toBe(3500);
  });
});

describe('resolveAgentDealExpectedCents', () => {
  it('computes $5,250 when expected is $0 and referral fee was never set', () => {
    expect(
      resolveAgentDealExpectedCents({
        status: 'under_contract',
        expectedAmountCents: 0,
        referralFeeBasisPoints: null,
        contractPriceCents: 500_000_00,
        commissionBasisPoints: 300
      })
    ).toBe(525_000);
  });

  it('uses the stored expected amount when it is already set', () => {
    expect(
      resolveAgentDealExpectedCents({
        status: 'under_contract',
        expectedAmountCents: 400_000,
        referralFeeBasisPoints: null,
        contractPriceCents: 500_000_00,
        commissionBasisPoints: 300
      })
    ).toBe(400_000);
  });

  it('stays at $0 for an explicit 0% referral fee', () => {
    expect(
      resolveAgentDealExpectedCents({
        status: 'under_contract',
        expectedAmountCents: 0,
        referralFeeBasisPoints: 0,
        contractPriceCents: 500_000_00,
        commissionBasisPoints: 300
      })
    ).toBe(0);
  });

  it('does not compute a live fee for terminated deals', () => {
    expect(
      resolveAgentDealExpectedCents({
        status: 'terminated',
        expectedAmountCents: 0,
        referralFeeBasisPoints: null,
        contractPriceCents: 500_000_00,
        commissionBasisPoints: 300
      })
    ).toBe(0);
  });
});
