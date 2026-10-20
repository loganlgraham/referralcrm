/**
 * Affordability (pre-qualification) math.
 *
 * Monthly housing cost is linear in purchase price on each mortgage-insurance
 * branch, so the maximum price has a closed-form solution. With
 *   pf  = payment factor r / (1 - (1 + r)^-n)
 *   f   = 1 + financed upfront fee rate
 *   t   = monthly property tax per dollar of price
 *   mi  = monthly mortgage insurance per dollar of the insured balance
 *   k   = pf * f + mi * (insured-balance multiplier)
 * the monthly allowance A satisfies
 *   A = k * (P - D) + t * P + insurance + hoa
 * which rearranges to an exact price. Mortgage insurance and the VA funding fee
 * both depend on the down payment percent, which depends on price, so each
 * discrete branch is solved and only the self-consistent one is kept.
 */

import {
  CONVENTIONAL_MI_CANCEL_LTV,
  FHA_DEFAULT_ANNUAL_MIP_PERCENT,
  USDA_ANNUAL_FEE_PERCENT,
  calculateMortgage,
  getFinancedFeePercent,
  getLoanTypeInfo,
  getVaFundingFeePercentTiers,
  type LoanType,
} from './mortgage-calculations';

/**
 * FHFA baseline conforming loan limit for a one-unit property, 2026. Review
 * every January, and let agents override it for high-cost counties.
 */
export const DEFAULT_CONFORMING_LOAN_LIMIT = 832_750;

/** Never round an approval number up. */
const PRICE_ROUNDING_STEP = 1_000;

export type DownPaymentMode = 'amount' | 'percent';

export type BindingConstraint =
  | 'front-end-dti'
  | 'back-end-dti'
  | 'comfort-budget'
  | 'cash-to-close'
  | 'minimum-down'
  | 'mortgage-insurance-cliff'
  | 'no-qualifying-income';

export type MortgageInsuranceBasis = 'none' | 'base-loan' | 'financed-loan';

export interface ProgramGuidelines {
  name: string;
  minDownPaymentPercent: number;
  /** Housing-payment-to-income cap, or null when the program does not use one. */
  frontEndCapPercent: number | null;
  /** Total-debt-to-income cap. */
  backEndCapPercent: number;
  defaultAnnualMiPercent: number;
  miBasis: MortgageInsuranceBasis;
  /** LTV at or below which mortgage insurance drops off, null when it never does. */
  miCancelsAtLtv: number | null;
  requiresResidualIncomeReview: boolean;
  guidelineNote: string;
}

export interface AffordabilityInput {
  loanType: LoanType;
  /** VA only. A repeat VA buyer with under 5% down pays a higher funding fee. */
  vaSubsequentUse?: boolean;
  grossMonthlyIncome: number;
  monthlyDebts: number;
  downPaymentMode: DownPaymentMode;
  downPaymentAmount: number;
  downPaymentPercent: number;
  /** Total cash available for down payment plus closing costs, or null to ignore. */
  cashOnHand: number | null;
  closingCostPercent: number;
  /** What the buyer says they want to pay each month, or null to ignore. */
  comfortBudget: number | null;
  interestRate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  annualMiRate: number;
  frontEndCapPercent: number | null;
  backEndCapPercent: number;
  conformingLoanLimit: number;
}

export interface AffordabilityWarning {
  id: string;
  severity: 'info' | 'warning';
  message: string;
}

export interface BuyingPowerLever {
  id: string;
  label: string;
  maxPurchasePrice: number;
  priceDelta: number;
}

export interface BuyingPowerLevers {
  /** Price gained for every $100 per month freed up, on the solved branch. */
  pricePerHundredMonthly: number;
  debtPaydown: BuyingPowerLever[];
  rateShifts: BuyingPowerLever[];
  extraDownPayment: BuyingPowerLever[];
  incomeIncrease: BuyingPowerLever[];
}

