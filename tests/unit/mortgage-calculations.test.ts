import {
  FHA_MIP_TERM_MONTHS,
  type LoanType,
  type MortgageInputs,
  calculateExtraPrincipalImpact,
  calculateMortgage,
  generateAmortizationSchedule,
  getFinancedFeePercent,
  getLoanTypeInfo,
  getVaFundingFeePercent,
  getVaFundingFeePercentTiers,
  isLoanType,
} from '@/utils/mortgage-calculations';

const baseInputs: MortgageInputs = {
  purchasePrice: 500_000,
  downPaymentPercent: 15,
  interestRate: 6.75,
  termYears: 30,
  propertyTaxRate: 1.1,
  insuranceMonthly: 150,
  hoaMonthly: 100,
  pmiRate: 0.55,
  extraPrincipal: 0,
  loanType: 'conventional',
};

function inputs(overrides: Partial<MortgageInputs> = {}): MortgageInputs {
  return { ...baseInputs, ...overrides };
}

describe('VA funding fee', () => {
  it('uses the published first-use tiers', () => {
    expect(getVaFundingFeePercent(0)).toBe(2.15);
    expect(getVaFundingFeePercent(4.99)).toBe(2.15);
    expect(getVaFundingFeePercent(5)).toBe(1.5);
    expect(getVaFundingFeePercent(9.99)).toBe(1.5);
    expect(getVaFundingFeePercent(10)).toBe(1.25);
  });

  it('charges a repeat borrower more only below 5% down', () => {
    expect(getVaFundingFeePercent(0, true)).toBe(3.3);
    expect(getVaFundingFeePercent(5, true)).toBe(1.5);
    expect(getVaFundingFeePercent(10, true)).toBe(1.25);
  });

  it('reports every tier a solver may need to try', () => {
    expect(getVaFundingFeePercentTiers()).toEqual([2.15, 1.5, 1.25]);
    expect(getVaFundingFeePercentTiers(true)).toEqual([3.3, 1.5, 1.25]);
  });

  it('finances the fee that matches the borrower and the down payment', () => {
    const firstUse = calculateMortgage(inputs({ loanType: 'va', downPaymentPercent: 0 }));
    const repeatUse = calculateMortgage(
      inputs({ loanType: 'va', downPaymentPercent: 0, vaSubsequentUse: true })
    );

    expect(firstUse.financedFeeAmount).toBeCloseTo(500_000 * 0.0215, 6);
    expect(repeatUse.financedFeeAmount).toBeCloseTo(500_000 * 0.033, 6);
    expect(repeatUse.principalAndInterest).toBeGreaterThan(firstUse.principalAndInterest);
  });
});

describe('financed upfront fees', () => {
  it('charges each program its own upfront fee', () => {
    expect(getFinancedFeePercent('conventional', 5)).toBe(0);
    expect(getFinancedFeePercent('jumbo', 5)).toBe(0);
    expect(getFinancedFeePercent('fha', 3.5)).toBe(1.75);
    expect(getFinancedFeePercent('usda', 0)).toBe(1);
  });

  it('exposes the fee under the name the program uses', () => {
    expect(calculateMortgage(inputs({ loanType: 'fha' })).upfrontMIP).toBeGreaterThan(0);
    expect(calculateMortgage(inputs({ loanType: 'va' })).fundingFee).toBeGreaterThan(0);
    expect(calculateMortgage(inputs({ loanType: 'usda' })).usdaGuaranteeFee).toBeGreaterThan(0);
    expect(calculateMortgage(inputs()).upfrontMIP).toBeUndefined();
  });
});

describe('monthly mortgage insurance', () => {
  it('charges conventional PMI only above 80% LTV', () => {
    expect(calculateMortgage(inputs({ downPaymentPercent: 15 })).pmiMonthly).toBeGreaterThan(0);
    expect(calculateMortgage(inputs({ downPaymentPercent: 20 })).pmiMonthly).toBe(0);
  });

  it('charges jumbo PMI on the same terms as conventional', () => {
    const jumbo = calculateMortgage(inputs({ loanType: 'jumbo', downPaymentPercent: 10 }));
    const conventional = calculateMortgage(inputs({ downPaymentPercent: 10 }));

    expect(jumbo.pmiMonthly).toBeCloseTo(conventional.pmiMonthly, 6);
    expect(calculateMortgage(inputs({ loanType: 'jumbo', downPaymentPercent: 25 })).pmiMonthly).toBe(
      0
    );
  });

  it('never charges VA mortgage insurance', () => {
    expect(calculateMortgage(inputs({ loanType: 'va', downPaymentPercent: 0 })).pmiMonthly).toBe(0);
  });
});

describe('how long mortgage insurance lasts', () => {
  it('reports no months when none is charged', () => {
    expect(calculateMortgage(inputs({ downPaymentPercent: 20 })).mortgageInsuranceMonths).toBe(0);
    expect(
      calculateMortgage(inputs({ loanType: 'va', downPaymentPercent: 0 })).mortgageInsuranceMonths
    ).toBe(0);
  });

  it('drops conventional PMI when the balance reaches 80% of the price', () => {
    const result = calculateMortgage(inputs({ downPaymentPercent: 15 }));
    const months = result.mortgageInsuranceMonths;

    expect(months).not.toBeNull();
    const schedule = generateAmortizationSchedule(inputs({ downPaymentPercent: 15 }), result);
    // The balance is still above the cutoff the month before, and at or below it
    // on the reported month.
    expect(schedule[(months as number) - 2].balance).toBeGreaterThan(500_000 * 0.8);
    expect(schedule[(months as number) - 1].balance).toBeLessThanOrEqual(500_000 * 0.8);
  });

  it('shortens the PMI run when extra principal is paid', () => {
    const withoutExtra = calculateMortgage(inputs());
    const withExtra = calculateMortgage(inputs({ extraPrincipal: 500 }));

    expect(withExtra.mortgageInsuranceMonths).toBeLessThan(
      withoutExtra.mortgageInsuranceMonths as number
    );
  });

  it('runs FHA annual MIP for 11 years at 10% down and for the whole term below that', () => {
    expect(
      calculateMortgage(inputs({ loanType: 'fha', downPaymentPercent: 10 })).mortgageInsuranceMonths
    ).toBe(FHA_MIP_TERM_MONTHS);
    expect(
      calculateMortgage(inputs({ loanType: 'fha', downPaymentPercent: 3.5 })).mortgageInsuranceMonths
    ).toBeNull();
  });

  it('keeps the USDA annual fee for the life of the loan', () => {
    expect(
      calculateMortgage(inputs({ loanType: 'usda', downPaymentPercent: 0 })).mortgageInsuranceMonths
    ).toBeNull();
  });
});

