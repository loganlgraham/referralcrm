/**
 * Mortgage calculation utilities
 */

export type LoanType = 'conventional' | 'fha' | 'va' | 'usda' | 'jumbo';

/** Upfront FHA mortgage insurance premium, financed into the loan. */
export const FHA_UPFRONT_MIP_PERCENT = 1.75;
/** Typical FHA annual MIP for a 30-year loan above 95% LTV. */
export const FHA_DEFAULT_ANNUAL_MIP_PERCENT = 0.55;
/** USDA upfront guarantee fee, financed into the loan. */
export const USDA_GUARANTEE_FEE_PERCENT = 1;
/** USDA annual fee, collected monthly. */
export const USDA_ANNUAL_FEE_PERCENT = 0.35;
/** Conventional mortgage insurance drops off at or below this LTV. */
export const CONVENTIONAL_MI_CANCEL_LTV = 0.8;

/**
 * VA funding fee for a first-use purchase loan, tiered by down payment.
 */
export function getVaFundingFeePercent(downPaymentPercent: number): number {
  if (downPaymentPercent >= 10) return 1.3;
  if (downPaymentPercent > 0) return 1.8;
  return 2.3;
}

/**
 * Upfront fee financed into the loan balance, as a percent of the base loan.
 */
export function getFinancedFeePercent(loanType: LoanType, downPaymentPercent: number): number {
  switch (loanType) {
    case 'fha':
      return FHA_UPFRONT_MIP_PERCENT;
    case 'va':
      return getVaFundingFeePercent(downPaymentPercent);
    case 'usda':
      return USDA_GUARANTEE_FEE_PERCENT;
    case 'conventional':
    case 'jumbo':
      return 0;
    default: {
      const exhaustive: never = loanType;
      throw new Error(`Unhandled loan type: ${String(exhaustive)}`);
    }
  }
}

export interface MortgageInputs {
  purchasePrice: number;
  downPaymentPercent: number;
  interestRate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  pmiRate: number;
  extraPrincipal: number;
  loanType?: LoanType;
}

export interface MortgageCalculations {
  downPaymentAmount: number;
  baseLoanAmount: number;
  loanAmount: number;
  principalAndInterest: number;
  propertyTaxes: number;
  pmiMonthly: number;
  totalMonthly: number;
  totalInterest: number;
  ltv: number;
  /** LTV before any financed upfront fee is added to the loan. */
  baseLtv: number;
  /** Total upfront fee rolled into the loan, whatever the program calls it. */
  financedFeeAmount: number;
  fundingFee?: number; // For VA loans
  upfrontMIP?: number; // For FHA loans
  usdaGuaranteeFee?: number; // For USDA loans
}

export interface AmortizationEntry {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  extraPrincipal: number;
  totalPrincipal: number;
  balance: number;
  cumulativeInterest: number;
}

function asNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Calculate basic mortgage values
 */
export function calculateMortgage(inputs: MortgageInputs): MortgageCalculations {
  const loanType = inputs.loanType ?? 'conventional';
  const price = Math.max(asNumber(inputs.purchasePrice), 0);
  const dpPercent = Math.min(Math.max(asNumber(inputs.downPaymentPercent), 0), 100);
  const downPaymentAmount = price * (dpPercent / 100);
  const baseLoanAmount = Math.max(price - downPaymentAmount, 0);
  const monthlyRate = Math.max(asNumber(inputs.interestRate), 0) / 100 / 12;
  const totalPayments = Math.max(Math.floor(asNumber(inputs.termYears) * 12), 1);

  // Upfront program fees are financed into the balance the payment is built on.
  const financedFeeAmount = baseLoanAmount * (getFinancedFeePercent(loanType, dpPercent) / 100);
  const loanAmount = baseLoanAmount + financedFeeAmount;

  const principalAndInterest = monthlyRate
    ? loanAmount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalPayments)))
    : loanAmount / totalPayments;

  const propertyTaxes = (price * (Math.max(asNumber(inputs.propertyTaxRate), 0) / 100)) / 12;

  const pmiRate = Math.max(asNumber(inputs.pmiRate), 0);
  let pmiMonthly = 0;
  if (loanType === 'fha') {
    // FHA annual MIP runs on the financed balance for the life of most loans.
    pmiMonthly = (loanAmount * (pmiRate / 100)) / 12;
  } else if (loanType === 'usda') {
    pmiMonthly = (loanAmount * (USDA_ANNUAL_FEE_PERCENT / 100)) / 12;
  } else if (loanType === 'conventional') {
    const baseLtv = price > 0 ? baseLoanAmount / price : 0;
    pmiMonthly = baseLtv > CONVENTIONAL_MI_CANCEL_LTV ? (baseLoanAmount * (pmiRate / 100)) / 12 : 0;
  }
  // VA and jumbo carry no monthly mortgage insurance.

  const totalMonthly =
    principalAndInterest +
    propertyTaxes +
    Math.max(inputs.insuranceMonthly, 0) +
    Math.max(inputs.hoaMonthly, 0) +
    pmiMonthly +
    Math.max(inputs.extraPrincipal, 0);

  const totalInterest = principalAndInterest * totalPayments - loanAmount;
  const ltv = loanAmount && price ? loanAmount / price : 0;
  const baseLtv = baseLoanAmount && price ? baseLoanAmount / price : 0;

  return {
    downPaymentAmount,
    baseLoanAmount,
    loanAmount,
    principalAndInterest,
    propertyTaxes,
    pmiMonthly,
    totalMonthly,
    totalInterest,
    ltv,
    baseLtv,
    financedFeeAmount,
    fundingFee: loanType === 'va' && financedFeeAmount > 0 ? financedFeeAmount : undefined,
    upfrontMIP: loanType === 'fha' && financedFeeAmount > 0 ? financedFeeAmount : undefined,
    usdaGuaranteeFee: loanType === 'usda' && financedFeeAmount > 0 ? financedFeeAmount : undefined,
  };
}