export interface AffordabilityResult {
  maxPurchasePrice: number;
  /** Monthly allowance for housing before price caps were applied. */
  monthlyAllowance: number;
  bindingConstraint: BindingConstraint;
  downPaymentAmount: number;
  downPaymentPercent: number;
  baseLoanAmount: number;
  financedFeeAmount: number;
  totalLoanAmount: number;
  baseLtv: number;
  principalAndInterest: number;
  propertyTaxes: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  mortgageInsuranceMonthly: number;
  /** Months mortgage insurance is charged; `0` for none, `null` for the full term. */
  mortgageInsuranceMonths: number | null;
  totalMonthlyPayment: number;
  closingCosts: number;
  cashToClose: number;
  frontEndRatio: number | null;
  backEndRatio: number | null;
  /** Monthly dollars still available under the front-end cap. */
  frontEndHeadroom: number | null;
  backEndHeadroom: number | null;
  guidelines: ProgramGuidelines;
  warnings: AffordabilityWarning[];
  levers: BuyingPowerLevers;
}

/**
 * Monthly payment per dollar borrowed.
 */
export function paymentFactor(monthlyRate: number, termMonths: number): number {
  const months = Math.max(Math.floor(termMonths), 1);
  if (monthlyRate <= 0) return 1 / months;
  return monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
}

/**
 * Qualifying guidelines per program. Caps are the conservative manual-underwrite
 * numbers; automated underwriting routinely allows more, so they are editable.
 */
export function getProgramGuidelines(loanType: LoanType): ProgramGuidelines {
  const info = getLoanTypeInfo(loanType);
  const base = {
    name: info.name,
    minDownPaymentPercent: info.minDownPaymentPercent,
  };

  switch (loanType) {
    case 'conventional':
      return {
        ...base,
        frontEndCapPercent: 28,
        backEndCapPercent: 45,
        defaultAnnualMiPercent: 0.55,
        miBasis: 'base-loan',
        miCancelsAtLtv: CONVENTIONAL_MI_CANCEL_LTV,
        requiresResidualIncomeReview: false,
        guidelineNote: 'Classic 28/36 guideline; automated underwriting commonly allows up to 50% total debt with strong credit and reserves.',
      };
    case 'fha':
      return {
        ...base,
        frontEndCapPercent: 31,
        backEndCapPercent: 43,
        defaultAnnualMiPercent: FHA_DEFAULT_ANNUAL_MIP_PERCENT,
        miBasis: 'financed-loan',
        miCancelsAtLtv: null,
        requiresResidualIncomeReview: false,
        guidelineNote:
          'Manual underwriting uses 31/43; an Approve/Eligible finding can stretch well past that. Annual MIP runs 11 years at 90% LTV or below, and for the life of the loan above that.',
      };
    case 'va':
      return {
        ...base,
        frontEndCapPercent: null,
        backEndCapPercent: 41,
        defaultAnnualMiPercent: 0,
        miBasis: 'none',
        miCancelsAtLtv: null,
        requiresResidualIncomeReview: true,
        guidelineNote: 'VA has no housing-payment ratio. The 41% total-debt figure is a guideline, and residual income is the real test.',
      };
    case 'usda':
      return {
        ...base,
        frontEndCapPercent: 29,
        backEndCapPercent: 41,
        defaultAnnualMiPercent: USDA_ANNUAL_FEE_PERCENT,
        miBasis: 'financed-loan',
        miCancelsAtLtv: null,
        requiresResidualIncomeReview: false,
        guidelineNote: 'USDA uses 29/41 and adds household income limits plus property eligibility that this calculator does not check.',
      };
    case 'jumbo':
      return {
        ...base,
        frontEndCapPercent: null,
        backEndCapPercent: 43,
        defaultAnnualMiPercent: 0.55,
        miBasis: 'base-loan',
        miCancelsAtLtv: CONVENTIONAL_MI_CANCEL_LTV,
        requiresResidualIncomeReview: false,
        guidelineNote:
          'Jumbo investors usually cap total debt at 43% and expect significant reserves. Under 20% down, expect mortgage insurance priced above conventional.',
      };
    default: {
      const exhaustive: never = loanType;
      throw new Error(`Unhandled loan type: ${String(exhaustive)}`);
    }
  }
}