describe('payment totals', () => {
  it('adds up the components of the monthly payment', () => {
    const result = calculateMortgage(inputs({ extraPrincipal: 200 }));

    const parts =
      result.principalAndInterest + result.propertyTaxes + 150 + 100 + result.pmiMonthly + 200;

    expect(result.totalMonthly).toBeCloseTo(parts, 6);
  });

  it('repays a zero-rate loan in equal instalments', () => {
    const result = calculateMortgage(inputs({ interestRate: 0 }));

    expect(result.principalAndInterest).toBeCloseTo(425_000 / 360, 6);
    expect(result.totalScheduledInterest).toBeCloseTo(0, 6);
  });

  it('reports scheduled interest that ignores extra principal', () => {
    const withoutExtra = calculateMortgage(inputs());
    const withExtra = calculateMortgage(inputs({ extraPrincipal: 500 }));

    expect(withExtra.totalScheduledInterest).toBeCloseTo(withoutExtra.totalScheduledInterest, 6);
  });

  it('stays finite when the buyer pays cash', () => {
    const result = calculateMortgage(inputs({ downPaymentPercent: 100 }));

    expect(result.loanAmount).toBe(0);
    expect(result.principalAndInterest).toBe(0);
    expect(Number.isFinite(result.totalMonthly)).toBe(true);
  });
});

describe('amortization schedule', () => {
  it('clears the balance and never overstates the final payment', () => {
    const calculations = calculateMortgage(inputs());
    const schedule = generateAmortizationSchedule(inputs(), calculations);

    expect(schedule).toHaveLength(360);
    expect(schedule.at(-1)?.balance).toBe(0);
    // The last instalment only has to clear what is left, so it cannot be more
    // than a regular payment.
    expect(schedule.at(-1)?.payment).toBeLessThanOrEqual(calculations.principalAndInterest + 1e-6);
    for (const entry of schedule) {
      expect(entry.payment).toBeCloseTo(entry.principal + entry.interest, 6);
    }
  });

  it('accumulates interest to the scheduled total', () => {
    const calculations = calculateMortgage(inputs());
    const schedule = generateAmortizationSchedule(inputs(), calculations);

    expect(schedule.at(-1)?.cumulativeInterest).toBeCloseTo(
      calculations.totalScheduledInterest,
      0
    );
  });

  it('pays the loan off early when extra principal is applied', () => {
    const withExtra = inputs({ extraPrincipal: 500 });
    const schedule = generateAmortizationSchedule(withExtra, calculateMortgage(withExtra));

    expect(schedule.length).toBeLessThan(360);
    expect(schedule.at(-1)?.balance).toBe(0);
  });

  it('produces no rows when there is nothing to repay', () => {
    const cash = inputs({ downPaymentPercent: 100 });

    expect(generateAmortizationSchedule(cash, calculateMortgage(cash))).toEqual([]);
  });
});

describe('extra principal impact', () => {
  it('reports the time and interest a prepayment saves', () => {
    const withExtra = inputs({ extraPrincipal: 500 });
    const impact = calculateExtraPrincipalImpact(withExtra, calculateMortgage(withExtra));

    expect(impact.monthsSaved).toBeGreaterThan(0);
    expect(impact.interestSaved).toBeGreaterThan(0);
    expect(impact.newPayoffDate.getTime()).toBeLessThan(impact.originalPayoffDate.getTime());
  });

  it('returns zeroes rather than NaN when there is no loan to prepay', () => {
    const cash = inputs({ downPaymentPercent: 100, extraPrincipal: 500 });
    const impact = calculateExtraPrincipalImpact(cash, calculateMortgage(cash));

    expect(impact.monthsSaved).toBe(0);
    expect(impact.interestSaved).toBe(0);
    expect(Number.isNaN(impact.interestSaved)).toBe(false);
  });
});

describe('loan type metadata', () => {
  const loanTypes: LoanType[] = ['conventional', 'fha', 'va', 'usda', 'jumbo'];

  it('describes every program', () => {
    for (const loanType of loanTypes) {
      expect(getLoanTypeInfo(loanType).name.length).toBeGreaterThan(0);
    }
  });

  it('marks the programs that carry monthly mortgage insurance', () => {
    expect(getLoanTypeInfo('conventional').hasPMI).toBe(true);
    expect(getLoanTypeInfo('jumbo').hasPMI).toBe(true);
    expect(getLoanTypeInfo('va').hasPMI).toBe(false);
  });

  it('recognises only real loan types', () => {
    for (const loanType of loanTypes) {
      expect(isLoanType(loanType)).toBe(true);
    }
    expect(isLoanType('reverse')).toBe(false);
    expect(isLoanType(null)).toBe(false);
    expect(isLoanType(undefined)).toBe(false);
  });
});