/**
 * Generate full amortization schedule
 */
export function generateAmortizationSchedule(
  inputs: MortgageInputs,
  calculations: MortgageCalculations
): AmortizationEntry[] {
  const schedule: AmortizationEntry[] = [];
  const monthlyRate = Math.max(asNumber(inputs.interestRate), 0) / 100 / 12;
  const totalPayments = Math.max(Math.floor(asNumber(inputs.termYears) * 12), 1);
  const extraPrincipalPayment = Math.max(asNumber(inputs.extraPrincipal), 0);

  let balance = calculations.loanAmount;
  let cumulativeInterest = 0;

  for (let month = 1; month <= totalPayments && balance > 0.01; month++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = Math.min(calculations.principalAndInterest - interestPayment, balance);
    const extraPrincipalApplied = Math.min(extraPrincipalPayment, balance - principalPayment);
    const totalPrincipalPayment = principalPayment + extraPrincipalApplied;

    balance = Math.max(balance - totalPrincipalPayment, 0);
    cumulativeInterest += interestPayment;

    schedule.push({
      month,
      payment: calculations.principalAndInterest,
      principal: principalPayment,
      interest: interestPayment,
      extraPrincipal: extraPrincipalApplied,
      totalPrincipal: totalPrincipalPayment,
      balance,
      cumulativeInterest,
    });

    if (balance < 0.01) break;
  }

  return schedule;
}

/**
 * Calculate extra principal impact
 */
export function calculateExtraPrincipalImpact(
  inputs: MortgageInputs,
  calculations: MortgageCalculations
) {
  // Calculate without extra principal
  const withoutExtra = generateAmortizationSchedule(
    { ...inputs, extraPrincipal: 0 },
    { ...calculations, totalMonthly: calculations.totalMonthly - inputs.extraPrincipal }
  );

  // Calculate with extra principal
  const withExtra = generateAmortizationSchedule(inputs, calculations);

  const monthsSaved = withoutExtra.length - withExtra.length;
  const interestSaved =
    withoutExtra[withoutExtra.length - 1]?.cumulativeInterest -
    withExtra[withExtra.length - 1]?.cumulativeInterest;

  const originalPayoffDate = new Date();
  originalPayoffDate.setMonth(originalPayoffDate.getMonth() + withoutExtra.length);

  const newPayoffDate = new Date();
  newPayoffDate.setMonth(newPayoffDate.getMonth() + withExtra.length);

  return {
    monthsSaved,
    yearsSaved: monthsSaved / 12,
    interestSaved: Math.max(interestSaved, 0),
    originalPayoffDate,
    newPayoffDate,
    originalMonths: withoutExtra.length,
    newMonths: withExtra.length,
  };
}

/**
 * Get loan type requirements and info
 */
export function getLoanTypeInfo(loanType: LoanType): {
  name: string;
  minDownPaymentPercent: number;
  description: string;
  hasPMI: boolean;
  hasUpfrontFee: boolean;
} {
  switch (loanType) {
    case 'fha':
      return {
        name: 'FHA',
        minDownPaymentPercent: 3.5,
        description: 'Federal Housing Administration loan with lower down payment requirements',
        hasPMI: true,
        hasUpfrontFee: true,
      };
    case 'va':
      return {
        name: 'VA',
        minDownPaymentPercent: 0,
        description: 'Veterans Affairs loan with no down payment for eligible service members',
        hasPMI: false,
        hasUpfrontFee: true,
      };
    case 'usda':
      return {
        name: 'USDA',
        minDownPaymentPercent: 0,
        description: 'USDA Rural Development loan for eligible rural properties',
        hasPMI: false,
        hasUpfrontFee: true,
      };
    case 'jumbo':
      return {
        name: 'Jumbo',
        minDownPaymentPercent: 10,
        description: 'Jumbo loan for high-value properties exceeding conforming loan limits',
        hasPMI: false,
        hasUpfrontFee: false,
      };
    case 'conventional':
    default:
      return {
        name: 'Conventional',
        minDownPaymentPercent: 3,
        description: 'Standard conventional loan with flexible terms',
        hasPMI: true,
        hasUpfrontFee: false,
      };
  }
}
