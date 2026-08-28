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
/** FHA annual MIP runs for the full term above this LTV, and 11 years at or below it. */
export const FHA_MIP_LIFETIME_LTV = 0.9;
/** FHA annual MIP term for loans at or below 90% LTV. */
export const FHA_MIP_TERM_MONTHS = 132;

/** Down payment at which the VA funding fee steps down, as a percent. */
const VA_FEE_TIER_PERCENTS = [0, 5, 10] as const;

/**
 * VA funding fee for a purchase loan, tiered by down payment. Rates are the
 * schedule in force since 2023; review whenever Congress revisits the fee.
 */
export function getVaFundingFeePercent(downPaymentPercent: number, subsequentUse = false): number {
  if (downPaymentPercent >= 10) return 1.25;
  if (downPaymentPercent >= 5) return 1.5;
  return subsequentUse ? 3.3 : 2.15;
}

/**
 * Every VA funding fee rate that a purchase could land on, so a solver can test
 * each tier when it does not yet know the down payment percent.
 */
export function getVaFundingFeePercentTiers(subsequentUse = false): number[] {
  return Array.from(
    new Set(VA_FEE_TIER_PERCENTS.map((tier) => getVaFundingFeePercent(tier, subsequentUse)))
  );
}

/**
 * Upfront fee financed into the loan balance, as a percent of the base loan.
 */
