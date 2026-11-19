import type { IntelligenceOrg, IntelligenceRole } from '@/lib/intelligence/panel';

export const OWNER_EMAIL = 'logan.graham@americanfinancing.net';
export const VERIFIED_FUB_ACCOUNT_ID = '1846967076';
export const VERIFIED_FUB_DOMAIN = 'americanhomeagents3';
export const VERIFIED_FUB_ORGANIZATION = 'AHA';
export const PRODUCTION_MONGO_HOST = 'referralcrm.4vy9f98.mongodb.net';
export const PRODUCTION_MONGO_DATABASE = 'test';
export const SANDBOX_MONGO_HOST = 'referriosandbox.34q13cy.mongodb.net';

export type AccountStatus = 'active' | 'disabled' | 'missing';
export type AccessStateName = 'absent' | 'granted' | 'revoked';
export type FubOrganization = IntelligenceOrg;

export type IdentityUser = {
  id: string;
  email: string;
  role: string | null;
  emailVerified: boolean;
  hasCredentials: boolean;
  providers: readonly string[];
};

export type OwnerAuditEntry = {
  at: string;
  action: 'assign';
  actor: 'bootstrap';
  previousOwnerUserId: null;
  nextOwnerUserId: string;
};

export type AccessAuditEntry = {
  at: string;
  actorId: string;
  targetUserId: string;
  organization: FubOrganization;
  fubAccountId: string;
  action: 'grant' | 'revoke';
  before: AccessStateName;
  after: 'granted' | 'revoked';
};

export type OwnerBootstrapPlan =
  | { ok: false; reason: 'database'; host: string | null; databaseName: string | null }
  | { ok: false; reason: 'missing_user' }
  | { ok: false; reason: 'ambiguous_user'; userIds: string[] }
  | { ok: false; reason: 'identity'; userId: string }
  | { ok: false; reason: 'unverified_identity'; userId: string }
  | { ok: false; reason: 'owner_conflict'; existingOwnerUserId: string }
  | { ok: true; changed: false }
  | { ok: true; changed: true; audit: OwnerAuditEntry };

export type AccessChangePlan =
  | {
      ok: false;
      status: 400 | 403 | 409;
      reason: 'forbidden' | 'not_admin' | 'owner_protected' | 'wrong_organization' | 'wrong_account' | 'not_configured';
    }
  | { ok: true; changed: false; dropCache: false }
  | { ok: true; changed: true; dropCache: boolean; next: 'granted' | 'revoked'; before: AccessStateName; audit: AccessAuditEntry };

export type OwnerState = {
  ownerUserId: string | null;
  audit: OwnerAuditEntry[];
};

const OBJECT_ID = /^[a-f\d]{24}$/i;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function databaseTargetFromUri(uri: string): { host: string; databaseName: string } | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) return null;
  try {
    const parsed = new URL(trimmed.replace(/^mongodb\+srv:\/\//, 'https://').replace(/^mongodb:\/\//, 'http://'));
    if (!parsed.hostname) return null;
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '') || PRODUCTION_MONGO_DATABASE;
    return { host: parsed.hostname, databaseName };
  } catch {
    return null;
  }
}

export function productionDatabaseAllowed(target: { host: string; databaseName: string } | null): { ok: true } | { ok: false; reason: 'database'; host: string | null; databaseName: string | null } {
  if (!target || target.host === SANDBOX_MONGO_HOST || target.host !== PRODUCTION_MONGO_HOST || target.databaseName !== PRODUCTION_MONGO_DATABASE) {
    return { ok: false, reason: 'database', host: target?.host ?? null, databaseName: target?.databaseName ?? null };
  }
  return { ok: true };
}

