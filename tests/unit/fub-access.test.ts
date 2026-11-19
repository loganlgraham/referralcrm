import { readFileSync } from 'node:fs';
import { authorizeIntelligencePanel } from '@/lib/intelligence/panel';
import { canViewReferral } from '@/lib/rbac';
import {
  OWNER_EMAIL,
  PRODUCTION_MONGO_DATABASE,
  PRODUCTION_MONGO_HOST,
  SANDBOX_MONGO_HOST,
  VERIFIED_FUB_ACCOUNT_ID,
  accessRaceResult,
  assignOwnerFromSnapshot,
  databaseTargetFromUri,
  describeStoredUserChange,
  formatDenverDateTime,
  fubAccessFeedback,
  fubConnectionSummary,
  ownerMutationIsBlocked,
  parseFubAccessCommand,
  planAccessChange,
  planOwnerBootstrap,
  productionDatabaseAllowed,
  resolveViewerAuthority,
  roleSelectionDecision,
  userRemovalDecision,
  visibleCachedIntelligence,
  type IdentityUser,
  type OwnerState,
} from '@/lib/intelligence/access-control';

const OWNER_ID = '6740aabbccddeeff00112233';
const ADMIN_ID = '6740aabbccddeeff00112244';
const AT = '2026-11-18T17:00:00.000Z';
const PRODUCTION = { host: PRODUCTION_MONGO_HOST, databaseName: PRODUCTION_MONGO_DATABASE };

function ownerUser(overrides: Partial<IdentityUser> = {}): IdentityUser {
  return {
    id: OWNER_ID,
    email: OWNER_EMAIL,
    role: 'admin',
    emailVerified: true,
    hasCredentials: true,
    providers: ['email'],
    ...overrides,
  };
}

function accessInput(overrides: Partial<Parameters<typeof planAccessChange>[0]> = {}) {
  return {
    actorIsOwner: true,
    actorUserId: OWNER_ID,
    ownerUserId: OWNER_ID,
    target: { id: ADMIN_ID, role: 'admin', status: 'active' as const },
    organization: 'AHA',
    configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
    requestedAccess: true,
    current: 'absent' as const,
    at: AT,
    ...overrides,
  };
}

describe('account owner bootstrap', () => {
  it('assigns the verified user once and records a single audit entry', () => {
    const first = planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: OWNER_ID,
      candidates: [ownerUser()],
      existingOwnerUserId: null,
      at: AT,
    });
    expect(first).toMatchObject({
      ok: true,
      changed: true,
      audit: { action: 'assign', actor: 'bootstrap', previousOwnerUserId: null, nextOwnerUserId: OWNER_ID, at: AT },
    });
    const state: OwnerState = { ownerUserId: null, audit: [] };
    expect(assignOwnerFromSnapshot(state, null, OWNER_ID, AT)).toEqual({ ok: true, changed: true });
    expect(assignOwnerFromSnapshot(state, null, OWNER_ID, '2026-11-18T18:00:00.000Z')).toEqual({ ok: true, changed: false });
    expect(state.audit).toHaveLength(1);
    expect(planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: OWNER_ID,
      candidates: [ownerUser()],
      existingOwnerUserId: OWNER_ID,
      at: '2026-11-18T18:00:00.000Z',
    })).toEqual({ ok: true, changed: false });
  });

  it('rejects an ambiguous user, a different id, an unverified user, and another owner', () => {
    expect(planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: OWNER_ID,
      candidates: [ownerUser(), ownerUser({ id: ADMIN_ID, email: 'Logan.Graham@AmericanFinancing.net' })],
      existingOwnerUserId: null,
      at: AT,
    })).toEqual({ ok: false, reason: 'ambiguous_user', userIds: [OWNER_ID, ADMIN_ID] });
    expect(planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: ADMIN_ID,
      candidates: [ownerUser()],
      existingOwnerUserId: null,
      at: AT,
    })).toEqual({ ok: false, reason: 'identity', userId: OWNER_ID });
    expect(planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: OWNER_ID,
      candidates: [ownerUser({ emailVerified: false, hasCredentials: false, providers: [] })],
      existingOwnerUserId: null,
      at: AT,
    })).toEqual({ ok: false, reason: 'unverified_identity', userId: OWNER_ID });
    expect(planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: OWNER_ID,
      candidates: [ownerUser()],
      existingOwnerUserId: ADMIN_ID,
      at: AT,
    })).toEqual({ ok: false, reason: 'owner_conflict', existingOwnerUserId: ADMIN_ID });
    expect(planOwnerBootstrap({
      target: PRODUCTION,
      expectedUserId: OWNER_ID,
      candidates: [],
      existingOwnerUserId: null,
      at: AT,
    })).toEqual({ ok: false, reason: 'missing_user' });
  });

  it('refuses the sandbox and any database other than production', () => {
    const sandbox = databaseTargetFromUri('mongodb+srv://user:secret@referriosandbox.34q13cy.mongodb.net/test');
    expect(sandbox?.host).toBe(SANDBOX_MONGO_HOST);
    expect(productionDatabaseAllowed(sandbox).ok).toBe(false);
    expect(planOwnerBootstrap({
      target: { host: SANDBOX_MONGO_HOST, databaseName: 'test' },
      expectedUserId: OWNER_ID,
      candidates: [ownerUser()],
      existingOwnerUserId: null,
      at: AT,
    }).ok).toBe(false);
    expect(databaseTargetFromUri('mongodb+srv://user:secret@referralcrm.4vy9f98.mongodb.net')?.databaseName).toBe('test');
    expect(databaseTargetFromUri('mongodb+srv://user:secret@referralcrm.4vy9f98.mongodb.net/other')?.databaseName).toBe('other');
    expect(String(databaseTargetFromUri('not a uri'))).toBe('null');
  });
});