function mortgageInsuranceApplies(guidelines: ProgramGuidelines, baseLtv: number): boolean {
  if (guidelines.miBasis === 'none') return false;
  if (guidelines.miCancelsAtLtv === null) return true;
  return baseLtv > guidelines.miCancelsAtLtv;
}

/**
 * Financed-fee rates that could apply, so a self-consistent branch can be found
 * when the fee tier depends on a down payment percent we have not solved yet.
 */
function candidateFeePercents(loanType: LoanType, vaSubsequentUse: boolean): number[] {
  if (loanType !== 'va') return [getFinancedFeePercent(loanType, 0)];
  return getVaFundingFeePercentTiers(vaSubsequentUse);
}

export interface SolveMaxPriceParams {
  monthlyAllowance: number;
  loanType: LoanType;
  vaSubsequentUse?: boolean;
  downPaymentMode: DownPaymentMode;
  downPaymentAmount: number;
  downPaymentPercent: number;
  interestRate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  annualMiRate: number;
}

export interface MaxPriceSolution {
  price: number;
  financedFeePercent: number;
  mortgageInsuranceApplies: boolean;
  /** Purchase price gained per extra dollar of monthly allowance. */
  pricePerMonthlyDollar: number;
  /**
   * True when the price is pinned to the mortgage-insurance cutoff rather than to
   * the monthly allowance: stepping any higher switches insurance on and pushes the
   * payment over, so some of the allowance is left unused.
   */
  limitedByInsuranceCliff: boolean;
}

interface SolvedBranch {
  price: number;
  financedFeePercent: number;
  mortgageInsuranceApplies: boolean;
  pricePerMonthlyDollar: number;
  consistent: boolean;
}

/**
 * Exact maximum purchase price supported by a monthly allowance.
 */
