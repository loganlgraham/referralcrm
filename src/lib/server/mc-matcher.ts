import type { Types } from 'mongoose';

import { LenderMC } from '@/models/lender';

export type McMatchResult =
  | { id: Types.ObjectId; name: string }
  | { ambiguous: true; candidateIds: string[] }
  | null;

export function normalizeMcToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
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

export async function findMcByFirstNameLastInitialToken(token: string): Promise<McMatchResult> {
  const normalizedToken = normalizeMcToken(token);
  if (!normalizedToken) {
    return null;
  }

  const lenders = await LenderMC.find({})
    .select('_id name')
    .lean<{ _id: Types.ObjectId; name?: string | null }[]>();

  const matches = lenders.filter((lender) => {
    const name = typeof lender.name === 'string' ? lender.name : '';
    if (!name) {
      return false;
    }
    const lenderToken = buildLenderToken(name);
    return lenderToken !== null && lenderToken === normalizedToken;
  });

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    return {
      ambiguous: true,
      candidateIds: matches.map((match) => match._id.toString())
    };
  }

  const matched = matches[0]!;
  return {
    id: matched._id,
    name: matched.name ?? ''
  };
}
