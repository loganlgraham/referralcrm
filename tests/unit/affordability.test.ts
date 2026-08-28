import {
  AffordabilityInput,
  DEFAULT_CONFORMING_LOAN_LIMIT,
  calculateAffordability,
  getProgramGuidelines,
  paymentFactor,
  solveMaxPriceForPayment,
} from '@/utils/affordability';
import { calculateMortgage } from '@/utils/mortgage-calculations';

const baseInput: AffordabilityInput = {
  loanType: 'conventional',
  grossMonthlyIncome: 8_000,
  monthlyDebts: 500,
  downPaymentMode: 'amount',
  downPaymentAmount: 50_000,
  downPaymentPercent: 5,
  cashOnHand: null,
  closingCostPercent: 3,
  comfortBudget: null,
  interestRate: 6.75,
  termYears: 30,
  propertyTaxRate: 1.1,
  insuranceMonthly: 150,
  hoaMonthly: 100,
  annualMiRate: 0.55,
  frontEndCapPercent: 28,
  backEndCapPercent: 45,
  conformingLoanLimit: DEFAULT_CONFORMING_LOAN_LIMIT,
};

function input(overrides: Partial<AffordabilityInput> = {}): AffordabilityInput {
  return { ...baseInput, ...overrides };
}

describe('paymentFactor', () => {
  it('matches the standard amortization factor', () => {
    // 6% annual on a 30-year loan is a payment factor of about 0.005996.
    expect(paymentFactor(0.06 / 12, 360)).toBeCloseTo(0.0059955, 6);
  });

  it('falls back to straight-line repayment at a zero rate', () => {
    expect(paymentFactor(0, 360)).toBeCloseTo(1 / 360, 10);
  });
});

describe('calculateAffordability payment consistency', () => {
  it('produces a payment that the mortgage engine reproduces exactly', () => {
    const result = calculateAffordability(input());

    const mortgage = calculateMortgage({
      purchasePrice: result.maxPurchasePrice,
      downPaymentPercent: result.downPaymentPercent,
      interestRate: baseInput.interestRate,
      termYears: baseInput.termYears,
      propertyTaxRate: baseInput.propertyTaxRate,
      insuranceMonthly: baseInput.insuranceMonthly,
      hoaMonthly: baseInput.hoaMonthly,
      pmiRate: baseInput.annualMiRate,
      extraPrincipal: 0,
      loanType: 'conventional',
    });

    expect(mortgage.totalMonthly).toBeCloseTo(result.totalMonthlyPayment, 6);
  });

  it('stays inside the monthly allowance after rounding the price down', () => {
    const result = calculateAffordability(input());

    expect(result.maxPurchasePrice % 1_000).toBe(0);
    expect(result.totalMonthlyPayment).toBeLessThanOrEqual(result.monthlyAllowance);
    // Rounding should cost less than a grand of price, so the payment stays close.
    expect(result.monthlyAllowance - result.totalMonthlyPayment).toBeLessThan(10);
  });

  it('solves the unrounded price so the payment lands on the allowance', () => {
    const allowance = 2_600;
    const solution = solveMaxPriceForPayment({
      monthlyAllowance: allowance,
      loanType: 'conventional',
      downPaymentMode: 'amount',
      downPaymentAmount: 50_000,
      downPaymentPercent: 0,
      interestRate: 6.75,
      termYears: 30,
      propertyTaxRate: 1.1,
      insuranceMonthly: 150,
      hoaMonthly: 100,
      annualMiRate: 0.55,
    });

    const mortgage = calculateMortgage({
      purchasePrice: solution.price,
      downPaymentPercent: (50_000 / solution.price) * 100,
      interestRate: 6.75,
      termYears: 30,
      propertyTaxRate: 1.1,
      insuranceMonthly: 150,
      hoaMonthly: 100,
      pmiRate: 0.55,
      extraPrincipal: 0,
      loanType: 'conventional',
    });

    expect(mortgage.totalMonthly).toBeCloseTo(allowance, 6);
  });
});