export function solveMaxPriceForPayment(params: SolveMaxPriceParams): MaxPriceSolution {
  const guidelines = getProgramGuidelines(params.loanType);
  const isPercentMode = params.downPaymentMode === 'percent';
  const vaSubsequentUse = params.vaSubsequentUse ?? false;
  const downFraction = Math.min(Math.max(params.downPaymentPercent, 0), 100) / 100;
  const downAmount = Math.max(params.downPaymentAmount, 0);

  const factor = paymentFactor(Math.max(params.interestRate, 0) / 100 / 12, params.termYears * 12);
  const monthlyTaxRate = Math.max(params.propertyTaxRate, 0) / 100 / 12;
  const fixedMonthly = Math.max(params.insuranceMonthly, 0) + Math.max(params.hoaMonthly, 0);
  const netAllowance = params.monthlyAllowance - fixedMonthly;

  const emptySolution: MaxPriceSolution = {
    price: 0,
    financedFeePercent: getFinancedFeePercent(
      params.loanType,
      isPercentMode ? downFraction * 100 : 0,
      vaSubsequentUse
    ),
    mortgageInsuranceApplies: guidelines.miBasis !== 'none',
    pricePerMonthlyDollar: 0,
    limitedByInsuranceCliff: false,
  };

  if (netAllowance <= 0) return emptySolution;

  const solveBranch = (financedFeePercent: number, miApplies: boolean): SolvedBranch | null => {
    const feeMultiplier = 1 + financedFeePercent / 100;
    const monthlyMiRate = miApplies ? Math.max(params.annualMiRate, 0) / 100 / 12 : 0;
    const insuredMultiplier = guidelines.miBasis === 'financed-loan' ? feeMultiplier : 1;
    const loanCoefficient = factor * feeMultiplier + monthlyMiRate * insuredMultiplier;

    const denominator = isPercentMode
      ? loanCoefficient * (1 - downFraction) + monthlyTaxRate
      : loanCoefficient + monthlyTaxRate;
    if (denominator <= 0) return null;

    const rawPrice = isPercentMode
      ? netAllowance / denominator
      : (netAllowance + loanCoefficient * downAmount) / denominator;
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;

    // Paying more down than the home costs is meaningless; treat it as all cash.
    const price = isPercentMode ? rawPrice : Math.max(rawPrice, downAmount);
    const appliedDown = isPercentMode ? price * downFraction : Math.min(downAmount, price);
    const appliedDownPercent = price > 0 ? (appliedDown / price) * 100 : 0;
    const baseLtv = price > 0 ? (price - appliedDown) / price : 0;

    const consistent =
      miApplies === mortgageInsuranceApplies(guidelines, baseLtv) &&
      financedFeePercent ===
        getFinancedFeePercent(params.loanType, appliedDownPercent, vaSubsequentUse);

    return {
      price,
      financedFeePercent,
      mortgageInsuranceApplies: miApplies,
      pricePerMonthlyDollar: 1 / denominator,
      consistent,
    };
  };

  const miStates =
    guidelines.miBasis === 'none'
      ? [false]
      : guidelines.miCancelsAtLtv === null
      ? [true]
      : [false, true];

  const branches: SolvedBranch[] = [];
  for (const feePercent of candidateFeePercents(params.loanType, vaSubsequentUse)) {
    for (const miApplies of miStates) {
      const branch = solveBranch(feePercent, miApplies);
      if (branch) branches.push(branch);
    }
  }

  if (branches.length === 0) return emptySolution;

  const consistentBranches = branches.filter((branch) => branch.consistent);
  if (consistentBranches.length > 0) {
    let best = consistentBranches[0];
    for (const branch of consistentBranches) {
      if (branch.price > best.price) best = branch;
    }
    return {
      price: best.price,
      financedFeePercent: best.financedFeePercent,
      mortgageInsuranceApplies: best.mortgageInsuranceApplies,
      pricePerMonthlyDollar: best.pricePerMonthlyDollar,
      limitedByInsuranceCliff: false,
    };
  }

  // No branch agrees with itself, which means the answer sits exactly on the
  // mortgage-insurance cliff: one more dollar of price switches MI on and pushes
  // the payment above the allowance.
  if (guidelines.miCancelsAtLtv !== null && !isPercentMode && downAmount > 0) {
    const cliffPrice = downAmount / (1 - guidelines.miCancelsAtLtv);
    const withInsurance = branches.find((branch) => branch.mortgageInsuranceApplies);
    return {
      price: cliffPrice,
      financedFeePercent: getFinancedFeePercent(
        params.loanType,
        (downAmount / cliffPrice) * 100,
        vaSubsequentUse
      ),
      mortgageInsuranceApplies: false,
      pricePerMonthlyDollar: withInsurance?.pricePerMonthlyDollar ?? 0,
      limitedByInsuranceCliff: true,
    };
  }

  let fallback = branches[0];
  for (const branch of branches) {
    if (branch.price < fallback.price) fallback = branch;
  }
  return {
    price: fallback.price,
    financedFeePercent: fallback.financedFeePercent,
    mortgageInsuranceApplies: fallback.mortgageInsuranceApplies,
    pricePerMonthlyDollar: fallback.pricePerMonthlyDollar,
    limitedByInsuranceCliff: false,
  };
}

function roundDownToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / step) * step;
}

interface PriceOutcome {
  maxPurchasePrice: number;
  monthlyAllowance: number;
  bindingConstraint: BindingConstraint;
  solution: MaxPriceSolution;
}

