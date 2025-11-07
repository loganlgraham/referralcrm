import { Session } from 'next-auth';

export type Role = 'admin' | 'manager' | 'mc' | 'agent' | 'viewer';

const rolePriority: Record<Role, number> = {
  admin: 5,
  manager: 4,
  mc: 3,
  agent: 2,
  viewer: 1
};

export function hasRole(session: Session | null, allowed: Role[] = []): boolean {
  if (!session?.user?.role) return false;
  if (allowed.length === 0) return true;
  return allowed.includes(session.user.role as Role);
}

type ReferralAccess = {
  assignedAgent?: unknown;
  lender?: unknown;
  org: string;
};

function extractId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    const obj = value as Record<string, any> | null;
    if (!obj) return undefined;
    const direct = obj._id ?? obj.id ?? obj.$id ?? obj.valueOf?.();
    if (direct) {
      if (typeof direct === 'string') return direct;
      if (typeof direct === 'number' || typeof direct === 'bigint') return direct.toString();
      if (typeof direct === 'object' && direct !== null && 'toString' in direct) {
        const result = (direct as { toString: () => string }).toString();
        if (result && result !== '[object Object]') return result;
      }
    }
    if ('toString' in obj && typeof obj.toString === 'function') {
      const fallback = obj.toString();
      if (fallback && fallback !== '[object Object]') {
        return fallback;
      }
    }
  }
  return undefined;
}

function extractUserId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, any> | null;
  if (!obj) return undefined;
  const candidate = obj.userId ?? obj.user?.id ?? obj.user?.sub ?? null;
  if (!candidate) return undefined;
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate === 'number' || typeof candidate === 'bigint') return candidate.toString();
  if (typeof candidate === 'object' && candidate !== null && 'toString' in candidate) {
    const valueAsString = (candidate as { toString: () => string }).toString();
    if (valueAsString && valueAsString !== '[object Object]') {
      return valueAsString;
    }
  }
  return undefined;
}

export function canManageReferral(session: Session | null, referral: ReferralAccess): boolean {
  if (!session?.user) return false;
  const role = session.user.role as Role;
  if (role === 'admin' || role === 'manager') return true;

  const assignedAgentUserId = extractUserId(referral.assignedAgent);
  const assignedAgentId = extractId(referral.assignedAgent);
  const lenderUserId = extractUserId(referral.lender);
  const lenderId = extractId(referral.lender);

  if (role === 'mc') {
    return Boolean(session.user.id && session.user.id === (lenderUserId ?? lenderId));
  }
  if (role === 'agent') {
    return Boolean(session.user.id && session.user.id === (assignedAgentUserId ?? assignedAgentId));
  }
  return false;
}

export function compareRoles(a: Role, b: Role) {
  return rolePriority[a] - rolePriority[b];
}

export function canViewReferral(session: Session | null, referral: ReferralAccess): boolean {
  if (!session?.user) return false;
  const role = session.user.role as Role;
  if (role === 'admin' || role === 'manager' || role === 'viewer') return true;

  const assignedAgentUserId = extractUserId(referral.assignedAgent);
  const assignedAgentId = extractId(referral.assignedAgent);
  const lenderUserId = extractUserId(referral.lender);
  const lenderId = extractId(referral.lender);

  if (role === 'mc') {
    return Boolean(session.user.id && session.user.id === (lenderUserId ?? lenderId));
  }
  if (role === 'agent') {
    return Boolean(session.user.id && session.user.id === (assignedAgentUserId ?? assignedAgentId));
  }
  return false;
}