describe('mortgage insurance cliff', () => {
  it('lands exactly at the 20% down price when neither branch is self-consistent', () => {
    // This down payment against this allowance puts the answer right on the
    // boundary: the no-PMI solve lands above 20% down and the with-PMI solve lands
    // below it, so the true maximum is the price where PMI switches off.
    const downPaymentAmount = 70_000;
    const solution = solveMaxPriceForPayment({
      monthlyAllowance: 2_600,
      loanType: 'conventional',
      downPaymentMode: 'amount',
      downPaymentAmount,
      downPaymentPercent: 0,
      interestRate: 6.75,
      termYears: 30,
      propertyTaxRate: 1.1,
      insuranceMonthly: 150,
      hoaMonthly: 100,
      annualMiRate: 1.2,
    });

    expect(solution.price).toBeCloseTo(downPaymentAmount / 0.2, 6);
    expect(solution.mortgageInsuranceApplies).toBe(false);
  });

  it('never reports a price whose PMI assumption contradicts its own LTV', () => {
    for (let downPaymentAmount = 20_000; downPaymentAmount <= 200_000; downPaymentAmount += 2_500) {
      const solution = solveMaxPriceForPayment({
        monthlyAllowance: 2_600,
        loanType: 'conventional',
        downPaymentMode: 'amount',
        downPaymentAmount,
        downPaymentPercent: 0,
        interestRate: 6.75,
        termYears: 30,
        propertyTaxRate: 1.1,
        insuranceMonthly: 150,
        hoaMonthly: 100,
        annualMiRate: 1.2,
      });

      const baseLtv = (solution.price - downPaymentAmount) / solution.price;
      const insuranceExpected = baseLtv > 0.8 + 1e-9;
      expect(solution.mortgageInsuranceApplies).toBe(insuranceExpected);
    }
  });

  it('drops mortgage insurance in percent mode once 20% down is entered', () => {
    const withInsurance = calculateAffordability(
      input({ downPaymentMode: 'percent', downPaymentPercent: 10 })
    );
    const withoutInsurance = calculateAffordability(
      input({ downPaymentMode: 'percent', downPaymentPercent: 20 })
    );

    expect(withInsurance.mortgageInsuranceMonthly).toBeGreaterThan(0);
    expect(withoutInsurance.mortgageInsuranceMonthly).toBe(0);
  });
});

describe('loan programs', () => {
  it('lowers FHA buying power because upfront MIP is financed into the loan', () => {
    const shared = { downPaymentMode: 'percent' as const, downPaymentPercent: 5 };
    const conventional = calculateAffordability(input({ ...shared, loanType: 'conventional' }));
    const fha = calculateAffordability(
      input({ ...shared, loanType: 'fha', frontEndCapPercent: 28, backEndCapPercent: 45 })
    );

    expect(fha.financedFeeAmount).toBeGreaterThan(0);
    expect(conventional.financedFeeAmount).toBe(0);
    expect(fha.maxPurchasePrice).toBeLessThan(conventional.maxPurchasePrice);
    // The FHA loan is the base loan plus 1.75% upfront MIP.
    expect(fha.totalLoanAmount).toBeCloseTo(fha.baseLoanAmount * 1.0175, 6);
  });

  it('charges no monthly mortgage insurance on VA but still finances the funding fee', () => {
    const result = calculateAffordability(
      input({ loanType: 'va', downPaymentMode: 'percent', downPaymentPercent: 0 })
    );

    expect(result.mortgageInsuranceMonthly).toBe(0);
    expect(result.financedFeeAmount).toBeCloseTo(result.baseLoanAmount * 0.0215, 6);
  });

  it('picks the self-consistent VA funding fee tier in dollar mode', () => {
    const result = calculateAffordability(input({ loanType: 'va', downPaymentAmount: 50_000 }));
    const expectedFeePercent =
      result.downPaymentPercent >= 10 ? 0.0125 : result.downPaymentPercent >= 5 ? 0.015 : 0.0215;

    expect(result.financedFeeAmount).toBeCloseTo(result.baseLoanAmount * expectedFeePercent, 6);
  });

  it('charges a repeat VA buyer the higher funding fee below 5% down', () => {
    const shared = { loanType: 'va' as const, downPaymentMode: 'percent' as const, downPaymentPercent: 0 };
    const firstUse = calculateAffordability(input(shared));
    const repeatUse = calculateAffordability(input({ ...shared, vaSubsequentUse: true }));

    expect(firstUse.financedFeeAmount).toBeCloseTo(firstUse.baseLoanAmount * 0.0215, 6);
    expect(repeatUse.financedFeeAmount).toBeCloseTo(repeatUse.baseLoanAmount * 0.033, 6);
    // The bigger financed fee eats into the payment, so it buys less house.
    expect(repeatUse.maxPurchasePrice).toBeLessThan(firstUse.maxPurchasePrice);
  });

  it('leaves the repeat-use fee behind once the buyer puts 5% down', () => {
    const shared = { loanType: 'va' as const, downPaymentMode: 'percent' as const, downPaymentPercent: 5 };
    const firstUse = calculateAffordability(input(shared));
    const repeatUse = calculateAffordability(input({ ...shared, vaSubsequentUse: true }));

    expect(repeatUse.financedFeeAmount).toBeCloseTo(repeatUse.baseLoanAmount * 0.015, 6);
    expect(repeatUse.maxPurchasePrice).toBe(firstUse.maxPurchasePrice);
  });

  it('charges jumbo mortgage insurance below 20% down', () => {
    const result = calculateAffordability(
      input({ loanType: 'jumbo', downPaymentMode: 'percent', downPaymentPercent: 10 })
    );

    expect(result.mortgageInsuranceMonthly).toBeGreaterThan(0);
    expect(result.warnings.map((warning) => warning.id)).toContain('mi-cliff');
  });

  it('ignores the front-end ratio for programs that do not use one', () => {
    expect(getProgramGuidelines('va').frontEndCapPercent).toBeNull();
    expect(getProgramGuidelines('jumbo').frontEndCapPercent).toBeNull();

    const result = calculateAffordability(input({ loanType: 'va', frontEndCapPercent: null }));
    expect(result.bindingConstraint).toBe('back-end-dti');
    expect(result.frontEndHeadroom).toBeNull();
  });
});

