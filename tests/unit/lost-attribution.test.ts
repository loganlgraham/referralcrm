import { LOST_REASON_VALUES } from '@/constants/referrals';
import { isAttributableLoss, isUnattributableLoss } from '@/lib/server/lost-attribution';

describe('isAttributableLoss', () => {
  it('does not count losses where we never connected with the borrower', () => {
    expect(isAttributableLoss({ status: 'Lost', lostReason: 'never_connected' })).toBe(false);
  });

  it('does not count losses where the borrower already had an agent', () => {
    expect(isAttributableLoss({ status: 'Lost', lostReason: 'already_had_agent' })).toBe(false);
  });

  it('does not count losses where another agent was chosen before we connected', () => {
    expect(
      isAttributableLoss({ status: 'Lost', lostReason: 'chose_other_agent_precontact' })
    ).toBe(false);
  });

  it('counts losses where another agent was chosen after ours was met', () => {
    expect(
      isAttributableLoss({ status: 'Lost', lostReason: 'chose_other_agent_postcontact' })
    ).toBe(true);
  });

  it('counts losses where the borrower went quiet after contact', () => {
    expect(
      isAttributableLoss({ status: 'Lost', lostReason: 'unresponsive_after_contact' })
    ).toBe(true);
  });

  it('counts unclassified losses so reason gaps cannot erase history', () => {
    expect(isAttributableLoss({ status: 'Lost', lostReason: null })).toBe(true);
    expect(isAttributableLoss({ status: 'Lost' })).toBe(true);
  });

  it('counts losses carrying a reason outside the taxonomy', () => {
    expect(isAttributableLoss({ status: 'Lost', lostReason: 'retired_reason' })).toBe(true);
  });

  it('returns false for referrals that are not Lost', () => {
    expect(isAttributableLoss({ status: 'Paired' })).toBe(false);
    expect(isAttributableLoss({ status: 'Closed', lostReason: 'service_issue' })).toBe(false);
    expect(isAttributableLoss({ status: null })).toBe(false);
    expect(isAttributableLoss({})).toBe(false);
  });

  it('classifies every reason in the taxonomy', () => {
    for (const reason of LOST_REASON_VALUES) {
      expect(typeof isAttributableLoss({ status: 'Lost', lostReason: reason })).toBe('boolean');
    }
  });
});

describe('isUnattributableLoss', () => {
  it('is the inverse of isAttributableLoss for Lost referrals', () => {
    for (const reason of LOST_REASON_VALUES) {
      const referral = { status: 'Lost', lostReason: reason };
      expect(isUnattributableLoss(referral)).toBe(!isAttributableLoss(referral));
    }
  });

  it('is false for referrals that are not Lost', () => {
    expect(isUnattributableLoss({ status: 'Under Contract', lostReason: 'never_connected' })).toBe(
      false
    );
  });
});
