import {
  generateFeeBreakdownEmailHTML,
  generateFeeBreakdownSubject,
  type FeeBreakdownEmailData,
} from '@/lib/email-templates/fee-breakdown';
import { hasFeeBreakdownFinancialData } from '@/lib/fee-verification';

const baseData: FeeBreakdownEmailData = {
  agent: { name: 'Sam Agent', email: 'sam@example.com' },
  referral: { borrowerName: 'Jamie Lee', propertyAddress: '123 Main St' },
  deal: {
    closingDate: '2026-11-15',
    contractPriceCents: 45000000,
    commissionBasisPoints: 250,
    referralFeeBasisPoints: 2500,
    side: 'buy',
    usedAfc: true,
  },
  platformUrl: 'https://referrio.app/referrals/abc',
};

describe('generateFeeBreakdownSubject', () => {
  it('congratulates on the first send using the client first name', () => {
    expect(generateFeeBreakdownSubject('Jamie Lee', { isFirstSend: true })).toBe(
      'Congrats on getting Jamie under contract!'
    );
  });

  it('falls back to "your client" when there is no usable name', () => {
    expect(generateFeeBreakdownSubject('Unknown', { isFirstSend: true })).toBe(
      'Congrats on getting your client under contract!'
    );
    expect(generateFeeBreakdownSubject('', { isFirstSend: true })).toBe(
      'Congrats on getting your client under contract!'
    );
  });

  it('keeps the referral fee subject on resends', () => {
    expect(generateFeeBreakdownSubject('Jamie Lee')).toBe('American Home Agents Referral Fee - Lee');
    expect(generateFeeBreakdownSubject('Jamie Lee', { isFirstSend: false })).toBe(
      'American Home Agents Referral Fee - Lee'
    );
  });
});

describe('generateFeeBreakdownEmailHTML first send + verification', () => {
  it('opens with the under-contract congrats paragraph on the first send', () => {
    const { html, text } = generateFeeBreakdownEmailHTML({ ...baseData, isFirstSend: true });
    expect(html).toContain('Hi Sam, congratulations on getting <strong>Jamie</strong> under contract!');
    expect(text).toContain('Hi Sam, congratulations on getting Jamie under contract!');
    expect(text).not.toContain('on the upcoming closing for');
  });

  it('keeps the upcoming-closing intro on resends', () => {
    const { html, text } = generateFeeBreakdownEmailHTML(baseData);
    expect(html).not.toContain('under contract!');
    expect(text).toContain('on the upcoming closing for Jamie Lee');
  });

  it('includes confirm and report links when verification URLs are provided', () => {
    const { html, text } = generateFeeBreakdownEmailHTML({
      ...baseData,
      verification: {
        confirmUrl: 'https://referrio.app/verify-fee?token=abc&action=confirm',
        reportUrl: 'https://referrio.app/verify-fee?token=abc&action=report',
      },
    });
    expect(html).toContain('Do these numbers look right?');
    expect(html).toContain('Yes, looks correct');
    expect(html).toContain('Something looks off');
    expect(html).toContain('https://referrio.app/verify-fee?token=abc&amp;action=confirm');
    expect(html).toContain('https://referrio.app/verify-fee?token=abc&amp;action=report');
    expect(text).toContain('Yes, looks correct: https://referrio.app/verify-fee?token=abc&action=confirm');
    expect(text).toContain('Something looks off: https://referrio.app/verify-fee?token=abc&action=report');
  });

  it('omits the verification card without URLs', () => {
    const { html } = generateFeeBreakdownEmailHTML(baseData);
    expect(html).not.toContain('Do these numbers look right?');
  });
});

describe('hasFeeBreakdownFinancialData', () => {
  it('treats an explicit 0% referral fee as present', () => {
    expect(
      hasFeeBreakdownFinancialData({
        contractPriceCents: 45000000,
        commissionBasisPoints: 250,
        referralFeeBasisPoints: 0,
      })
    ).toBe(true);
  });

  it('rejects a missing referral fee', () => {
    expect(
      hasFeeBreakdownFinancialData({
        contractPriceCents: 45000000,
        commissionBasisPoints: 250,
        referralFeeBasisPoints: null,
      })
    ).toBe(false);
  });
});