function resolveMaxPrice(input: AffordabilityInput): PriceOutcome {
  const guidelines = getProgramGuidelines(input.loanType);
  const income = Math.max(input.grossMonthlyIncome, 0);
  const debts = Math.max(input.monthlyDebts, 0);

  const allowances: { constraint: BindingConstraint; value: number }[] = [];
  if (income > 0 && input.frontEndCapPercent !== null) {
    allowances.push({
      constraint: 'front-end-dti',
      value: (income * Math.max(input.frontEndCapPercent, 0)) / 100,
    });
  }
  if (income > 0) {
    allowances.push({
      constraint: 'back-end-dti',
      value: Math.max((income * Math.max(input.backEndCapPercent, 0)) / 100 - debts, 0),
    });
  }
  if (input.comfortBudget !== null && input.comfortBudget > 0) {
    allowances.push({ constraint: 'comfort-budget', value: input.comfortBudget });
  }

  if (allowances.length === 0) {
    return {
      maxPurchasePrice: 0,
      monthlyAllowance: 0,
      bindingConstraint: 'no-qualifying-income',
      solution: solveMaxPriceForPayment({ ...input, monthlyAllowance: 0 }),
    };
  }

  let monthlyAllowance = allowances[0].value;
  let bindingConstraint = allowances[0].constraint;
  for (const allowance of allowances) {
    if (allowance.value < monthlyAllowance) {
      monthlyAllowance = allowance.value;
      bindingConstraint = allowance.constraint;
    }
  }

  const solution = solveMaxPriceForPayment({ ...input, monthlyAllowance });
  let maxPurchasePrice = solution.price;

  // A ratio cap with room left under it is not the real limit when the price is pinned
  // to the point where mortgage insurance would start, so name the cliff instead. A
  // comfort budget still wins, since that number is the buyer's own choice.
  if (solution.limitedByInsuranceCliff && bindingConstraint !== 'comfort-budget') {
    bindingConstraint = 'mortgage-insurance-cliff';
  }

  const isPercentMode = input.downPaymentMode === 'percent';
  const downFraction = Math.min(Math.max(input.downPaymentPercent, 0), 100) / 100;
  const downAmount = Math.max(input.downPaymentAmount, 0);
  const closingCostFraction = Math.max(input.closingCostPercent, 0) / 100;

  const priceCaps: { constraint: BindingConstraint; value: number }[] = [];

  if (!isPercentMode && guidelines.minDownPaymentPercent > 0) {
    priceCaps.push({
      constraint: 'minimum-down',
      value: downAmount / (guidelines.minDownPaymentPercent / 100),
    });
  }

  if (input.cashOnHand !== null) {
    const cash = Math.max(input.cashOnHand, 0);
    if (isPercentMode) {
      const denominator = downFraction + closingCostFraction;
      if (denominator > 0) {
        priceCaps.push({ constraint: 'cash-to-close', value: cash / denominator });
      }
    } else if (closingCostFraction > 0) {
      priceCaps.push({
        constraint: 'cash-to-close',
        value: Math.max(cash - downAmount, 0) / closingCostFraction,
      });
    } else if (cash < downAmount) {
      priceCaps.push({ constraint: 'cash-to-close', value: 0 });
    }
  }

  for (const cap of priceCaps) {
    if (cap.value < maxPurchasePrice) {
      maxPurchasePrice = cap.value;
      bindingConstraint = cap.constraint;
    }
  }

  return {
    maxPurchasePrice: roundDownToStep(Math.max(maxPurchasePrice, 0), PRICE_ROUNDING_STEP),
    monthlyAllowance,
    bindingConstraint,
    solution,
  };
}

