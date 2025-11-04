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

export function canManageReferral(session: Session | null, referral: { assignedAgent?: string; lender?: string; org: string }): boolean {
  if (!session?.user) return false;
  const role = session.user.role as Role;
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'mc') {
    return Boolean(session.user.id && referral?.lender?.toString?.() === session.user.id);
  }
  if (role === 'agent') {
    return Boolean(session.user.id && referral.assignedAgent?.toString?.() === session.user.id);
  }
  return false;
}

export function compareRoles(a: Role, b: Role) {
  return rolePriority[a] - rolePriority[b];
}

export function canViewReferral(session: Session | null, referral: { assignedAgent?: string; lender?: string; org: string }): boolean {
  if (!session?.user) return false;
  const role = session.user.role as Role;
  if (role === 'admin' || role === 'manager' || role === 'viewer') return true;
  if (role === 'mc') {
    return Boolean(session.user.id && referral?.lender?.toString?.() === session.user.id);
  }
  if (role === 'agent') {
    return Boolean(session.user.id && referral.assignedAgent?.toString?.() === session.user.id);
  }
  return false;
}
