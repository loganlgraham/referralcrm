/**
 * Reading and writing calculator state to the outside world: share links and
 * local storage. Everything crossing this boundary is untrusted, so each value
 * is validated before it reaches a field or a calculation.
 */

import { isLoanType, type MortgageInputs } from '@/utils/mortgage-calculations';

const CALCULATOR_STORAGE_KEY = 'referrio:mortgage-calculator:v1';
const AFFORDABILITY_STORAGE_KEY = 'referrio:mortgage-affordability:v1';

/** Every numeric field on the calculator, i.e. everything a NumberField edits. */
export type MortgageNumericKey = Exclude<keyof MortgageInputs, 'loanType' | 'vaSubsequentUse'>;

/** Short query-string names, kept here so links and parsing cannot drift apart. */
const PARAM_TO_INPUT: Record<string, MortgageNumericKey> = {
  price: 'purchasePrice',
  down: 'downPaymentPercent',
  rate: 'interestRate',
  term: 'termYears',
  tax: 'propertyTaxRate',
  insurance: 'insuranceMonthly',
  hoa: 'hoaMonthly',
  pmi: 'pmiRate',
  extra: 'extraPrincipal',
};

const NUMERIC_INPUT_KEYS: readonly MortgageNumericKey[] = Object.values(PARAM_TO_INPUT);

/** Finite numbers only, so a malformed link can never put NaN into a field. */
export function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assignNumeric(
  inputs: Partial<MortgageInputs>,
  key: MortgageNumericKey,
  value: number | null
): void {
  if (value !== null) inputs[key] = value;
}

/**
 * Loan inputs carried by a share link. Unknown loan programs and non-numeric
 * values are dropped rather than trusted, since a bad `type` would otherwise
 * reach the fee tables and throw.
 */
export function parseInputsFromParams(params: URLSearchParams): Partial<MortgageInputs> {
  const inputs: Partial<MortgageInputs> = {};

  for (const [param, key] of Object.entries(PARAM_TO_INPUT)) {
    assignNumeric(inputs, key, parseFiniteNumber(params.get(param)));
  }

  const loanType = params.get('type');
  if (isLoanType(loanType)) inputs.loanType = loanType;
  if (params.get('vaSub') === '1') inputs.vaSubsequentUse = true;

  return inputs;
}

/** The share-link half of `parseInputsFromParams`. */
export function toInputParams(inputs: MortgageInputs): URLSearchParams {
  const params = new URLSearchParams();

  for (const [param, key] of Object.entries(PARAM_TO_INPUT)) {
    params.set(param, String(inputs[key]));
  }

  params.set('type', inputs.loanType ?? 'conventional');
  if (inputs.loanType === 'va' && inputs.vaSubsequentUse) params.set('vaSub', '1');

  return params;
}

/** Loan inputs from a stored payload, which may be from an older release. */
export function sanitizeMortgageInputs(value: unknown): Partial<MortgageInputs> {
  if (typeof value !== 'object' || value === null) return {};

  const record = value as Record<string, unknown>;
  const inputs: Partial<MortgageInputs> = {};

  for (const key of NUMERIC_INPUT_KEYS) {
    assignNumeric(inputs, key, finiteNumber(record[key]));
  }

  if (isLoanType(record.loanType)) inputs.loanType = record.loanType;
  if (typeof record.vaSubsequentUse === 'boolean') inputs.vaSubsequentUse = record.vaSubsequentUse;

  return inputs;
}

/**
 * A saved scenario on disk. Only the inputs are stored: the payment and the
 * schedule are recomputed on load, so a saved scenario always reflects the
 * current fee tables rather than whatever they were when it was saved.
 */
export interface StoredScenario {
  id: string;
  name: string;
  inputs: Partial<MortgageInputs>;
}

export interface StoredCalculatorState {
  inputs: Partial<MortgageInputs>;
  scenarios: StoredScenario[];
}

function readStorage(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Storage throws in private browsing and when the quota is full. State
    // simply does not persist in that case.
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to recover from; the calculator works without persistence.
  }
}

function sanitizeStoredScenarios(value: unknown): StoredScenario[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): StoredScenario[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return [];
    return [{ id: record.id, name: record.name, inputs: sanitizeMortgageInputs(record.inputs) }];
  });
}

export function loadCalculatorState(): StoredCalculatorState {
  const stored = readStorage(CALCULATOR_STORAGE_KEY);
  if (typeof stored !== 'object' || stored === null) return { inputs: {}, scenarios: [] };

  const record = stored as Record<string, unknown>;
  return {
    inputs: sanitizeMortgageInputs(record.inputs),
    scenarios: sanitizeStoredScenarios(record.scenarios),
  };
}

export function saveCalculatorState(state: StoredCalculatorState): void {
  writeStorage(CALCULATOR_STORAGE_KEY, state);
}

/** Raw borrower payload; the Affordability panel validates its own shape. */
export function loadAffordabilityState(): Record<string, unknown> | null {
  const stored = readStorage(AFFORDABILITY_STORAGE_KEY);
  if (typeof stored !== 'object' || stored === null) return null;
  return stored as Record<string, unknown>;
}

export function saveAffordabilityState(state: unknown): void {
  writeStorage(AFFORDABILITY_STORAGE_KEY, state);
}

/** Wipes everything the calculator remembers, for "Reset to defaults". */
export function clearStoredCalculatorState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CALCULATOR_STORAGE_KEY);
    window.localStorage.removeItem(AFFORDABILITY_STORAGE_KEY);
  } catch {
    // Nothing to recover from.
  }
}
