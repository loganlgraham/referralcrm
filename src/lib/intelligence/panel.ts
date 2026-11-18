export type IntelligenceOrg = 'AHA' | 'AFC';

export type IntelligenceRole = 'admin' | 'manager' | 'mc' | 'agent' | 'viewer' | null;

export type AccessGrant = {
  organization: IntelligenceOrg;
  fubAccountId: string;
  userId: string;
  revokedAt?: string | null;
};

export type PanelAccess =
  | { ok: true }
  | { ok: false; status: 401 | 403; reason: 'anonymous' | 'role' | 'referral' | 'unmapped' | 'revoked' | 'wrong_organization' | 'wrong_account' };

const PARTICIPANT_KEY = /^(borrower|participant:[a-z0-9_-]{1,40})$/;

export function authorizeIntelligencePanel(input: {
  userId: string | null;
  role: IntelligenceRole;
  canViewReferral: boolean;
  referralOrg: string;
  grant: AccessGrant | null;
  configuredAccountId: string;
}): PanelAccess {
  if (!input.userId) return { ok: false, status: 401, reason: 'anonymous' };
  if (input.role !== 'admin' && input.role !== 'manager') return { ok: false, status: 403, reason: 'role' };
  if (!input.canViewReferral) return { ok: false, status: 403, reason: 'referral' };
  if (!input.grant || input.grant.userId !== input.userId) return { ok: false, status: 403, reason: 'unmapped' };
  if (input.grant.revokedAt) return { ok: false, status: 403, reason: 'revoked' };
  if (input.grant.organization !== input.referralOrg) return { ok: false, status: 403, reason: 'wrong_organization' };
  if (input.grant.fubAccountId !== input.configuredAccountId) return { ok: false, status: 403, reason: 'wrong_account' };
  return { ok: true };
}

export function parseParticipantKey(value: unknown): string | null {
  return typeof value === 'string' && PARTICIPANT_KEY.test(value) ? value : null;
}

/** The referral model has one structured customer, the borrower. */
export function participantBelongsToReferral(participantKey: string | null, allowed: readonly string[]): boolean {
  return participantKey !== null && allowed.includes(participantKey);
}

export function sameOriginRequest(input: { requestOrigin: string | null; pageOrigin: string; fetchSite: string | null }): boolean {
  if (input.fetchSite === 'cross-site' || input.fetchSite === 'same-site') return false;
  if (input.fetchSite === 'same-origin') return true;
  if (!input.requestOrigin) return false;
  return input.requestOrigin === input.pageOrigin;
}

export function parseFubPersonId(value: unknown): number | null | 'invalid' {
  if (value === null || value === '') return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return Number(value);
  return 'invalid';
}

export type IdentitySuggestion =
  | { status: 'unlinked'; reason: 'none' | 'ambiguous' | 'incomplete' }
  | { status: 'suggestion'; personId: number };

/** A suggestion is never a link. More than one candidate stays unlinked. */
export function reviewIdentitySuggestion(candidates: readonly { personId: number; name?: string | null; email?: string | null; phone?: string | null }[]): IdentitySuggestion {
  if (candidates.length === 0) return { status: 'unlinked', reason: 'none' };
  if (candidates.length > 1) return { status: 'unlinked', reason: 'ambiguous' };
  const only = candidates[0];
  if (!only || !only.name || (!only.email && !only.phone)) return { status: 'unlinked', reason: 'incomplete' };
  return { status: 'suggestion', personId: only.personId };
}

export function agentsDiffer(referrioName: string | null, fubName: string | null, referrioFubUserId: number | null, assignedFubUserId: number | null): boolean {
  if (referrioFubUserId && assignedFubUserId && referrioFubUserId !== assignedFubUserId) return true;
  if (referrioName && fubName && referrioName.trim().toLowerCase() !== fubName.trim().toLowerCase()) return true;
  return false;
}
