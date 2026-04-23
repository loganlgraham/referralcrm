import type { Types } from 'mongoose';

import { LenderMC } from '@/models/lender';

export type McMatchResult =
  | { id: Types.ObjectId; name: string }
  | { ambiguous: true; candidateIds: string[] }
  | null;

interface LenderTokenEntry {
  id: Types.ObjectId;
  name: string;
  token: string;
}

const FREE_TEXT_TOKEN_PATTERN = /\b[A-Z][a-z]+[A-Z](?:[a-z])?\b/g;
const MC_TOKEN_ALIASES: Record<string, string> = {
  christopherl: 'chrisl',
  jasoncr: 'jasonc'
};

export function normalizeMcToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveMcTokenAlias(normalizedToken: string): string {
  return MC_TOKEN_ALIASES[normalizedToken] ?? normalizedToken;
}

function buildLenderToken(name: string): string | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const firstName = parts[0];
  const lastNameInitial = parts[parts.length - 1]!.charAt(0);
  if (!firstName || !lastNameInitial) {
    return null;
  }

  return normalizeMcToken(`${firstName}${lastNameInitial}`);
}

async function loadLenderTokenEntries(): Promise<LenderTokenEntry[]> {
  const lenders = await LenderMC.find({})
    .select('_id name')
    .lean<{ _id: Types.ObjectId; name?: string | null }[]>();

  const entries: LenderTokenEntry[] = [];
  for (const lender of lenders) {
    const name = typeof lender.name === 'string' ? lender.name : '';
    if (!name) {
      continue;
    }
    const token = buildLenderToken(name);
    if (!token) {
      continue;
    }
    entries.push({ id: lender._id, name, token });
  }
  return entries;
}

function resolveMatchesForToken(
  entries: LenderTokenEntry[],
  normalizedToken: string
): LenderTokenEntry[] {
  if (!normalizedToken) {
    return [];
  }
  return entries.filter((entry) => entry.token === normalizedToken);
}

export async function findMcByFirstNameLastInitialToken(token: string): Promise<McMatchResult> {
  const normalizedToken = resolveMcTokenAlias(normalizeMcToken(token));
  if (!normalizedToken) {
    return null;
  }

  const entries = await loadLenderTokenEntries();
  const matches = resolveMatchesForToken(entries, normalizedToken);

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    return {
      ambiguous: true,
      candidateIds: matches.map((match) => match.id.toString())
    };
  }

  const matched = matches[0]!;
  return {
    id: matched.id,
    name: matched.name
  };
}

export async function findMcInFreeText(text: string): Promise<McMatchResult> {
  if (!text) {
    return null;
  }

  const rawTokens = text.match(FREE_TEXT_TOKEN_PATTERN);
  if (!rawTokens || rawTokens.length === 0) {
    return null;
  }

  const normalizedCandidates = new Set<string>();
  for (const rawToken of rawTokens) {
    const normalized = resolveMcTokenAlias(normalizeMcToken(rawToken));
    if (normalized) {
      normalizedCandidates.add(normalized);
    }
  }

  if (normalizedCandidates.size === 0) {
    return null;
  }

  const entries = await loadLenderTokenEntries();
  if (entries.length === 0) {
    return null;
  }

  const matchedById = new Map<string, LenderTokenEntry>();
  for (const candidate of normalizedCandidates) {
    const matches = resolveMatchesForToken(entries, candidate);
    for (const match of matches) {
      matchedById.set(match.id.toString(), match);
    }
  }

  if (matchedById.size === 0) {
    return null;
  }

  if (matchedById.size > 1) {
    return {
      ambiguous: true,
      candidateIds: Array.from(matchedById.keys())
    };
  }

  const matched = matchedById.values().next().value as LenderTokenEntry;
  return {
    id: matched.id,
    name: matched.name
  };
}
