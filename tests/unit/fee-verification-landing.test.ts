import { feeVerificationLandingView } from '@/lib/fee-verification';

describe('feeVerificationLandingView', () => {
  it('opens a fresh link on the review or report form', () => {
    expect(feeVerificationLandingView('pending', null)).toBe('review');
    expect(feeVerificationLandingView('pending', 'confirm')).toBe('review');
    expect(feeVerificationLandingView('pending', 'report')).toBe('report');
  });

  it('opens an answered link on the result, not the form', () => {
    expect(feeVerificationLandingView('confirmed', 'confirm')).toBe('confirmed');
    expect(feeVerificationLandingView('disputed', 'report')).toBe('reported');
    expect(feeVerificationLandingView('superseded', null)).toBe('invalid');
  });
});