function buildWarnings(
  input: AffordabilityInput,
  guidelines: ProgramGuidelines,
  result: {
    maxPurchasePrice: number;
    downPaymentAmount: number;
    downPaymentPercent: number;
    totalLoanAmount: number;
    mortgageInsuranceMonthly: number;
    totalMonthlyPayment: number;
    monthlyAllowance: number;
    bindingConstraint: BindingConstraint;
  }
): AffordabilityWarning[] {
  const warnings: AffordabilityWarning[] = [];

  if (result.bindingConstraint === 'no-qualifying-income') {
    warnings.push({
      id: 'no-income',
      severity: 'warning',
      message: 'Enter gross income, or set a target monthly payment, to get a maximum price.',
    });
    return warnings;
  }

  if (result.maxPurchasePrice <= 0) {
    warnings.push({
      id: 'nothing-affordable',
      severity: 'warning',
      message:
        'The monthly amount available does not cover taxes, insurance, and HOA yet, so there is nothing left for a loan payment.',
    });
  }

  if (
    result.maxPurchasePrice > 0 &&
    result.downPaymentPercent + 0.001 < guidelines.minDownPaymentPercent
  ) {
    warnings.push({
      id: 'below-min-down',
      severity: 'warning',
      message: `${guidelines.name} requires at least ${guidelines.minDownPaymentPercent}% down. This scenario is at ${result.downPaymentPercent.toFixed(1)}%.`,
    });
  }

  // Only conventional loans are held to the conforming limit. FHA has its own
  // county limits, and VA and USDA have no loan limit at all.
  if (
    input.loanType === 'conventional' &&
    input.conformingLoanLimit > 0 &&
    result.totalLoanAmount > input.conformingLoanLimit
  ) {
    warnings.push({
      id: 'over-conforming',
      severity: 'info',
      message: `The loan is above the ${Math.round(input.conformingLoanLimit).toLocaleString('en-US')} conforming limit entered, so jumbo pricing and guidelines would apply instead.`,
    });
  }

  if (input.loanType === 'fha') {
    warnings.push({
      id: 'fha-county-limit',
      severity: 'info',
      message:
        'FHA sets its own maximum loan amount county by county, which this calculator does not check. Confirm the local limit before quoting this price.',
    });
  }

  if (result.bindingConstraint === 'mortgage-insurance-cliff') {
    const unusedRoom = result.monthlyAllowance - result.totalMonthlyPayment;
    warnings.push({
      id: 'mi-cliff-limited',
      severity: 'info',
      message: `This price lands exactly at 20% down. Going higher drops them under 20%, which adds mortgage insurance and pushes the payment past what they can carry, so about ${Math.round(Math.max(unusedRoom, 0)).toLocaleString('en-US')} per month of room goes unused. More cash for the down payment is what raises this price.`,
    });
  }

  if (guidelines.miCancelsAtLtv !== null && result.mortgageInsuranceMonthly > 0) {
    const downNeededForNoMi = result.maxPurchasePrice * (1 - guidelines.miCancelsAtLtv);
    const additionalCash = downNeededForNoMi - result.downPaymentAmount;
    if (additionalCash > 0) {
      warnings.push({
        id: 'mi-cliff',
        severity: 'info',
        message: `Another ${Math.round(additionalCash).toLocaleString('en-US')} down at this price reaches 20% and removes ${Math.round(result.mortgageInsuranceMonthly).toLocaleString('en-US')} per month of mortgage insurance.`,
      });
    }
  }

  if (input.backEndCapPercent > guidelines.backEndCapPercent) {
    warnings.push({
      id: 'aggressive-dti',
      severity: 'warning',
      message: `Total debt is set to ${input.backEndCapPercent}%, above the ${guidelines.backEndCapPercent}% guideline for ${guidelines.name}. Treat this as a stretch that needs an underwriting approval to confirm.`,
    });
  }

  if (guidelines.requiresResidualIncomeReview) {
    warnings.push({
      id: 'va-residual',
      severity: 'info',
      message: 'VA also requires a residual income test by family size and region, which this calculator does not model.',
    });
  }

  return warnings;
}

