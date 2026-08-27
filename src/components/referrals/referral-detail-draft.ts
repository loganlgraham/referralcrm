export type ReferralClientType = 'Seller' | 'Buyer' | 'Both';
export type TransferStage = 'Pre-approval TBD' | 'Pre-approved';

export interface DetailDraft {
  borrowerFirstName: string;
  borrowerLastName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  loanFileNumber: string;
  source: string;
  endorser: string;
  clientType: ReferralClientType;
  lookingInZip: string;
  borrowerCurrentAddress: string;
  stageOnTransfer: TransferStage;
  loanType: string;
  preApprovalAmount: string;
  timeline: 'asap' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months' | 'not_specified';
  referralDate: string;
}

export const sanitizeCurrencyInput = (value: string) => {
  if (!value) {
    return '';
  }
  const stripped = value.replace(/[^0-9.]/g, '');
  if (!stripped) {
    return '';
  }

  const [integerPart = '', ...decimalParts] = stripped.split('.');
  const decimalPart = decimalParts.join('').slice(0, 2);
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const hasDecimal = decimalParts.length > 0;
  const safeInteger = normalizedInteger || (integerPart.length > 0 ? '0' : '');

  if (!hasDecimal) {
    return safeInteger;
  }

  const integerPortion = safeInteger || '0';
  return decimalPart.length > 0 ? `${integerPortion}.${decimalPart}` : `${integerPortion}.`;
};

export const formatCurrencyInputDisplay = (value: string) => {
  if (!value) {
    return '';
  }

  const [integerPart = '', decimalPart] = value.split('.');
  const hasDecimal = decimalPart !== undefined;
  const sanitizedInteger = integerPart.replace(/[^0-9]/g, '');
  const integerValue = sanitizedInteger ? Number(sanitizedInteger) : 0;
  const formattedInteger = sanitizedInteger
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(integerValue)
    : '';

  if (!hasDecimal) {
    return formattedInteger;
  }

  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};
