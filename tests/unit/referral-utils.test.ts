import { calculateReferralFeeDue } from '@/utils/referral';

describe('calculateReferralFeeDue', () => {
  it('uses tiered defaults when override not provided', () => {
    expect(calculateReferralFeeDue(350_000_00, 3000)).toBeGreaterThan(0);
  });

  it('respects override basis points', () => {
    const result = calculateReferralFeeDue(500_000_00, 3000, 4000);
    expect(result).toBe(Math.round(((500_000_00 * 3000) / 10000) * (4000 / 10000)));
  });
});