function buildLevers(input: AffordabilityInput, outcome: PriceOutcome): BuyingPowerLevers {
  const basePrice = outcome.maxPurchasePrice;
  const priceFor = (patch: Partial<AffordabilityInput>): number =>
    resolveMaxPrice({ ...input, ...patch }).maxPurchasePrice;

  const toLever = (id: string, label: string, price: number): BuyingPowerLever => ({
    id,
    label,
    maxPurchasePrice: price,
    priceDelta: price - basePrice,
  });

  const debts = Math.max(input.monthlyDebts, 0);
  const paydownAmounts = [100, 250, 500].filter((amount) => amount < debts);
  if (debts > 0) paydownAmounts.push(debts);

  const debtPaydown = paydownAmounts.map((amount) =>
    toLever(
      `debt-${amount}`,
      amount === debts && debts > 0
        ? 'Pay off every monthly debt'
        : `Eliminate ${amount.toLocaleString('en-US')} per month of debt`,
      priceFor({ monthlyDebts: debts - amount })
    )
  );

  const rateShifts = [-1, -0.5, 0.5, 1]
    .filter((shift) => input.interestRate + shift > 0)
    .map((shift) =>
      toLever(
        `rate-${shift}`,
        `Rate ${shift > 0 ? 'up' : 'down'} ${Math.abs(shift).toFixed(2)} points (${(input.interestRate + shift).toFixed(3)}%)`,
        priceFor({ interestRate: input.interestRate + shift })
      )
    );

  const extraDownPayment =
    input.downPaymentMode === 'percent'
      ? [5, 10]
          .filter((step) => input.downPaymentPercent + step <= 100)
          .map((step) =>
            toLever(
              `down-percent-${step}`,
              `Put ${input.downPaymentPercent + step}% down instead`,
              priceFor({ downPaymentPercent: input.downPaymentPercent + step })
            )
          )
      : [10_000, 25_000].map((step) =>
          toLever(
            `down-amount-${step}`,
            `Add ${step.toLocaleString('en-US')} to the down payment`,
            priceFor({
              downPaymentAmount: input.downPaymentAmount + step,
              cashOnHand: input.cashOnHand === null ? null : input.cashOnHand + step,
            })
          )
        );

  const incomeIncrease = [500, 1_000].map((step) =>
    toLever(
      `income-${step}`,
      `Add ${step.toLocaleString('en-US')} per month of documented income`,
      priceFor({ grossMonthlyIncome: input.grossMonthlyIncome + step })
    )
  );

  return {
    pricePerHundredMonthly: outcome.solution.pricePerMonthlyDollar * 100,
    debtPaydown,
    rateShifts,
    extraDownPayment,
    incomeIncrease,
  };
}

/**
 * Maximum purchase price and the full scenario behind it.
 */
export function calculateAffordability(input: AffordabilityInput): AffordabilityResult {
  const guidelines = getProgramGuidelines(input.loanType);
  const outcome = resolveMaxPrice(input);
  const price = outcome.maxPurchasePrice;

  const downPaymentAmount =
    input.downPaymentMode === 'percent'
      ? price * (Math.min(Math.max(input.downPaymentPercent, 0), 100) / 100)
      : Math.min(Math.max(input.downPaymentAmount, 0), price);
  const downPaymentPercent = price > 0 ? (downPaymentAmount / price) * 100 : 0;

  // Reuse the payment engine the Calculator tab uses so the two always agree.
  const mortgage = calculateMortgage({
    purchasePrice: price,
    downPaymentPercent,
    interestRate: input.interestRate,
    termYears: input.termYears,
    propertyTaxRate: input.propertyTaxRate,
    insuranceMonthly: input.insuranceMonthly,
    hoaMonthly: input.hoaMonthly,
    pmiRate: input.annualMiRate,
    extraPrincipal: 0,
    loanType: input.loanType,
    vaSubsequentUse: input.vaSubsequentUse,
  });

  const income = Math.max(input.grossMonthlyIncome, 0);
  const debts = Math.max(input.monthlyDebts, 0);
  const closingCosts = price * (Math.max(input.closingCostPercent, 0) / 100);

  const frontEndRatio = income > 0 ? mortgage.totalMonthly / income : null;
  const backEndRatio = income > 0 ? (mortgage.totalMonthly + debts) / income : null;
  const frontEndHeadroom =
    income > 0 && input.frontEndCapPercent !== null
      ? (income * input.frontEndCapPercent) / 100 - mortgage.totalMonthly
      : null;
  const backEndHeadroom =
    income > 0 ? (income * input.backEndCapPercent) / 100 - debts - mortgage.totalMonthly : null;

  const warnings = buildWarnings(input, guidelines, {
    maxPurchasePrice: price,
    downPaymentAmount,
    downPaymentPercent,
    totalLoanAmount: mortgage.loanAmount,
    mortgageInsuranceMonthly: mortgage.pmiMonthly,
    totalMonthlyPayment: mortgage.totalMonthly,
    monthlyAllowance: outcome.monthlyAllowance,
    bindingConstraint: outcome.bindingConstraint,
  });

  return {
    maxPurchasePrice: price,
    monthlyAllowance: outcome.monthlyAllowance,
    bindingConstraint: outcome.bindingConstraint,
    downPaymentAmount,
    downPaymentPercent,
    baseLoanAmount: mortgage.baseLoanAmount,
    financedFeeAmount: mortgage.financedFeeAmount,
    totalLoanAmount: mortgage.loanAmount,
    baseLtv: mortgage.baseLtv,
    principalAndInterest: mortgage.principalAndInterest,
    propertyTaxes: mortgage.propertyTaxes,
    insuranceMonthly: Math.max(input.insuranceMonthly, 0),
    hoaMonthly: Math.max(input.hoaMonthly, 0),
    mortgageInsuranceMonthly: mortgage.pmiMonthly,
    mortgageInsuranceMonths: mortgage.mortgageInsuranceMonths,
    totalMonthlyPayment: mortgage.totalMonthly,
    closingCosts,
    cashToClose: downPaymentAmount + closingCosts,
    frontEndRatio,
    backEndRatio,
    frontEndHeadroom,
    backEndHeadroom,
    guidelines,
    warnings,
    levers: buildLevers(input, outcome),
  };
}