describe('binding constraints', () => {
  it('reports the front-end ratio when housing payment is the tighter limit', () => {
    const result = calculateAffordability(input({ monthlyDebts: 0 }));

    expect(result.bindingConstraint).toBe('front-end-dti');
    expect(result.monthlyAllowance).toBeCloseTo(8_000 * 0.28, 6);
  });

  it('reports the back-end ratio when existing debt is the tighter limit', () => {
    const result = calculateAffordability(input({ monthlyDebts: 1_400 }));

    expect(result.bindingConstraint).toBe('back-end-dti');
    expect(result.monthlyAllowance).toBeCloseTo(8_000 * 0.45 - 1_400, 6);
  });

  it('reports the comfort budget when the buyer wants to spend less than they qualify for', () => {
    const result = calculateAffordability(input({ comfortBudget: 1_800 }));

    expect(result.bindingConstraint).toBe('comfort-budget');
    expect(result.monthlyAllowance).toBe(1_800);
  });

  it('reports cash to close and keeps the price inside the cash available', () => {
    const result = calculateAffordability(
      input({ downPaymentMode: 'percent', downPaymentPercent: 10, cashOnHand: 30_000 })
    );

    expect(result.bindingConstraint).toBe('cash-to-close');
    expect(result.cashToClose).toBeLessThanOrEqual(30_000);
  });

  it('names the mortgage insurance cliff instead of the ratio that has room left', () => {
    // A 3% tax rate pulls the price down to exactly 20% down, where the answer is
    // pinned by the insurance cutoff rather than by the housing payment cap.
    const result = calculateAffordability(input({ propertyTaxRate: 3 }));

    expect(result.downPaymentPercent).toBeCloseTo(20, 6);
    expect(result.mortgageInsuranceMonthly).toBe(0);
    expect(result.bindingConstraint).toBe('mortgage-insurance-cliff');
    // The housing payment cap still has room, which is why it must not be blamed.
    expect(result.frontEndHeadroom ?? 0).toBeGreaterThan(10);
    expect(result.warnings.map((warning) => warning.id)).toContain('mi-cliff-limited');
  });

  it('reports the program minimum down payment when the down payment is too small', () => {
    const result = calculateAffordability(input({ loanType: 'fha', downPaymentAmount: 8_000 }));

    expect(result.bindingConstraint).toBe('minimum-down');
    expect(result.downPaymentPercent).toBeGreaterThanOrEqual(3.5);
  });

  it('waits for income or a target payment before quoting a price', () => {
    const result = calculateAffordability(input({ grossMonthlyIncome: 0 }));

    expect(result.bindingConstraint).toBe('no-qualifying-income');
    expect(result.maxPurchasePrice).toBe(0);
    expect(result.warnings.map((warning) => warning.id)).toContain('no-income');
  });
});

describe('edge cases', () => {
  it('handles a zero interest rate', () => {
    const result = calculateAffordability(input({ interestRate: 0 }));

    expect(result.maxPurchasePrice).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalMonthlyPayment)).toBe(true);
  });

  it('returns nothing affordable when fixed costs eat the whole allowance', () => {
    const result = calculateAffordability(
      input({ comfortBudget: 200, insuranceMonthly: 150, hoaMonthly: 100 })
    );

    expect(result.maxPurchasePrice).toBe(0);
    expect(result.warnings.map((warning) => warning.id)).toContain('nothing-affordable');
  });

  it('treats a down payment larger than the affordable price as an all-cash purchase', () => {
    const result = calculateAffordability(
      input({ comfortBudget: 400, downPaymentAmount: 400_000, closingCostPercent: 0 })
    );

    expect(result.downPaymentAmount).toBeLessThanOrEqual(result.maxPurchasePrice);
    expect(result.baseLoanAmount).toBeGreaterThanOrEqual(0);
  });
});

