const PENDING_LOAN_FILE_PREFIX = '__pending__';

/** Unique placeholder so agent-created referrals satisfy the unique loanFileNumber index before admin fills a real value. */
export const createPendingLoanFileNumber = (): string =>
  `${PENDING_LOAN_FILE_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const isPendingLoanFileNumber = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.startsWith(PENDING_LOAN_FILE_PREFIX);

/** Hide pending placeholders in UI / emails — treat as no file number yet. */
export const displayLoanFileNumber = (value: string | null | undefined): string => {
  if (!value || isPendingLoanFileNumber(value)) {
    return '';
  }
  return value;
};
