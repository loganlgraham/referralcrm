import { Types } from 'mongoose';

import { CoverageSuggestion } from '@/models/coverage-suggestion';

export interface CoverageSuggestionEntry {
  id: string;
  value: string;
}

const numericPattern = /^\d+$/;

export function normalizeCoverageValue(value: string): string {
  return value.trim().toLowerCase();
}

export async function rememberCoverageSuggestions(values: string[]): Promise<void> {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }

  const entries = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => ({ value, normalized: normalizeCoverageValue(value) }));

  if (entries.length === 0) {
    return;
  }

  const uniqueByNormalized = new Map<string, string>();
  for (const entry of entries) {
    if (!uniqueByNormalized.has(entry.normalized)) {
      uniqueByNormalized.set(entry.normalized, entry.value);
    }
  }

  const operations = Array.from(uniqueByNormalized.entries()).map(([normalized, value]) =>
    CoverageSuggestion.updateOne(
      { normalized },
      {
        $setOnInsert: { normalized },
        $set: { value }
      },
      { upsert: true }
    )
  );

  await Promise.all(operations);
}

export function sortCoverageSuggestions(
  suggestions: { _id: Types.ObjectId; value: string }[]
): CoverageSuggestionEntry[] {
  const alpha: CoverageSuggestionEntry[] = [];
  const numeric: CoverageSuggestionEntry[] = [];

  suggestions.forEach((suggestion) => {
    const entry: CoverageSuggestionEntry = {
      id: suggestion._id.toString(),
      value: suggestion.value
    };
    if (numericPattern.test(suggestion.value.trim())) {
      numeric.push(entry);
    } else {
      alpha.push(entry);
    }
  });

  alpha.sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }));
  numeric.sort((a, b) => Number.parseInt(a.value, 10) - Number.parseInt(b.value, 10));

  return [...alpha, ...numeric];
}

