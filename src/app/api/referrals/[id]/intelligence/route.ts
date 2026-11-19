import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { VERIFIED_FUB_ACCOUNT_ID, resolveViewerAuthority } from '@/lib/intelligence/access-control';
import { dropIntelligenceCacheForParticipant, fetchCustomerIntelligence, trustedIntelligenceUrl } from '@/lib/intelligence/remote';
import { deniedPanel, panelFromRead, savedPanel } from '@/lib/intelligence/panel-response';
import { agentsDiffer, authorizeIntelligencePanel, participantBelongsToReferral, sameOriginRequest, type IntelligenceOrg } from '@/lib/intelligence/panel';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { canViewReferral } from '@/lib/rbac';
import { readOwnerUserId } from '@/lib/server/fub-access';
import { readAccessGrant, readAgentLink, readCustomerLink, writeAgentLink, writeCustomerLink } from '@/lib/server/intelligence-links';
import { User } from '@/models/user';

interface RouteContext {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

const REFERRAL_PARTICIPANTS = ['borrower'] as const;

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!allowedMutation(request)) return json(deniedPanel(), { status: 403 });
  const loaded = await loadAuthorized(context.params.id);
  if (!loaded.ok) {
    if (loaded.status === 401 || loaded.status === 403) return json(deniedPanel(), { status: loaded.status });
    return json(panelFromRead({ participantKey: 'borrower', personId: null, referrioAgent: null, remote: { state: 'unavailable', reason: loaded.reason }, agentsDiffer: false }), { status: loaded.status });
  }
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
    return json(panelFromRead({
      participantKey: 'borrower',
      personId: null,
      referrioAgent: loaded.referrioAgent,
      remote: null,
      agentsDiffer: false,
    }));
  }
  if (!loaded.secret || !loaded.url) {
    logRead({ referralId: loaded.referralId, personId: link.fubPersonId, outcome: 'unavailable', reason: 'not_configured' });
    return json(panelFromRead({
      participantKey: 'borrower',
      personId: link.fubPersonId,
      referrioAgent: loaded.referrioAgent,
      remote: { state: 'unavailable', reason: 'not_configured' },
      agentsDiffer: false,
    }));
  }
  const remote = await fetchCustomerIntelligence({
    organization: loaded.organization,
    fubAccountId: loaded.accountId,
    referralId: loaded.referralId,
    participantKey: 'borrower',
    personId: link.fubPersonId,
    secret: loaded.secret,
    url: loaded.url,
    fresh: request.nextUrl.searchParams.get('retry') === '1',
  });
  if (remote.state === 'unavailable') {
    logRead({
      referralId: loaded.referralId,
      personId: link.fubPersonId,
      outcome: remote.state,
      reason: remote.reason,
      upstreamStatus: remote.upstreamStatus,
    });
  } else if (remote.state === 'not_found') {
    logRead({ referralId: loaded.referralId, personId: link.fubPersonId, outcome: remote.state, reason: 'not_found' });
  }
  const customer = remote.state === 'ready' || remote.state === 'incomplete' || remote.state === 'no_records' ? remote : null;
  const differ = customer
    ? agentsDiffer(loaded.referrioAgent, customer.fubAssignedUser?.name ?? null, agentLink?.fubUserId ?? null, customer.fubAssignedUser?.id ?? null)
    : false;
  return json(panelFromRead({
    participantKey: 'borrower',
    personId: link.fubPersonId,
    referrioAgent: loaded.referrioAgent,
    remote,
    agentsDiffer: differ,
  }));
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!allowedMutation(request)) return json(deniedPanel(), { status: 403 });
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
  }
  const loaded = await loadAuthorized(context.params.id);
  if (!loaded.ok) {
    if (loaded.status === 401 || loaded.status === 403) return json(deniedPanel(), { status: loaded.status });
    return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: loaded.status });
  }
  const body = await request.json().catch(() => null) as { participantKey?: unknown; personId?: unknown; agentFubUserId?: unknown } | null;
  if (!body) return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
  const at = new Date().toISOString();
  if (body.agentFubUserId !== undefined) {
    if (!loaded.agentId) return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
    const agent = await writeAgentLink({
      organization: loaded.organization,
      fubAccountId: loaded.accountId,
      agentId: loaded.agentId,
      fubUserId: body.agentFubUserId,
      actorId: loaded.userId,
      at,
    });
    if (!agent.ok) return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
    return json({ officialScoring: false, access: 'allowed', saved: true, link: null, activity: { status: 'not_requested' }, fubUserId: agent.link.fubUserId });
  }
  const participantKey = typeof body.participantKey === 'string' ? body.participantKey : 'borrower';
  if (!participantBelongsToReferral(participantKey, REFERRAL_PARTICIPANTS)) {
    return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
  }
  const saved = await writeCustomerLink({
    organization: loaded.organization,
    fubAccountId: loaded.accountId,
    referralId: loaded.referralId,
    participantKey,
    personId: body.personId ?? null,
    actorId: loaded.userId,
    at,
  });
  if (!saved.ok) return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
  dropIntelligenceCacheForParticipant(loaded.organization, loaded.accountId, loaded.referralId, saved.link.participantKey);
  return json(savedPanel(saved.link.fubPersonId, saved.link.participantKey));
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
  const stored = userId && Types.ObjectId.isValid(userId)
    ? await User.collection.findOne(
        { _id: new Types.ObjectId(userId) },
        { projection: { role: 1, disabled: 1, active: 1, status: 1 } },
      )
    : null;
  const viewer = resolveViewerAuthority({
    sessionUserId: userId,
    sessionRole: session?.user?.role ?? null,
    storedUser: stored
      ? {
          id: String(stored._id),
          role: typeof stored.role === 'string' ? stored.role : null,
          disabled: stored.disabled === true,
          active: typeof stored.active === 'boolean' ? stored.active : null,
          status: typeof stored.status === 'string' ? stored.status : null,
        }
      : null,
    ownerUserId: await readOwnerUserId(),
  });
  const grant = viewer.userId ? await readAccessGrant({ organization, fubAccountId: accountId, userId: viewer.userId }) : null;
  const access = authorizeIntelligencePanel({
    userId: viewer.userId,
    role: viewer.role,
    storedRole: viewer.role,
    accountStatus: viewer.status,
    isOwner: viewer.isOwner,
    canViewReferral: canView,
    referralOrg: organization,
    grant,
    configuredAccountId: accountId,
    verifiedAccountId: VERIFIED_FUB_ACCOUNT_ID,
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
    userId: viewer.userId ?? '',
    agentId: agent?._id ? String(agent._id) : null,
    referrioAgent: agent?.name ?? null,
    secret: process.env.REFERRIO_INTEGRATION_SECRET ?? '',
    url: trustedIntelligenceUrl(process.env.REFERRIO_INTELLIGENCE_URL ?? '') ?? '',
  };
}

function allowedMutation(request: NextRequest): boolean {
  return sameOriginRequest({
    requestOrigin: request.headers.get('origin'),
    pageOrigin: request.nextUrl.origin,
    fetchSite: request.headers.get('sec-fetch-site'),
  });
}

function logRead(entry: { referralId: string; personId: number | null; outcome: string; reason?: string; upstreamStatus?: number }): void {
  console.info(JSON.stringify({ source: 'referrio-intelligence', ...entry }));
}

function json(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}
