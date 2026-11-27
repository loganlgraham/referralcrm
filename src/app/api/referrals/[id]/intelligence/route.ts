import { allowedMutation, loadAuthorized } from '@/lib/server/referral-fub-context';
import { liveFubEnabled, getFubAgentChoices } from '@/lib/server/live-fub-handoff';
import { NextRequest, NextResponse } from 'next/server';
import { dropIntelligenceCacheForParticipant, fetchCustomerIntelligence } from '@/lib/intelligence/remote';
import { deniedPanel, panelFromRead, savedPanel } from '@/lib/intelligence/panel-response';
import { agentsDiffer, participantBelongsToReferral } from '@/lib/intelligence/panel';
import { readAgentLink, readCustomerLink, writeAgentLink, writeCustomerLink } from '@/lib/server/intelligence-links';

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
      remote: loaded.configured ? null : { state: 'unavailable', reason: 'not_configured' },
      agentsDiffer: false,
    }));
  }
  if (!loaded.configured || !loaded.secret || !loaded.url) {
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
  const body = await request.json().catch(() => null) as { participantKey?: unknown; personId?: unknown; agentFubUserId?: unknown; expectedAgentId?: unknown } | null;
  if (!body) return json({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, { status: 400 });
  const at = new Date().toISOString();
  if (body.agentFubUserId !== undefined) {
    if (liveFubEnabled() && body.agentFubUserId !== null) {
      if (body.expectedAgentId !== loaded.agentId) return json({error:'The selected agent changed. Refresh the referral.'}, {status:409});
      const directory = await getFubAgentChoices().catch(() => null);
      if (!directory) return json({error:'The Follow Up Boss directory is unavailable.'}, {status:503});
      if (!directory.some(user => user.id === body.agentFubUserId)) return json({error:'Choose a user from the AHA directory.'}, {status:422});
    }
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

function logRead(entry: { referralId: string; personId: number | null; outcome: string; reason?: string; upstreamStatus?: number }): void {
  console.info(JSON.stringify({ source: 'referrio-intelligence', ...entry }));
}

function json(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}