export function planOwnerBootstrap(input: {
  target: { host: string; databaseName: string } | null;
  expectedUserId: string;
  candidates: readonly IdentityUser[];
  existingOwnerUserId: string | null;
  at: string;
}): OwnerBootstrapPlan {
  const database = productionDatabaseAllowed(input.target);
  if (!database.ok) return database;
  const matches = input.candidates.filter((user) => normalizeEmail(user.email) === OWNER_EMAIL);
  if (matches.length === 0) return { ok: false, reason: 'missing_user' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous_user', userIds: matches.map((user) => user.id) };
  const user = matches[0];
  if (!user || user.id !== input.expectedUserId) return { ok: false, reason: 'identity', userId: user?.id ?? '' };
  if (!user.emailVerified && !user.hasCredentials && user.providers.length === 0) {
    return { ok: false, reason: 'unverified_identity', userId: user.id };
  }
  if (input.existingOwnerUserId && input.existingOwnerUserId !== input.expectedUserId) {
    return { ok: false, reason: 'owner_conflict', existingOwnerUserId: input.existingOwnerUserId };
  }
  if (input.existingOwnerUserId === input.expectedUserId) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    audit: {
      at: input.at,
      action: 'assign',
      actor: 'bootstrap',
      previousOwnerUserId: null,
      nextOwnerUserId: input.expectedUserId,
    },
  };
}

/** Compare-and-set so two racing bootstraps leave one owner and one audit entry. */
export function assignOwnerFromSnapshot(state: OwnerState, seenOwnerUserId: string | null, expectedUserId: string, at: string): { ok: true; changed: boolean } | { ok: false; reason: 'owner_conflict'; existingOwnerUserId: string } {
  if (state.ownerUserId !== seenOwnerUserId) {
    if (state.ownerUserId === expectedUserId) return { ok: true, changed: false };
    return { ok: false, reason: 'owner_conflict', existingOwnerUserId: state.ownerUserId ?? '' };
  }
  if (seenOwnerUserId === expectedUserId) return { ok: true, changed: false };
  if (seenOwnerUserId) return { ok: false, reason: 'owner_conflict', existingOwnerUserId: seenOwnerUserId };
  state.ownerUserId = expectedUserId;
  state.audit.push({
    at,
    action: 'assign',
    actor: 'bootstrap',
    previousOwnerUserId: null,
    nextOwnerUserId: expectedUserId,
  });
  return { ok: true, changed: true };
}

export function storedAccountStatus(user: { disabled?: boolean | null; active?: boolean | null; status?: string | null } | null): AccountStatus {
  if (!user) return 'missing';
  if (user.disabled === true || user.active === false) return 'disabled';
  if (typeof user.status === 'string') {
    const status = user.status.trim().toLowerCase();
    if (status === 'disabled' || status === 'inactive') return 'disabled';
  }
  return 'active';
}

export function mapStoredRole(role: string | null | undefined): IntelligenceRole {
  if (role === 'admin' || role === 'manager' || role === 'mc' || role === 'agent' || role === 'viewer') return role;
  if (role === 'mortgage-consultant') return 'mc';
  return null;
}

export function resolveViewerAuthority(input: {
  sessionUserId: string | null;
  sessionRole?: string | null;
  claimedOwner?: unknown;
  claimedRole?: unknown;
  storedUser: { id: string; role: string | null; disabled?: boolean | null; active?: boolean | null; status?: string | null } | null;
  ownerUserId: string | null;
}): { userId: string | null; role: IntelligenceRole; status: AccountStatus; isOwner: boolean } {
  void input.sessionRole;
  void input.claimedOwner;
  void input.claimedRole;
  if (!input.sessionUserId || !input.storedUser || input.storedUser.id !== input.sessionUserId) {
    return {
      userId: input.sessionUserId,
      role: null,
      status: input.storedUser ? storedAccountStatus(input.storedUser) : 'missing',
      isOwner: false,
    };
  }
  return {
    userId: input.sessionUserId,
    role: mapStoredRole(input.storedUser.role),
    status: storedAccountStatus(input.storedUser),
    isOwner: input.ownerUserId === input.sessionUserId,
  };
}

