/**
 * Mortgage calculation utilities
 */

export type LoanType = 'conventional' | 'fha' | 'va' | 'usda' | 'jumbo';

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
  loanAmount: number;
  principalAndInterest: number;
  propertyTaxes: number;
  pmiMonthly: number;
  totalMonthly: number;
  totalInterest: number;
  ltv: number;
  fundingFee?: number; // For VA loans
  upfrontMIP?: number; // For FHA loans
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
  const price = Math.max(asNumber(inputs.purchasePrice), 0);
  const dpPercent = Math.min(Math.max(asNumber(inputs.downPaymentPercent), 0), 100);
  const downPaymentAmount = price * (dpPercent / 100);
  let loanAmount = Math.max(price - downPaymentAmount, 0);
  const monthlyRate = Math.max(asNumber(inputs.interestRate), 0) / 100 / 12;
  const totalPayments = Math.max(Math.floor(asNumber(inputs.termYears) * 12), 1);

  // Loan type specific adjustments
  let fundingFee = 0;
  let upfrontMIP = 0;

  if (inputs.loanType === 'va') {
    // VA funding fee (2.3% for first use with 0 down, lower with down payment)
    const fundingFeeRate = dpPercent === 0 ? 0.023 : dpPercent >= 10 ? 0.013 : 0.018;
    fundingFee = loanAmount * fundingFeeRate;
    loanAmount += fundingFee; // Add funding fee to loan
  } else if (inputs.loanType === 'fha') {
    // FHA upfront MIP (1.75% of base loan)
    upfrontMIP = loanAmount * 0.0175;
    loanAmount += upfrontMIP; // Add upfront MIP to loan
  }

  const principalAndInterest = monthlyRate
    ? loanAmount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalPayments)))
    : loanAmount / totalPayments;

  const propertyTaxes = (price * (Math.max(asNumber(inputs.propertyTaxRate), 0) / 100)) / 12;
  
  // PMI/MIP calculation varies by loan type
  let pmiMonthly = 0;
  if (inputs.loanType === 'fha') {
    // FHA MIP is based on loan amount, typically 0.55% annually for >95% LTV
    pmiMonthly = (loanAmount * 0.0055) / 12;
  } else if (inputs.loanType === 'conventional' || !inputs.loanType) {
    // Conventional PMI only if <20% down
    pmiMonthly = dpPercent < 20 ? (loanAmount * (Math.max(asNumber(inputs.pmiRate), 0) / 100)) / 12 : 0;
  }
  // VA and USDA don't have monthly PMI

  const totalMonthly =
    principalAndInterest +
    propertyTaxes +
    Math.max(inputs.insuranceMonthly, 0) +
    Math.max(inputs.hoaMonthly, 0) +
    pmiMonthly +
    Math.max(inputs.extraPrincipal, 0);

  const totalInterest = principalAndInterest * totalPayments - loanAmount;
  const ltv = loanAmount && price ? loanAmount / price : 0;

  return {
    downPaymentAmount,
    loanAmount,
    principalAndInterest,
    propertyTaxes,
    pmiMonthly,
    totalMonthly,
    totalInterest,
    ltv,
    fundingFee: fundingFee > 0 ? fundingFee : undefined,
    upfrontMIP: upfrontMIP > 0 ? upfrontMIP : undefined,
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
 * Calculate affordability (reverse calculation from budget)
 */
export function calculateAffordability(params: {
  monthlyBudget: number;
  downPaymentAmount: number;
  interestRate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  pmiRate: number;
  monthlyDebts?: number;
  grossMonthlyIncome?: number;
}): {
  maxPurchasePrice: number;
  maxLoanAmount: number;
  recommendedDownPaymentPercent: number;
  debtToIncomeRatio: number | null;
  housingExpenseRatio: number | null;
} {
  const monthlyRate = Math.max(asNumber(params.interestRate), 0) / 100 / 12;
  const totalPayments = Math.max(Math.floor(asNumber(params.termYears) * 12), 1);
  
  // Iterative approach to find max purchase price
  // We need to account for: P&I, property taxes, insurance, HOA, and PMI
  let estimatedPrice = 0;
  let iterations = 0;
  const maxIterations = 20;
  const tolerance = 1; // Within $1

  // Start with a reasonable estimate: assume 80% of budget goes to P&I
  let initialAvailableForPI = params.monthlyBudget - params.insuranceMonthly - params.hoaMonthly;
  let initialMaxLoan = monthlyRate > 0
    ? initialAvailableForPI * 0.8 * ((1 - Math.pow(1 + monthlyRate, -totalPayments)) / monthlyRate)
    : initialAvailableForPI * 0.8 * totalPayments;
  estimatedPrice = initialMaxLoan + params.downPaymentAmount;

  while (iterations < maxIterations) {
    // Calculate all monthly expenses based on current price estimate
    const propertyTaxes = (estimatedPrice * (params.propertyTaxRate / 100)) / 12;
    const loanAmount = estimatedPrice - params.downPaymentAmount;
    const ltv = estimatedPrice > 0 ? loanAmount / estimatedPrice : 0;
    const pmiMonthly = ltv > 0.8 ? (loanAmount * (params.pmiRate / 100)) / 12 : 0;

    // Calculate what's left for Principal & Interest
    const availableForPI = Math.max(
      params.monthlyBudget - params.insuranceMonthly - params.hoaMonthly - propertyTaxes - pmiMonthly,
      0
    );

    // Calculate max loan amount based on available P&I
    const maxLoan = monthlyRate > 0
      ? availableForPI * ((1 - Math.pow(1 + monthlyRate, -totalPayments)) / monthlyRate)
      : availableForPI * totalPayments;

    // Calculate new estimated price
    const newEstimatedPrice = maxLoan + params.downPaymentAmount;

    // Check if we've converged
    if (Math.abs(newEstimatedPrice - estimatedPrice) < tolerance) {
      estimatedPrice = newEstimatedPrice;
      break;
    }

    estimatedPrice = newEstimatedPrice;
    iterations++;
  }

  const maxPurchasePrice = Math.max(estimatedPrice, 0);
  const maxLoanAmount = Math.max(maxPurchasePrice - params.downPaymentAmount, 0);
  const recommendedDownPaymentPercent = maxPurchasePrice > 0 
    ? (params.downPaymentAmount / maxPurchasePrice) * 100 
    : 0;

  let debtToIncomeRatio = null;
  let housingExpenseRatio = null;

  if (params.grossMonthlyIncome) {
    const totalMonthlyDebts = (params.monthlyDebts || 0) + params.monthlyBudget;
    debtToIncomeRatio = totalMonthlyDebts / params.grossMonthlyIncome;
    housingExpenseRatio = params.monthlyBudget / params.grossMonthlyIncome;
  }

  return {
    maxPurchasePrice,
    maxLoanAmount,
    recommendedDownPaymentPercent,
    debtToIncomeRatio,
    housingExpenseRatio,
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
