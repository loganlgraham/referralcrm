import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { fetchCustomerIntelligence } from '@/lib/intelligence/remote';
import { agentsDiffer, authorizeIntelligencePanel, type IntelligenceOrg } from '@/lib/intelligence/panel';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { canViewReferral } from '@/lib/rbac';
import { readAccessGrant, readAgentLink, readCustomerLink, writeAgentLink, writeCustomerLink } from '@/lib/server/intelligence-links';

interface RouteContext {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const loaded = await loadAuthorized(context.params.id);
  if (!loaded.ok) return NextResponse.json({ state: 'unavailable', reason: loaded.reason }, { status: loaded.status });
  const link = await readCustomerLink({
    organization: loaded.organization,
    fubAccountId: loaded.accountId,
    referralId: loaded.referralId,
    participantKey: 'borrower',
  });
  const agentLink = loaded.agentId
    ? await readAgentLink({ organization: loaded.organization, fubAccountId: loaded.accountId, agentId: loaded.agentId })
    : null;
  if (!link?.fubPersonId) {
    return NextResponse.json({
      state: 'unlinked',
      participantKey: 'borrower',
      referrioAgent: loaded.referrioAgent,
      officialScoring: false,
    });
  }
  if (!loaded.secret || !loaded.url) {
    return NextResponse.json({ state: 'unavailable', reason: 'not_configured', referrioAgent: loaded.referrioAgent, officialScoring: false });
  }
  const remote = await fetchCustomerIntelligence({
    organization: loaded.organization,
    fubAccountId: loaded.accountId,
    referralId: loaded.referralId,
    participantKey: 'borrower',
    personId: link.fubPersonId,
    secret: loaded.secret,
    url: loaded.url,
  });
  if (remote.state === 'unavailable') {
    return NextResponse.json({ ...remote, referrioAgent: loaded.referrioAgent, officialScoring: false });
  }
  const differ = agentsDiffer(loaded.referrioAgent, remote.fubAssignedUser?.name ?? null, agentLink?.fubUserId ?? null, remote.fubAssignedUser?.id ?? null);
  return NextResponse.json({
    ...remote,
    referrioAgent: loaded.referrioAgent,
    agentsDiffer: differ,
    detailHref: remote.detailPath && loaded.origin ? `${loaded.origin}${remote.detailPath}` : null,
    officialScoring: false,
  });
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const loaded = await loadAuthorized(context.params.id);
  if (!loaded.ok) return NextResponse.json({ state: 'unavailable', reason: loaded.reason }, { status: loaded.status });
  const body = await request.json().catch(() => null) as { participantKey?: unknown; personId?: unknown; agentFubUserId?: unknown } | null;
  if (!body) return NextResponse.json({ state: 'unavailable', reason: 'malformed' }, { status: 400 });
  const at = new Date().toISOString();
  if (body.agentFubUserId !== undefined) {
    if (!loaded.agentId) return NextResponse.json({ state: 'unavailable', reason: 'agent' }, { status: 400 });
    const agent = await writeAgentLink({
      organization: loaded.organization,
      fubAccountId: loaded.accountId,
      agentId: loaded.agentId,
      fubUserId: body.agentFubUserId,
      actorId: loaded.userId,
      at,
    });
    if (!agent.ok) return NextResponse.json({ state: 'unavailable', reason: agent.reason }, { status: 400 });
    return NextResponse.json({ state: 'linked', kind: 'agent', fubUserId: agent.link.fubUserId, officialScoring: false });
  }
  const saved = await writeCustomerLink({
    organization: loaded.organization,
    fubAccountId: loaded.accountId,
    referralId: loaded.referralId,
    participantKey: body.participantKey ?? 'borrower',
    personId: body.personId ?? null,
    actorId: loaded.userId,
    at,
  });
  if (!saved.ok) return NextResponse.json({ state: 'unavailable', reason: saved.reason }, { status: 400 });
  return NextResponse.json({
    state: saved.link.fubPersonId ? 'linked' : 'unlinked',
    participantKey: saved.link.participantKey,
    personId: saved.link.fubPersonId,
    officialScoring: false,
  });
}

async function loadAuthorized(referralId: string): Promise<
  | { ok: false; status: number; reason: string }
  | {
      ok: true;
      organization: IntelligenceOrg;
      accountId: string;
      referralId: string;
      userId: string;
      agentId: string | null;
      referrioAgent: string | null;
      secret: string;
      url: string;
      origin: string;
    }
> {
  const session = await getCurrentSession();
  if (!Types.ObjectId.isValid(referralId)) return { ok: false, status: 404, reason: 'referral' };
  await connectMongo();
  const referral = await Referral.findById(referralId).select('org assignedAgent').populate('assignedAgent', 'name').lean<{
    org?: string;
    assignedAgent?: { _id?: Types.ObjectId; name?: string } | Types.ObjectId | null;
  } | null>();
  if (!referral) return { ok: false, status: 404, reason: 'referral' };
  const organization = referral.org === 'AHA' || referral.org === 'AFC' ? referral.org : null;
  const accountId = process.env.REFERRIO_FUB_ACCOUNT_ID ?? '';
  if (!organization || !accountId) return { ok: false, status: 503, reason: 'not_configured' };
  const canView = canViewReferral(session, {
    org: organization,
    assignedAgent: referral.assignedAgent ?? undefined,
  });
  const userId = session?.user?.id ?? null;
  const grant = userId ? await readAccessGrant({ organization, fubAccountId: accountId, userId }) : null;
  const access = authorizeIntelligencePanel({
    userId,
    role: session?.user?.role ?? null,
    canViewReferral: canView,
    referralOrg: organization,
    grant,
    configuredAccountId: accountId,
  });
  if (!access.ok) return { ok: false, status: access.status, reason: access.reason };
  const agent = referral.assignedAgent && typeof referral.assignedAgent === 'object' && 'name' in referral.assignedAgent
    ? referral.assignedAgent
    : null;
  return {
    ok: true,
    organization,
    accountId,
    referralId,
    userId: userId ?? '',
    agentId: agent?._id ? String(agent._id) : null,
    referrioAgent: agent?.name ?? null,
    secret: process.env.REFERRIO_INTEGRATION_SECRET ?? '',
    url: process.env.REFERRIO_INTELLIGENCE_URL ?? '',
    origin: process.env.INTELLIGENCE_APP_ORIGIN ?? '',
  };
}