export function parseFubAccessCommand(body: unknown): { userId: string; organization: FubOrganization; access: boolean } | { error: 'malformed' } {
  if (!body || typeof body !== 'object') return { error: 'malformed' };
  const record = body as Record<string, unknown>;
  if (typeof record.userId !== 'string' || !OBJECT_ID.test(record.userId)) return { error: 'malformed' };
  if (record.organization !== undefined && record.organization !== VERIFIED_FUB_ORGANIZATION) return { error: 'malformed' };
  if (typeof record.access !== 'boolean') return { error: 'malformed' };
  return { userId: record.userId, organization: VERIFIED_FUB_ORGANIZATION, access: record.access };
}

export function fubConnectionSummary(configuredAccountId: string): { configured: true; accountId: string; domain: string } | { configured: false } {
  if (configuredAccountId === VERIFIED_FUB_ACCOUNT_ID) {
    return { configured: true, accountId: VERIFIED_FUB_ACCOUNT_ID, domain: VERIFIED_FUB_DOMAIN };
  }
  return { configured: false };
}

export function planAccessChange(input: {
  actorIsOwner: boolean;
  actorUserId: string;
  ownerUserId: string | null;
  target: { id: string; role: string | null; status: AccountStatus } | null;
  organization: string;
  configuredAccountId: string;
  requestedAccess: boolean;
  current: AccessStateName;
  at: string;
}): AccessChangePlan {
  if (!input.actorIsOwner) return { ok: false, status: 403, reason: 'forbidden' };
  if (!input.configuredAccountId) return { ok: false, status: 409, reason: 'not_configured' };
  if (input.configuredAccountId !== VERIFIED_FUB_ACCOUNT_ID) return { ok: false, status: 403, reason: 'wrong_account' };
  if (input.organization !== VERIFIED_FUB_ORGANIZATION) return { ok: false, status: 400, reason: 'wrong_organization' };
  const organization = input.organization;
  if (input.target && input.ownerUserId && input.target.id === input.ownerUserId && !input.requestedAccess) {
    return { ok: false, status: 409, reason: 'owner_protected' };
  }
  if (!input.target || input.target.status !== 'active' || input.target.role !== 'admin') {
    return { ok: false, status: 403, reason: 'not_admin' };
  }
  if (input.ownerUserId && input.target.id === input.ownerUserId) return { ok: true, changed: false, dropCache: false };
  const next = input.requestedAccess ? 'granted' : 'revoked';
  if (next === 'granted' && input.current === 'granted') return { ok: true, changed: false, dropCache: false };
  if (next === 'revoked' && (input.current === 'revoked' || input.current === 'absent')) return { ok: true, changed: false, dropCache: false };
  return {
    ok: true,
    changed: true,
    dropCache: next === 'revoked',
    next,
    before: input.current,
    audit: {
      at: input.at,
      actorId: input.actorUserId,
      targetUserId: input.target.id,
      organization,
      fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
      action: next === 'granted' ? 'grant' : 'revoke',
      before: input.current,
      after: next,
    },
  };
}

export function accessRaceResult(actual: AccessStateName, desired: 'granted' | 'revoked'): { changed: false } | { changed: false; conflict: true } {
  if (desired === 'granted' && actual === 'granted') return { changed: false };
  if (desired === 'revoked' && (actual === 'revoked' || actual === 'absent')) return { changed: false };
  return { changed: false, conflict: true };
}

export function visibleCachedIntelligence<T>(allowed: boolean, cached: T | null): T | null {
  if (!allowed) return null;
  return cached;
}

