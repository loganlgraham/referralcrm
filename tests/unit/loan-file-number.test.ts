import {
  createPendingLoanFileNumber,
  displayLoanFileNumber,
  isPendingLoanFileNumber,
} from '@/utils/loan-file-number';

describe('loan-file-number helpers', () => {
  it('creates unique pending placeholders', () => {
    const a = createPendingLoanFileNumber();
    const b = createPendingLoanFileNumber();
    expect(isPendingLoanFileNumber(a)).toBe(true);
    expect(isPendingLoanFileNumber(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('hides pending values for display', () => {
    expect(displayLoanFileNumber(createPendingLoanFileNumber())).toBe('');
    expect(displayLoanFileNumber(null)).toBe('');
    expect(displayLoanFileNumber(undefined)).toBe('');
    expect(displayLoanFileNumber('12345678901')).toBe('12345678901');
  });
});
