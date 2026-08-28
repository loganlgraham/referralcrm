import {
  parseFiniteNumber,
  parseInputsFromParams,
  sanitizeMortgageInputs,
  toInputParams,
} from '@/components/mortgage/calculator-state';
import { calculateMortgage, type MortgageInputs } from '@/utils/mortgage-calculations';

const completeInputs: MortgageInputs = {
  purchasePrice: 500_000,
  downPaymentPercent: 15,
  interestRate: 6.75,
  termYears: 30,
  propertyTaxRate: 1.1,
  insuranceMonthly: 150,
  hoaMonthly: 100,
  pmiRate: 0.55,
  extraPrincipal: 0,
  loanType: 'va',
  vaSubsequentUse: true,
};

describe('parseFiniteNumber', () => {
  it('accepts numbers and rejects everything else', () => {
    expect(parseFiniteNumber('500000')).toBe(500_000);
    expect(parseFiniteNumber('6.75')).toBe(6.75);
    expect(parseFiniteNumber('-3')).toBe(-3);
    expect(parseFiniteNumber('abc')).toBeNull();
    expect(parseFiniteNumber('Infinity')).toBeNull();
    expect(parseFiniteNumber('')).toBeNull();
    expect(parseFiniteNumber(null)).toBeNull();
  });
});

describe('share links', () => {
  it('round-trips a scenario', () => {
    const restored = parseInputsFromParams(toInputParams(completeInputs));

    expect(restored).toEqual(completeInputs);
  });

  it('leaves the repeat-use flag out unless it applies', () => {
    const conventional = toInputParams({ ...completeInputs, loanType: 'conventional' });

    expect(conventional.get('vaSub')).toBeNull();
  });

  it('drops an unknown loan program instead of passing it to the fee tables', () => {
    const params = new URLSearchParams({ type: 'reverse', price: '400000' });
    const restored = parseInputsFromParams(params);

    expect(restored.loanType).toBeUndefined();
    expect(restored.purchasePrice).toBe(400_000);
    // The whole point: whatever survives can be priced without throwing.
    expect(() =>
      calculateMortgage({ ...completeInputs, ...restored })
    ).not.toThrow();
  });

  it('drops values that are not numbers so no field can become NaN', () => {
    const params = new URLSearchParams({
      price: 'lots',
      rate: '',
      term: 'thirty',
      down: '10',
    });
    const restored = parseInputsFromParams(params);

    expect(restored).toEqual({ downPaymentPercent: 10 });
  });

  it('ignores query parameters that have nothing to do with the calculator', () => {
    expect(parseInputsFromParams(new URLSearchParams({ utm_source: 'email' }))).toEqual({});
  });
});

describe('sanitizeMortgageInputs', () => {
  it('keeps a payload written by this release', () => {
    expect(sanitizeMortgageInputs(completeInputs)).toEqual(completeInputs);
  });

  it('discards fields of the wrong type', () => {
    const stored = {
      purchasePrice: '500000',
      downPaymentPercent: 15,
      interestRate: Number.NaN,
      loanType: 'reverse',
      vaSubsequentUse: 'yes',
    };

    expect(sanitizeMortgageInputs(stored)).toEqual({ downPaymentPercent: 15 });
  });

  it('tolerates junk in place of a payload', () => {
    expect(sanitizeMortgageInputs(null)).toEqual({});
    expect(sanitizeMortgageInputs('nope')).toEqual({});
    expect(sanitizeMortgageInputs([])).toEqual({});
  });
});
