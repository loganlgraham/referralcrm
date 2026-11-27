import { Types } from 'mongoose';
import type { Session } from 'next-auth';
import { VERIFIED_FUB_ACCOUNT_ID, resolveViewerAuthority } from '@/lib/intelligence/access-control';
import { authorizeIntelligencePanel, type IntelligenceOrg, type IntelligenceRole, type PanelAccess } from '@/lib/intelligence/panel';
import { readOwnerUserId } from '@/lib/server/fub-access';
import { readAccessGrant } from '@/lib/server/intelligence-links';
import { User } from '@/models/user';

/** Stored role, owner, and access grant decide Follow Up Boss visibility; the session role does not. */
export async function authorizeFubViewer(input: {
  session: Session | null;
  organization: IntelligenceOrg;
  accountId: string;
  canViewReferral: boolean;
}): Promise<{ access: PanelAccess; userId: string | null; role: IntelligenceRole }> {
  const userId = input.session?.user?.id ?? null;
  const [stored, ownerUserId] = await Promise.all([
    userId && Types.ObjectId.isValid(userId)
    ? User.collection.findOne(
        { _id: new Types.ObjectId(userId) },
        { projection: { role: 1, disabled: 1, active: 1, status: 1 } },
      )
    : null,
    readOwnerUserId(),
  ]);
  const viewer = resolveViewerAuthority({
    sessionUserId: userId,
    sessionRole: input.session?.user?.role ?? null,
    storedUser: stored
      ? {
          id: String(stored._id),
          role: typeof stored.role === 'string' ? stored.role : null,
          disabled: stored.disabled === true,
          active: typeof stored.active === 'boolean' ? stored.active : null,
          status: typeof stored.status === 'string' ? stored.status : null,
        }
      : null,
    ownerUserId,
  });
  const grant = viewer.userId ? await readAccessGrant({ organization: input.organization, fubAccountId: input.accountId, userId: viewer.userId }) : null;
  const access = authorizeIntelligencePanel({
    userId: viewer.userId,
    role: viewer.role,
    storedRole: viewer.role,
    accountStatus: viewer.status,
    isOwner: viewer.isOwner,
    canViewReferral: input.canViewReferral,
    referralOrg: input.organization,
    grant,
    configuredAccountId: input.accountId,
    verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
  });
  return { access, userId: viewer.userId, role: viewer.role };
}
