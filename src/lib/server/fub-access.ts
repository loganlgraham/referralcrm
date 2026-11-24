import { Types } from 'mongoose';
import {
  OWNER_EMAIL,
  VERIFIED_FUB_ACCOUNT_ID,
  VERIFIED_FUB_ORGANIZATION,
  accessRaceResult,
  fubConnectionSummary,
  normalizeEmail,
  planAccessChange,
  planOwnerBootstrap,
  productionDatabaseAllowed,
  storedAccountStatus,
  type AccessAuditEntry,
  type AccessStateName,
  type FubOrganization,
  type IdentityUser,
} from '@/lib/intelligence/access-control';
import { clearIntelligenceCache } from '@/lib/intelligence/remote';
import { ACCOUNT_OWNER_KEY, AccountOwner } from '@/models/account-owner';
import { FubDashboardAccess, IntelligenceAccess, IntelligenceLink } from '@/models/intelligence-link';
import { User } from '@/models/user';

export type FubAccessScope = 'referrals' | 'dashboard';
const accessModel = (scope: FubAccessScope) => scope === 'dashboard' ? FubDashboardAccess : IntelligenceAccess;

type StoredFields = {
  _id: Types.ObjectId;
  role?: string | null;
  email?: string | null;
  name?: string | null;
  emailVerified?: Date | null;
  passwordHash?: string | null;
  disabled?: boolean | null;
  active?: boolean | null;
  status?: string | null;
};

type StoredAudit = {
  actorId: Types.ObjectId;
  targetUserId: Types.ObjectId;
  organization: FubOrganization;
  action: 'grant' | 'revoke';
  at: Date;
  before: AccessStateName;
  after: 'granted' | 'revoked';
};

export async function readOwnerUserId(): Promise<string | null> {
  const owner = await AccountOwner.findOne({ key: ACCOUNT_OWNER_KEY }).select('ownerUserId').lean<{ ownerUserId?: Types.ObjectId } | null>();
  return owner?.ownerUserId ? String(owner.ownerUserId) : null;
}