export function formatDenverDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('month')}/${read('day')}/${read('year')} ${read('hour')}:${read('minute')} ${read('dayPeriod')}`;
}

export function fubAccessFeedback(organization: FubOrganization, result: AccessChangePlan): string {
  if (!result.ok) {
    switch (result.reason) {
      case 'forbidden':
        return 'Only the account owner can manage Follow Up Boss access.';
      case 'not_admin':
        return 'Access can only be changed for an active administrator.';
      case 'owner_protected':
        return 'The account owner keeps View FUB Intelligence.';
      case 'wrong_organization':
        return 'That organization is not available.';
      case 'wrong_account':
        return 'That Follow Up Boss account is not the connected account.';
      case 'not_configured':
        return 'Follow Up Boss is not configured.';
      default: {
        const neverReason: never = result.reason;
        throw new Error(`Unexpected access result: ${String(neverReason)}`);
      }
    }
  }
  if (!result.changed) return 'No access change was needed.';
  return result.next === 'granted'
    ? `View FUB Intelligence granted for ${organization}.`
    : `View FUB Intelligence revoked for ${organization}.`;
}

export function describeStoredUserChange(update: unknown, removing: boolean): { removing: boolean; nextRole: string | null | undefined; disabling: boolean } {
  if (removing) return { removing: true, nextRole: undefined, disabling: false };
  if (Array.isArray(update)) {
    const serialized = JSON.stringify(update);
    const roleMatch = /"role"\s*:\s*"([^"]*)"/.exec(serialized);
    return {
      removing: false,
      nextRole: roleMatch?.[1],
      disabling: /"disabled"\s*:\s*true/.test(serialized) || /"active"\s*:\s*false/.test(serialized),
    };
  }
  if (!update || typeof update !== 'object') return { removing: false, nextRole: undefined, disabling: false };
  const record = update as Record<string, unknown>;
  const set = record.$set && typeof record.$set === 'object' ? (record.$set as Record<string, unknown>) : null;
  const unset = record.$unset && typeof record.$unset === 'object' ? (record.$unset as Record<string, unknown>) : null;
  let nextRole: string | null | undefined;
  if (unset && Object.prototype.hasOwnProperty.call(unset, 'role')) nextRole = null;
  else if (set && Object.prototype.hasOwnProperty.call(set, 'role')) nextRole = roleValue(set.role);
  else if (Object.prototype.hasOwnProperty.call(record, 'role')) nextRole = roleValue(record.role);
  const disabling = isDisableFlag(set?.disabled) || isDisableFlag(record.disabled) || set?.active === false || record.active === false || isInactiveStatus(set?.status) || isInactiveStatus(record.status);
  return { removing: false, nextRole, disabling };
}

export function ownerMutationIsBlocked(input: { targetIsOwner: boolean; removing: boolean; nextRole: string | null | undefined; disabling: boolean }): boolean {
  if (!input.targetIsOwner) return false;
  if (input.removing || input.disabling) return true;
  return input.nextRole !== undefined && input.nextRole !== 'admin';
}

export function roleSelectionDecision(input: { currentRole: string | null; requestedRole: string; isOwner: boolean }): { ok: true } | { ok: false; status: 409; error: string } {
  if (ownerMutationIsBlocked({ targetIsOwner: input.isOwner, removing: false, disabling: false, nextRole: input.requestedRole })) {
    return { ok: false, status: 409, error: 'The account owner remains an administrator.' };
  }
  if (input.currentRole) return { ok: false, status: 409, error: 'Role already set' };
  return { ok: true };
}

export function userRemovalDecision(isOwner: boolean): { ok: true } | { ok: false; status: 409; error: string } {
  if (!isOwner) return { ok: true };
  return { ok: false, status: 409, error: 'The account owner cannot be removed.' };
}

function roleValue(value: unknown): string | null | undefined {
  if (typeof value === 'string' || value === null) return value;
  return undefined;
}

function isDisableFlag(value: unknown): boolean {
  return value === true;
}

function isInactiveStatus(value: unknown): boolean {
  return typeof value === 'string' && (value.toLowerCase() === 'disabled' || value.toLowerCase() === 'inactive');
}
