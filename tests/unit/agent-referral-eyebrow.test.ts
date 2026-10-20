import { describe, expect, it } from '@jest/globals';
import {
  describeAgentReferralEyebrow,
  formatReferredDate,
  pickAgentReferralEyebrowFact
} from '@/components/referrals/agent-referral-shared';

const REFERRED_AT = '2026-08-20T18:00:00.000Z';

describe('describeAgentReferralEyebrow', () => {
  it('uses pre-approval amount first', () => {
    expect(
      describeAgentReferralEyebrow({
        clientType: 'Buyer',
        preApprovalAmountCents: 45_000_000,
        lookingIn: '80202',
        loanType: 'Conventional',
        referredAt: REFERRED_AT
      })
    ).toBe('Buyer · pre-approved up to $450,000');
  });

  it('falls back to looking-in when there is no pre-approval', () => {
    expect(
      describeAgentReferralEyebrow({
        clientType: 'Buyer',
        lookingInZips: ['80202', '80203'],
        loanType: 'Conventional',
        referredAt: REFERRED_AT
      })
    ).toBe('Buyer · looking in 80202, 80203');
  });

  it('falls back to loan type when looking-in is empty', () => {
    expect(
      describeAgentReferralEyebrow({
        clientType: 'Seller',
        lookingInZip: '   ',
        loanType: 'VA',
        referredAt: REFERRED_AT
      })
    ).toBe('Seller · VA');
  });

  it('falls back to referred date last', () => {
    expect(
      describeAgentReferralEyebrow({
        clientType: 'Both',
        referredAt: REFERRED_AT
      })
    ).toBe(`Buyer & seller · referred ${formatReferredDate(REFERRED_AT)}`);
  });

  it('returns only the client side when nothing else is available', () => {
    expect(describeAgentReferralEyebrow({ clientType: 'Buyer' })).toBe('Buyer');
  });

  it('skips referred date when includeReferredDate is false', () => {
    expect(
      describeAgentReferralEyebrow({
        clientType: 'Buyer',
        referredAt: REFERRED_AT,
        includeReferredDate: false
      })
    ).toBe('Buyer');
  });
});

describe('pickAgentReferralEyebrowFact', () => {
  it('ignores a zero pre-approval amount', () => {
    const fact = pickAgentReferralEyebrowFact({
      preApprovalAmountCents: 0,
      lookingIn: '80202'
    });
    expect(fact).toEqual({ kind: 'looking-in', text: 'looking in 80202' });
  });

  it('prefers a joined lookingIn string over zip fields', () => {
    const fact = pickAgentReferralEyebrowFact({
      lookingIn: 'Denver, CO',
      lookingInZip: '80202'
    });
    expect(fact).toEqual({ kind: 'looking-in', text: 'looking in Denver, CO' });
  });
});