export async function inspectAccountOwner(target: { host: string; databaseName: string } | null) {
  const database = productionDatabaseAllowed(target);
  if (!database.ok) return database;
  const matches = (await findOwnerCandidates()).filter((user) => normalizeEmail(user.email) === OWNER_EMAIL);
  const roles = await User.collection.aggregate<{ _id: string | null; n: number }>([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray();
  return {
    ok: true as const,
    host: target?.host ?? null,
    databaseName: target?.databaseName ?? null,
    matchCount: matches.length,
    matches: matches.map((user) => ({
      id: user.id,
      role: user.role,
      emailVerified: user.emailVerified,
      hasCredentials: user.hasCredentials,
      providers: user.providers,
    })),
    existingOwnerUserId: await readOwnerUserId(),
    accessCount: await IntelligenceAccess.countDocuments({}),
    linkCount: await IntelligenceLink.countDocuments({}),
    roles: roles.map((role) => ({ role: role._id, count: role.n })),
  };
}

export async function bootstrapAccountOwner(input: {
  target: { host: string; databaseName: string } | null;
  expectedUserId: string;
  at: string;
  commit: boolean;
}) {
  const plan = planOwnerBootstrap({
    target: input.target,
    expectedUserId: input.expectedUserId,
    candidates: await findOwnerCandidates(),
    existingOwnerUserId: await readOwnerUserId(),
    at: input.at,
  });
  if (!input.commit || !plan.ok || !plan.changed) return plan;
  try {
    await AccountOwner.create({
      key: ACCOUNT_OWNER_KEY,
      ownerUserId: new Types.ObjectId(input.expectedUserId),
      audit: [
        {
          at: new Date(plan.audit.at),
          action: plan.audit.action,
          actor: plan.audit.actor,
          previousOwnerUserId: null,
          nextOwnerUserId: new Types.ObjectId(plan.audit.nextOwnerUserId),
        },
      ],
    });
    return plan;
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const current = await readOwnerUserId();
    if (current === input.expectedUserId) return { ok: true as const, changed: false as const };
    return { ok: false as const, reason: 'owner_conflict' as const, existingOwnerUserId: current ?? '' };
  }
}

export async function readFubAccessPage(actorUserId: string) {
  const actor = await readStoredFields(actorUserId);
  const owner = await AccountOwner.findOne({ key: ACCOUNT_OWNER_KEY }).lean<{
    ownerUserId?: Types.ObjectId;
    audit?: { at?: Date; action?: string }[];
  } | null>();
  const ownerUserId = owner?.ownerUserId ? String(owner.ownerUserId) : null;
  const allowed = Boolean(actor && ownerUserId === actorUserId && actor.role === 'admin' && storedAccountStatus(actor) === 'active');
  if (!allowed || !ownerUserId) return { ok: false as const, status: 403 as const, reason: 'forbidden' as const };
  const ownerUser = await readStoredFields(ownerUserId);
  const admins = await User.collection
    .find({ role: 'admin' }, { projection: { name: 1, email: 1, role: 1, disabled: 1, active: 1, status: 1 } })
    .sort({ name: 1, email: 1 })
    .limit(100)
    .toArray();
  const grants = await IntelligenceAccess.find({
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
    organization: VERIFIED_FUB_ORGANIZATION,
  })
    .select('userId organization revokedAt audit')
    .lean<Array<{ userId: Types.ObjectId; organization: FubOrganization; revokedAt?: Date | null; audit?: StoredAudit[] }>>();
  const dashboardGrants = await FubDashboardAccess.find({ organization: VERIFIED_FUB_ORGANIZATION, fubAccountId: VERIFIED_FUB_ACCOUNT_ID }).select('userId revokedAt audit').lean<Array<{ userId: Types.ObjectId; revokedAt?: Date | null; audit?: StoredAudit[] }>>();
  const dashboardUsers = new Set(dashboardGrants.filter((grant) => !grant.revokedAt).map((grant) => String(grant.userId)));
  const accessByUser = new Map<string, boolean>();
  for (const admin of admins) accessByUser.set(String(admin._id), false);
  for (const grant of grants) {
    if (grant.revokedAt) continue;
    if (!accessByUser.has(String(grant.userId))) continue;
    accessByUser.set(String(grant.userId), true);
  }
  const names = new Map<string, string>();
  for (const admin of admins) names.set(String(admin._id), displayName(admin));
  const history = [...grants.map((grant) => ({ ...grant, scope: 'referrals' as const })), ...dashboardGrants.map((grant) => ({ ...grant, scope: 'dashboard' as const }))]
    .flatMap((grant) =>
      (grant.audit ?? []).map((entry) => ({
        at: new Date(entry.at).toISOString(),
        scope: grant.scope,
        actorId: String(entry.actorId),
        targetId: String(entry.targetUserId),
        organization: entry.organization,
        action: entry.action,
        before: entry.before,
        after: entry.after,
      })),
    )
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);
  const missingIds = [...new Set(history.flatMap((entry) => [entry.actorId, entry.targetId]).filter((id) => !names.has(id) && Types.ObjectId.isValid(id)))];
  if (missingIds.length > 0) {
    const extra = await User.collection
      .find({ _id: { $in: missingIds.map((id) => new Types.ObjectId(id)) } }, { projection: { name: 1, email: 1 } })
      .toArray();
    for (const user of extra) names.set(String(user._id), displayName(user));
  }
  const assignedAt = owner?.audit?.find((entry) => entry.action === 'assign')?.at;
  return {
    ok: true as const,
    owner: {
      id: ownerUserId,
      name: ownerUser ? displayName(ownerUser) : 'Account owner',
      email: typeof ownerUser?.email === 'string' ? ownerUser.email : '',
      assignedAt: assignedAt ? new Date(assignedAt).toISOString() : null,
    },
    connection: fubConnectionSummary(process.env.REFERRIO_FUB_ACCOUNT_ID ?? ''),
    admins: admins.map((admin) => {
      const id = String(admin._id);
      const access = accessByUser.get(id) ?? false;
      const isOwner = id === ownerUserId;
      return {
        id,
        name: displayName(admin),
        email: typeof admin.email === 'string' ? admin.email : '',
        isOwner,
        disabled: storedAccountStatus(admin as StoredFields) !== 'active',
        aha: isOwner || access,
        dashboard: isOwner || dashboardUsers.has(id),
      };
    }),
    history: history.map((entry) => ({
      at: entry.at,
      scope: entry.scope,
      actorName: names.get(entry.actorId) ?? 'Administrator',
      targetName: names.get(entry.targetId) ?? 'Administrator',
      organization: entry.organization,
      action: entry.action,
      before: entry.before,
      after: entry.after,
    })),
  };
}

export async function changeFubAccess(input: { actorUserId: string; targetUserId: string; organization: FubOrganization; access: boolean; at: string; scope?: FubAccessScope }) {
  const actor = await readStoredFields(input.actorUserId);
  const ownerUserId = await readOwnerUserId();
  const actorIsOwner = Boolean(actor && ownerUserId === input.actorUserId && actor.role === 'admin' && storedAccountStatus(actor) === 'active');
  const target = await readStoredFields(input.targetUserId);
  const scope = input.scope ?? 'referrals';
  const current = await readAccessState(input.organization, input.targetUserId, scope);
  const plan = planAccessChange({
    actorIsOwner,
    actorUserId: input.actorUserId,
    ownerUserId,
    target: target ? { id: String(target._id), role: target.role ?? null, status: storedAccountStatus(target) } : null,
    organization: input.organization,
    configuredAccountId: process.env.REFERRIO_FUB_ACCOUNT_ID ?? '',
    requestedAccess: input.access,
    current,
    at: input.at,
  });
  if (!plan.ok || !plan.changed) return plan;
  const written = await writeAccessChange(plan.before, plan.next, plan.audit, scope);
  if (!written.ok || !written.changed) return written;
  if (plan.dropCache) clearIntelligenceCache();
  return plan;
}

async function findOwnerCandidates(): Promise<IdentityUser[]> {
  const expression = `^${OWNER_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const users = await User.collection
    .find({ email: { $regex: expression, $options: 'i' } }, { projection: { email: 1, role: 1, emailVerified: 1, passwordHash: 1 } })
    .toArray();
  const ids = users.map((user) => user._id);
  const accounts = ids.length
    ? await User.db.collection('accounts').find({ userId: { $in: ids } }, { projection: { userId: 1, provider: 1 } }).toArray()
    : [];
  return users.map((user) => ({
    id: String(user._id),
    email: typeof user.email === 'string' ? user.email : '',
    role: typeof user.role === 'string' ? user.role : null,
    emailVerified: Boolean(user.emailVerified),
    hasCredentials: typeof user.passwordHash === 'string' && user.passwordHash.length > 0,
    providers: accounts
      .filter((account) => String(account.userId) === String(user._id))
      .map((account) => (typeof account.provider === 'string' ? account.provider : 'unknown')),
  }));
}

async function readStoredFields(userId: string): Promise<StoredFields | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const doc = await User.collection.findOne(
    { _id: new Types.ObjectId(userId) },
    { projection: { role: 1, email: 1, name: 1, emailVerified: 1, disabled: 1, active: 1, status: 1 } },
  );
  return doc as StoredFields | null;
}

async function readAccessState(organization: FubOrganization, userId: string, scope: FubAccessScope): Promise<AccessStateName> {
  if (!Types.ObjectId.isValid(userId)) return 'absent';
  const doc = await accessModel(scope).findOne({
    organization,
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
    userId: new Types.ObjectId(userId),
  })
    .select('revokedAt')
    .lean<{ revokedAt?: Date | null } | null>();
  return accessState(doc);
}

async function writeAccessChange(before: AccessStateName, next: 'granted' | 'revoked', audit: AccessAuditEntry, scope: FubAccessScope) {
  const userId = new Types.ObjectId(audit.targetUserId);
  const identity = { organization: audit.organization, fubAccountId: VERIFIED_FUB_ACCOUNT_ID, userId };
  const auditDoc = {
    actorId: new Types.ObjectId(audit.actorId),
    targetUserId: userId,
    organization: audit.organization,
    fubAccountId: audit.fubAccountId,
    action: audit.action,
    at: new Date(audit.at),
    before: audit.before,
    after: audit.after,
  };
  if (before === 'absent' && next === 'granted') {
    try {
      await accessModel(scope).create({
        ...identity,
        createdBy: new Types.ObjectId(audit.actorId),
        revokedAt: null,
        audit: [auditDoc],
      });
      return { ok: true as const, changed: true as const };
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      return raced(identity, next, scope);
    }
  }
  const stateFilter = before === 'revoked' ? { revokedAt: { $ne: null } } : { $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] };
  const updated = await accessModel(scope).updateOne(
    { ...identity, ...stateFilter },
    { $set: { revokedAt: next === 'granted' ? null : new Date(audit.at) }, $push: { audit: auditDoc } },
  );
  if (updated.matchedCount === 1) return { ok: true as const, changed: true as const };
  return raced(identity, next, scope);
}

async function raced(identity: { organization: FubOrganization; fubAccountId: string; userId: Types.ObjectId }, next: 'granted' | 'revoked', scope: FubAccessScope) {
  const actual = accessState(await accessModel(scope).findOne(identity).select('revokedAt').lean<{ revokedAt?: Date | null } | null>());
  const race = accessRaceResult(actual, next);
  if ('conflict' in race) return { ok: false as const, status: 409 as const, reason: 'conflict' as const };
  return { ok: true as const, changed: false as const, dropCache: false as const };
}

function accessState(doc: { revokedAt?: Date | null } | null): AccessStateName {
  if (!doc) return 'absent';
  return doc.revokedAt ? 'revoked' : 'granted';
}

function displayName(user: object): string {
  const record = user as { name?: unknown; email?: unknown };
  if (typeof record.name === 'string' && record.name.trim()) return record.name.trim();
  if (typeof record.email === 'string' && record.email.trim()) return record.email.trim();
  return 'Administrator';
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}


/** Every dashboard read rechecks the stored role and separate dashboard grant. */
export async function canViewFubDashboard(userId: string): Promise<boolean> {
  const user = await readStoredFields(userId);
  if (!user || user.role !== 'admin' || storedAccountStatus(user) !== 'active') return false;
  if (await readOwnerUserId() === userId) return true;
  return await readAccessState(VERIFIED_FUB_ORGANIZATION, userId, 'dashboard') === 'granted';
}
