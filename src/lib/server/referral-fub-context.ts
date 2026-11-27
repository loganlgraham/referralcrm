import type { NextRequest } from 'next/server';
import { trustedIntelligenceUrl } from '@/lib/intelligence/remote';
import { sameOriginRequest, type IntelligenceOrg } from '@/lib/intelligence/panel';
import { referralWorkflowRoute, routingAgent, type RoutingSource } from '@/lib/referral-routing';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { canViewReferral } from '@/lib/rbac';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { authorizeFubViewer } from '@/lib/server/intelligence-viewer';

export async function loadAuthorized(referralId: string): Promise<
  | { ok: false; status: number; reason: string }
  | {
      ok: true;
      organization: IntelligenceOrg;
      accountId: string;
      configured: boolean;
      isAdmin: boolean;
      referralId: string;
      userId: string;
      agentId: string | null;
      referrioAgent: string | null;
      secret: string;
      url: string;
    }
> {
  const session = await getCurrentSession();
  if (!Types.ObjectId.isValid(referralId)) return { ok: false, status: 404, reason: 'referral' };
  await connectMongo();
  const referral = await Referral.findById(referralId).select('org origin clientType ahaBucket inboundEmail assignedAgent buySideAgent sellSideAgent deletedAt').populate('assignedAgent buySideAgent sellSideAgent', 'name ahaDesignation').lean<RoutingSource & {
    org?: string;
    deletedAt?: Date;
    sellSideAgent?: { _id?: Types.ObjectId; name?: string } | Types.ObjectId | null;
    buySideAgent?: { _id?: Types.ObjectId; name?: string } | Types.ObjectId | null;
    assignedAgent?: { _id?: Types.ObjectId; name?: string } | Types.ObjectId | null;
  } | null>();
  if (!referral || referral.deletedAt) return { ok: false, status: 404, reason: 'referral' };
  const organization: IntelligenceOrg = referralWorkflowRoute(referral) ? 'AHA' : 'AFC';
  // Fall back to the verified AHA account so a missing preview env still finds saved links.
  const configuredAccountId = process.env.REFERRIO_FUB_ACCOUNT_ID ?? '';
  const accountId = configuredAccountId || VERIFIED_FUB_ACCOUNT_ID;
  const canView = canViewReferral(session, {
    org: organization,
    assignedAgent: referral.assignedAgent ?? undefined,
  });
  const { access, userId, role } = await authorizeFubViewer({ session, organization, accountId, canViewReferral: canView });
  if (!access.ok) return { ok: false, status: access.status, reason: access.reason };
  const selectedAgent = routingAgent(referral);
  const agent = selectedAgent && typeof selectedAgent === 'object' && 'name' in selectedAgent ? selectedAgent : null;
  const secret = process.env.REFERRIO_INTEGRATION_SECRET ?? '';
  const url = trustedIntelligenceUrl(process.env.REFERRIO_INTELLIGENCE_URL ?? '') ?? '';
  return {
    ok: true,
    organization,
    accountId,
    isAdmin: role === 'admin',
    configured: Boolean(configuredAccountId && secret && url),
    referralId,
    userId: userId ?? '',
    agentId: agent?._id ? String(agent._id) : null,
    referrioAgent: agent?.name ?? null,
    secret,
    url,
  };
}

export function allowedMutation(request: NextRequest): boolean {
  return sameOriginRequest({
    requestOrigin: request.headers.get('origin'),
    pageOrigin: request.nextUrl.origin,
    fetchSite: request.headers.get('sec-fetch-site'),
  });
}