describe('Follow Up Boss access', () => {
  const grant = { organization: 'AHA' as const, fubAccountId: VERIFIED_FUB_ACCOUNT_ID, userId: ADMIN_ID };

  it('gives the owner AHA access only and keeps referral checks', () => {
    expect(authorizeIntelligencePanel({
      userId: OWNER_ID,
      role: 'agent',
      storedRole: 'admin',
      accountStatus: 'active',
      isOwner: true,
      canViewReferral: true,
      referralOrg: 'AHA',
      grant: null,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).ok).toBe(true);
    expect(authorizeIntelligencePanel({
      userId: OWNER_ID,
      role: 'admin',
      storedRole: 'admin',
      isOwner: true,
      canViewReferral: true,
      referralOrg: 'AFC',
      grant: null,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('wrong_organization');
    expect(authorizeIntelligencePanel({
      userId: OWNER_ID,
      role: 'admin',
      storedRole: 'admin',
      isOwner: true,
      canViewReferral: false,
      referralOrg: 'AHA',
      grant: null,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('referral');
    expect(authorizeIntelligencePanel({
      userId: OWNER_ID,
      role: 'admin',
      storedRole: 'admin',
      isOwner: true,
      canViewReferral: true,
      referralOrg: 'AHA',
      grant: null,
      configuredAccountId: '999',
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('wrong_account');
  });

  it('requires an explicit grant per organization and ignores a stale or forged role', () => {
    expect(authorizeIntelligencePanel({
      userId: ADMIN_ID,
      role: 'admin',
      storedRole: 'admin',
      canViewReferral: true,
      referralOrg: 'AHA',
      grant: null,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('unmapped');
    expect(authorizeIntelligencePanel({
      userId: ADMIN_ID,
      role: 'admin',
      storedRole: 'admin',
      canViewReferral: true,
      referralOrg: 'AFC',
      grant,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('wrong_organization');
    expect(authorizeIntelligencePanel({
      userId: ADMIN_ID,
      role: 'admin',
      storedRole: 'admin',
      canViewReferral: true,
      referralOrg: 'AHA',
      grant: { ...grant, revokedAt: AT },
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('revoked');
    expect(authorizeIntelligencePanel({
      userId: ADMIN_ID,
      role: 'admin',
      storedRole: 'agent',
      canViewReferral: true,
      referralOrg: 'AHA',
      grant,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('role');
    expect(authorizeIntelligencePanel({
      userId: ADMIN_ID,
      role: 'admin',
      storedRole: 'admin',
      accountStatus: 'disabled',
      canViewReferral: true,
      referralOrg: 'AHA',
      grant,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('disabled');
    const viewer = resolveViewerAuthority({
      sessionUserId: ADMIN_ID,
      sessionRole: 'admin',
      claimedOwner: true,
      claimedRole: 'admin',
      storedUser: { id: ADMIN_ID, role: 'agent', disabled: true },
      ownerUserId: OWNER_ID,
    });
    expect(viewer).toMatchObject({ role: 'agent', isOwner: false, status: 'disabled' });
    expect(authorizeIntelligencePanel({
      userId: viewer.userId,
      role: viewer.role,
      storedRole: viewer.role,
      accountStatus: viewer.status,
      isOwner: viewer.isOwner,
      canViewReferral: true,
      referralOrg: 'AHA',
      grant,
      configuredAccountId: VERIFIED_FUB_ACCOUNT_ID,
      verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
    }).reason).toBe('disabled');
  });

  it('grants and revokes AHA only without creating a duplicate audit', () => {
    const afc = planAccessChange(accessInput({ organization: 'AFC' }));
    const aha = planAccessChange(accessInput({ current: 'absent' }));
    expect(afc.ok).toBe(false);
    expect(!afc.ok && afc.reason).toBe('wrong_organization');
    expect(aha.ok && aha.changed && aha.audit.before).toBe('absent');
    expect(planAccessChange(accessInput({ current: 'granted' }))).toEqual({ ok: true, changed: false, dropCache: false });
    const revoked = planAccessChange(accessInput({ requestedAccess: false, current: 'granted' }));
    expect(revoked.ok && revoked.changed && revoked.dropCache).toBe(true);
    if (revoked.ok && revoked.changed) {
      expect(revoked.audit).toMatchObject({ actorId: OWNER_ID, targetUserId: ADMIN_ID, fubAccountId: VERIFIED_FUB_ACCOUNT_ID, before: 'granted', after: 'revoked' });
    }
    expect(planAccessChange(accessInput({ requestedAccess: false, current: 'absent' }))).toEqual({ ok: true, changed: false, dropCache: false });
    expect(visibleCachedIntelligence(false, { personId: 100 })).toBeNull();
    expect(visibleCachedIntelligence(true, { personId: 100 })).toEqual({ personId: 100 });
    const state: { current: 'absent' | 'granted'; audits: number } = { current: 'absent', audits: 0 };
    const seen = state.current;
    const winner = planAccessChange(accessInput({ current: seen }));
    if (winner.ok && winner.changed) {
      state.current = 'granted';
      state.audits += 1;
    }
    expect(accessRaceResult('granted', 'granted')).toEqual({ changed: false });
    expect(state.audits).toBe(1);
  });

  it('rejects non-owners, the wrong account, and changes to the owner or a demoted admin', () => {
    expect(planAccessChange(accessInput({ actorIsOwner: false, actorUserId: ADMIN_ID })).reason).toBe('forbidden');
    expect(planAccessChange(accessInput({ configuredAccountId: '' })).reason).toBe('not_configured');
    expect(planAccessChange(accessInput({ configuredAccountId: '1' })).reason).toBe('wrong_account');
    expect(planAccessChange(accessInput({ organization: 'BOTH' })).reason).toBe('wrong_organization');
    expect(planAccessChange(accessInput({ target: { id: OWNER_ID, role: 'admin', status: 'active' }, requestedAccess: false })).reason).toBe('owner_protected');
    expect(planAccessChange(accessInput({ target: { id: OWNER_ID, role: 'admin', status: 'active' }, requestedAccess: true }))).toEqual({ ok: true, changed: false, dropCache: false });
    expect(planAccessChange(accessInput({ target: { id: ADMIN_ID, role: 'agent', status: 'active' } })).reason).toBe('not_admin');
    expect(planAccessChange(accessInput({ target: { id: ADMIN_ID, role: 'admin', status: 'disabled' } })).reason).toBe('not_admin');
    expect(planAccessChange(accessInput({ target: null })).reason).toBe('not_admin');
    const command = parseFubAccessCommand({
      userId: ADMIN_ID,
      organization: 'AHA',
      access: true,
      isOwner: true,
      role: 'admin',
      fubAccountId: '1',
    });
    expect(command).toEqual({ userId: ADMIN_ID, organization: 'AHA', access: true });
    expect(parseFubAccessCommand({ userId: ADMIN_ID, organization: 'AFC', access: true })).toEqual({ error: 'malformed' });
    expect(parseFubAccessCommand({ userId: 'nope', organization: 'AFC', access: true })).toEqual({ error: 'malformed' });
    expect(fubConnectionSummary(VERIFIED_FUB_ACCOUNT_ID)).toEqual({ configured: true, accountId: VERIFIED_FUB_ACCOUNT_ID, domain: 'americanhomeagents3' });
    expect(fubConnectionSummary('')).toEqual({ configured: false });
    expect(fubAccessFeedback('AHA', planAccessChange(accessInput()))).toBe('View FUB Intelligence granted for AHA.');
    expect(fubAccessFeedback('AHA', planAccessChange(accessInput({ actorIsOwner: false })))).toBe('Only the account owner can manage Follow Up Boss access.');
  });

  it('keeps the owner as an administrator and leaves referral visibility unchanged', () => {
    expect(roleSelectionDecision({ currentRole: 'admin', requestedRole: 'agent', isOwner: true })).toMatchObject({ ok: false, status: 409 });
    expect(roleSelectionDecision({ currentRole: 'admin', requestedRole: 'admin', isOwner: false })).toMatchObject({ ok: false, error: 'Role already set' });
    expect(roleSelectionDecision({ currentRole: null, requestedRole: 'agent', isOwner: false })).toEqual({ ok: true });
    expect(userRemovalDecision(true).ok).toBe(false);
    expect(userRemovalDecision(false)).toEqual({ ok: true });
    const demotion = describeStoredUserChange({ $set: { role: 'agent' } }, false);
    expect(ownerMutationIsBlocked({ targetIsOwner: true, ...demotion })).toBe(true);
    expect(ownerMutationIsBlocked({ targetIsOwner: true, ...describeStoredUserChange({ $set: { disabled: true } }, false) })).toBe(true);
    expect(ownerMutationIsBlocked({ targetIsOwner: true, ...describeStoredUserChange({ $set: { active: false } }, false) })).toBe(true);
    expect(ownerMutationIsBlocked({ targetIsOwner: true, ...describeStoredUserChange(null, true) })).toBe(true);
    expect(ownerMutationIsBlocked({ targetIsOwner: true, ...describeStoredUserChange({ $set: { name: 'Logan' } }, false) })).toBe(false);
    expect(ownerMutationIsBlocked({ targetIsOwner: false, ...demotion })).toBe(false);
    const session = { user: { id: 'agent-1', role: 'agent' as const } };
    expect(canViewReferral(session as never, { org: 'AHA' })).toBe(false);
    expect(canViewReferral({ user: { id: 'admin-1', role: 'admin' } } as never, { org: 'AFC' })).toBe(true);
    expect(canViewReferral(session as never, { org: 'AHA', assignedAgent: { userId: 'agent-1' } })).toBe(true);
  });

  it('formats Denver times and does not call Follow Up Boss or a model from the settings route', () => {
    expect(formatDenverDateTime('2026-11-18T17:00:00.000Z')).toBe('11/18/2026 10:00 AM');
    expect(formatDenverDateTime('2026-11-18T08:05:00.000Z')).toBe('11/18/2026 1:05 AM');
    expect(formatDenverDateTime('2026-07-18T18:05:00.000Z')).toBe('07/18/2026 12:05 PM');
    const route = readFileSync('src/app/api/admin/fub-access/route.ts', 'utf8');
    const intelligence = readFileSync('src/app/api/referrals/[id]/intelligence/route.ts', 'utf8');
    const server = readFileSync('src/lib/server/fub-access.ts', 'utf8');
    for (const source of [route, intelligence, server]) {
      expect(source.includes('api.followupboss.com')).toBe(false);
      expect(source.includes('api.openai.com')).toBe(false);
    }
    expect(route.includes('sameOriginRequest')).toBe(true);
    expect(route.includes('isOwner')).toBe(false);
    expect(server.includes('VERIFIED_FUB_ACCOUNT_ID')).toBe(true);
    expect(server.includes('clearIntelligenceCache')).toBe(true);
    expect(intelligence.includes('storedRole')).toBe(true);
  });
});