describe('warnings', () => {
  it('flags a conventional loan above the conforming limit', () => {
    const result = calculateAffordability(
      input({ grossMonthlyIncome: 30_000, monthlyDebts: 0, downPaymentAmount: 200_000 })
    );

    expect(result.totalLoanAmount).toBeGreaterThan(DEFAULT_CONFORMING_LOAN_LIMIT);
    expect(result.warnings.map((warning) => warning.id)).toContain('over-conforming');
  });

  it('does not hold VA or USDA to a conforming limit they do not have', () => {
    const big = { grossMonthlyIncome: 30_000, monthlyDebts: 0, downPaymentAmount: 200_000 };

    for (const loanType of ['va', 'usda'] as const) {
      const result = calculateAffordability(input({ ...big, loanType, frontEndCapPercent: null }));

      expect(result.totalLoanAmount).toBeGreaterThan(DEFAULT_CONFORMING_LOAN_LIMIT);
      expect(result.warnings.map((warning) => warning.id)).not.toContain('over-conforming');
    }
  });

  it('points out that FHA county limits are not checked', () => {
    const result = calculateAffordability(input({ loanType: 'fha' }));

    expect(result.warnings.map((warning) => warning.id)).toContain('fha-county-limit');
  });

  it('flags how much more cash removes conventional mortgage insurance', () => {
    const result = calculateAffordability(input({ downPaymentMode: 'percent', downPaymentPercent: 5 }));

    expect(result.mortgageInsuranceMonthly).toBeGreaterThan(0);
    expect(result.warnings.map((warning) => warning.id)).toContain('mi-cliff');
  });

  it('flags a total debt cap set above the program guideline', () => {
    const result = calculateAffordability(input({ backEndCapPercent: 50 }));

    expect(result.warnings.map((warning) => warning.id)).toContain('aggressive-dti');
  });

  it('notes that VA residual income is not modeled', () => {
    const result = calculateAffordability(input({ loanType: 'va', frontEndCapPercent: null }));

    expect(result.warnings.map((warning) => warning.id)).toContain('va-residual');
  });
});

describe('buying power levers', () => {
  it('values freed-up monthly payment at the marginal rate implied by the loan terms', () => {
    // No housing payment cap, so the total debt limit stays binding either side of
    // the paydown and the full $250 flows through to buying power.
    const result = calculateAffordability(input({ monthlyDebts: 1_400, frontEndCapPercent: null }));

    const paydown = result.levers.debtPaydown.find((lever) => lever.id === 'debt-250');
    expect(paydown).toBeDefined();
    expect(paydown?.priceDelta ?? 0).toBeGreaterThan(0);
    // Within the $1,000 rounding applied at each end.
    const expected = result.levers.pricePerHundredMonthly * 2.5;
    expect(Math.abs((paydown?.priceDelta ?? 0) - expected)).toBeLessThan(2_000);
  });

  it('shows no gain from paying off debt when the housing payment cap is already binding', () => {
    const result = calculateAffordability(input({ monthlyDebts: 900 }));

    expect(result.bindingConstraint).toBe('front-end-dti');
    expect(result.levers.debtPaydown.at(-1)?.priceDelta).toBe(0);
  });

  it('shows a lower price when the rate rises and a higher price when it falls', () => {
    const result = calculateAffordability(input());
    const rateUp = result.levers.rateShifts.find((lever) => lever.id === 'rate-1');
    const rateDown = result.levers.rateShifts.find((lever) => lever.id === 'rate--1');

    expect(rateUp?.priceDelta ?? 0).toBeLessThan(0);
    expect(rateDown?.priceDelta ?? 0).toBeGreaterThan(0);
  });

  it('offers dollar down payment steps in dollar mode and percentage steps in percent mode', () => {
    const dollarMode = calculateAffordability(input());
    const percentMode = calculateAffordability(
      input({ downPaymentMode: 'percent', downPaymentPercent: 5 })
    );

    expect(dollarMode.levers.extraDownPayment.map((lever) => lever.id)).toEqual([
      'down-amount-10000',
      'down-amount-25000',
    ]);
    expect(percentMode.levers.extraDownPayment.map((lever) => lever.id)).toEqual([
      'down-percent-5',
      'down-percent-10',
    ]);
  });

  it('includes a pay-off-everything option when debts exist', () => {
    const result = calculateAffordability(input({ monthlyDebts: 900, frontEndCapPercent: null }));
    const payAll = result.levers.debtPaydown.at(-1);

    expect(payAll?.label).toBe('Pay off every monthly debt');
    expect(payAll?.priceDelta ?? 0).toBeGreaterThan(0);
  });

  it('offers no debt paydown options when there is no debt', () => {
    const result = calculateAffordability(input({ monthlyDebts: 0 }));

    expect(result.levers.debtPaydown).toEqual([]);
  });
});