/**
 * What this program calls its monthly mortgage insurance.
 */
export function getMortgageInsuranceLabel(loanType: LoanType): string {
  switch (loanType) {
    case 'fha':
      return 'Mortgage insurance (MIP)';
    case 'usda':
      return 'USDA annual fee';
    case 'conventional':
    case 'jumbo':
      return 'Mortgage insurance (PMI)';
    case 'va':
      return 'Mortgage insurance';
    default: {
      const exhaustive: never = loanType;
      throw new Error(`Unhandled loan type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Plain-language note about how long mortgage insurance sticks around, or
 * `undefined` when none is charged and there is nothing to say.
 */
export function describeMortgageInsuranceDuration(months: number | null): string | undefined {
  if (months === null) return 'Stays for the life of the loan';
  if (months <= 0) return undefined;
  if (months <= 12) return 'Drops off within the first year';

  const years = Math.round(months / 12);
  return `Drops off after about ${years} ${years === 1 ? 'year' : 'years'}`;
}

/**
 * What this program calls the upfront fee rolled into the loan.
 */
export function getFinancedFeeLabel(loanType: LoanType): string {
  switch (loanType) {
    case 'fha':
      return 'Upfront MIP added to loan';
    case 'va':
      return 'VA funding fee added to loan';
    case 'usda':
      return 'USDA guarantee fee added to loan';
    case 'conventional':
    case 'jumbo':
      return 'Financed upfront fee';
    default: {
      const exhaustive: never = loanType;
      throw new Error(`Unhandled loan type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Plain-language label for whatever is holding the maximum price down.
 */
export function describeBindingConstraint(
  constraint: BindingConstraint,
  input: Pick<AffordabilityInput, 'frontEndCapPercent' | 'backEndCapPercent' | 'loanType'>
): string {
  switch (constraint) {
    case 'front-end-dti':
      return `Limited by the housing payment cap of ${input.frontEndCapPercent ?? 0}% of income`;
    case 'back-end-dti':
      return `Limited by the total debt cap of ${input.backEndCapPercent}% of income`;
    case 'comfort-budget':
      return 'Limited by the target monthly payment, not by what they qualify for';
    case 'cash-to-close':
      return 'Limited by cash available for down payment and closing costs';
    case 'minimum-down':
      return `Limited by the ${getProgramGuidelines(input.loanType).minDownPaymentPercent}% minimum down payment for this program`;
    case 'mortgage-insurance-cliff':
      return 'Limited by the 20% down mark, where mortgage insurance would start';
    case 'no-qualifying-income':
      return 'Waiting on income or a target monthly payment';
    default: {
      const exhaustive: never = constraint;
      throw new Error(`Unhandled constraint: ${String(exhaustive)}`);
    }
  }
}