export function getFinancedFeePercent(
  loanType: LoanType,
  downPaymentPercent: number,
  vaSubsequentUse = false
): number {
  switch (loanType) {
    case 'fha':
      return FHA_UPFRONT_MIP_PERCENT;
    case 'va':
      return getVaFundingFeePercent(downPaymentPercent, vaSubsequentUse);
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
  /** VA only. A repeat VA buyer with under 5% down pays a higher funding fee. */
  vaSubsequentUse?: boolean;
}

export interface MortgageCalculations {
  downPaymentAmount: number;
  baseLoanAmount: number;
  loanAmount: number;
  principalAndInterest: number;
  propertyTaxes: number;
  pmiMonthly: number;
  totalMonthly: number;
  /**
   * Interest paid if every payment is exactly the scheduled amount. Extra
   * principal is deliberately excluded, so read the amortization schedule when
   * you need what the borrower would actually pay.
   */
  totalScheduledInterest: number;
  ltv: number;
  /** LTV before any financed upfront fee is added to the loan. */
  baseLtv: number;
  /** Total upfront fee rolled into the loan, whatever the program calls it. */
  financedFeeAmount: number;
  /**
   * How many months mortgage insurance is charged: `0` when the program or LTV
   * carries none, and `null` when it runs for the life of the loan.
   */
  mortgageInsuranceMonths: number | null;
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
 * Months of scheduled payments before the balance falls to `targetBalance`, or
 * `null` when it never gets there inside `maxMonths`.
 */
function monthsToReachBalance(params: {
  startingBalance: number;
  targetBalance: number;
  monthlyPayment: number;
  monthlyRate: number;
  extraPrincipal: number;
  maxMonths: number;
}): number | null {
  if (params.startingBalance <= params.targetBalance) return 0;

  let balance = params.startingBalance;
  for (let month = 1; month <= params.maxMonths; month++) {
    const interest = balance * params.monthlyRate;
    const principal = params.monthlyPayment - interest + params.extraPrincipal;
    if (principal <= 0) return null;

    balance = Math.max(balance - principal, 0);
    if (balance <= params.targetBalance) return month;
  }

  return null;
}

/**
 * How long monthly mortgage insurance is charged. `0` means none is due and
 * `null` means it runs for the life of the loan.
 */
function resolveMortgageInsuranceMonths(params: {
  loanType: LoanType;
  price: number;
  baseLtv: number;
  loanAmount: number;
  principalAndInterest: number;
  monthlyRate: number;
  extraPrincipal: number;
  totalPayments: number;
}): number | null {
  switch (params.loanType) {
    case 'va':
      return 0;
    case 'usda':
      // The annual fee runs alongside the loan for its whole term.
      return null;
    case 'fha':
      // Above 90% LTV the annual MIP never comes off; at or below it, 11 years.
      return params.baseLtv > FHA_MIP_LIFETIME_LTV
        ? null
        : Math.min(FHA_MIP_TERM_MONTHS, params.totalPayments);
    case 'conventional':
    case 'jumbo': {
      if (params.baseLtv <= CONVENTIONAL_MI_CANCEL_LTV) return 0;
      // Borrower-paid MI comes off once the balance reaches 80% of the original
      // value, which the servicer must honour on request.
      return monthsToReachBalance({
        startingBalance: params.loanAmount,
        targetBalance: params.price * CONVENTIONAL_MI_CANCEL_LTV,
        monthlyPayment: params.principalAndInterest,
        monthlyRate: params.monthlyRate,
        extraPrincipal: params.extraPrincipal,
        maxMonths: params.totalPayments,
      });
    }
    default: {
      const exhaustive: never = params.loanType;
      throw new Error(`Unhandled loan type: ${String(exhaustive)}`);
    }
  }
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
  const extraPrincipal = Math.max(asNumber(inputs.extraPrincipal), 0);

  // Upfront program fees are financed into the balance the payment is built on.
  const feePercent = getFinancedFeePercent(loanType, dpPercent, inputs.vaSubsequentUse);
  const financedFeeAmount = baseLoanAmount * (feePercent / 100);
  const loanAmount = baseLoanAmount + financedFeeAmount;

  const principalAndInterest = monthlyRate
    ? loanAmount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalPayments)))
    : loanAmount / totalPayments;

  const propertyTaxes = (price * (Math.max(asNumber(inputs.propertyTaxRate), 0) / 100)) / 12;

  const baseLtv = baseLoanAmount && price ? baseLoanAmount / price : 0;
  const pmiRate = Math.max(asNumber(inputs.pmiRate), 0);
  let pmiMonthly = 0;
  if (loanType === 'fha') {
    // FHA annual MIP runs on the financed balance, upfront premium included.
    pmiMonthly = (loanAmount * (pmiRate / 100)) / 12;
  } else if (loanType === 'usda') {
    pmiMonthly = (loanAmount * (USDA_ANNUAL_FEE_PERCENT / 100)) / 12;
  } else if (loanType === 'conventional' || loanType === 'jumbo') {
    pmiMonthly = baseLtv > CONVENTIONAL_MI_CANCEL_LTV ? (baseLoanAmount * (pmiRate / 100)) / 12 : 0;
  }
  // VA carries no monthly mortgage insurance.

  const totalMonthly =
    principalAndInterest +
    propertyTaxes +
    Math.max(inputs.insuranceMonthly, 0) +
    Math.max(inputs.hoaMonthly, 0) +
    pmiMonthly +
    extraPrincipal;

  const totalScheduledInterest = principalAndInterest * totalPayments - loanAmount;
  const ltv = loanAmount && price ? loanAmount / price : 0;

  return {
    downPaymentAmount,
    baseLoanAmount,
    loanAmount,
    principalAndInterest,
    propertyTaxes,
    pmiMonthly,
    totalMonthly,
    totalScheduledInterest,
    ltv,
    baseLtv,
    financedFeeAmount,
    mortgageInsuranceMonths:
      pmiMonthly > 0
        ? resolveMortgageInsuranceMonths({
            loanType,
            price,
            baseLtv,
            loanAmount,
            principalAndInterest,
            monthlyRate,
            extraPrincipal,
            totalPayments,
          })
        : 0,
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
      // The final payment is whatever clears the balance, not a full instalment.
      payment: principalPayment + interestPayment,
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
  const withoutExtra = generateAmortizationSchedule({ ...inputs, extraPrincipal: 0 }, calculations);
  const withExtra = generateAmortizationSchedule(inputs, calculations);

  const monthsSaved = withoutExtra.length - withExtra.length;
  // Both schedules are empty when there is nothing to repay, so default to zero
  // rather than subtracting two undefined balances into a NaN.
  const interestSaved =
    (withoutExtra.at(-1)?.cumulativeInterest ?? 0) - (withExtra.at(-1)?.cumulativeInterest ?? 0);

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
        hasPMI: true,
        hasUpfrontFee: false,
      };
    case 'conventional':
      return {
        name: 'Conventional',
        minDownPaymentPercent: 3,
        description: 'Standard conventional loan with flexible terms',
        hasPMI: true,
        hasUpfrontFee: false,
      };
    default: {
      const exhaustive: never = loanType;
      throw new Error(`Unhandled loan type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Whether a value coming from a URL, a saved payload, or a form is a loan type
 * this calculator understands.
 */
export function isLoanType(value: unknown): value is LoanType {
  return (
    value === 'conventional' ||
    value === 'fha' ||
    value === 'va' ||
    value === 'usda' ||
    value === 'jumbo'
  );
}
