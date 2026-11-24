import { createHmac } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/functions/oidc';

export type RemoteCustomer = {
  state: 'ready' | 'incomplete' | 'no_records';
  officialScoring: false;
  personId: number;
  personStage: string | null;
  latest: { channel: string; direction: string; occurredAt: string; displayTime: string } | null;
  followUp: { status: string; nextAction: string; detail: string } | null;
  fubAssignedUser: { id: number; name: string } | null;
  projectedClosings: { dealId: number; stage: string | null; display: string; dateOnly: boolean; projection: true }[];
  freshness: { readAt: string; note: string };
  coverageDetail?: string | null;
  detailPath: string | null;
};

export type RemoteResult =
  | { state: 'unavailable'; reason: string; upstreamStatus?: number }
  | { state: 'not_found'; personId: number }
  | RemoteCustomer;

type CacheEntry = { at: number; value: RemoteCustomer };

const cache = new Map<string, CacheEntry>();
const CACHE_MS = 45_000;

export function clearIntelligenceCache(): void {
  cache.clear();
}

export function dropIntelligenceCacheForParticipant(organization: string, fubAccountId: string, referralId: string, participantKey: string): void {
  const prefix = `${organization}:${fubAccountId}:${referralId}:${participantKey}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function trustedIntelligenceUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/api/integration/referrio/customer') return null;
  return url.toString();
}

export async function fetchCustomerIntelligence(input: {
  organization: string;
  fubAccountId: string;
  referralId: string;
  participantKey: string;
  personId: number;
  secret: string;
  url: string;
  fetchImpl?: typeof fetch;
  now?: number;
  timeoutMs?: number;
  protectionToken?: string | null;
  fresh?: boolean;
}): Promise<RemoteResult> {
  const destination = trustedIntelligenceUrl(input.url);
  if (!destination) return { state: 'unavailable', reason: 'not_configured' };
  const key = `${input.organization}:${input.fubAccountId}:${input.referralId}:${input.participantKey}:${input.personId}`;
  const hit = cache.get(key);
  const nowMs = input.now ?? Date.now();
  if (!input.fresh && hit && nowMs - hit.at < CACHE_MS && hit.value.personId === input.personId) return hit.value;
  const exp = Math.floor(nowMs / 1000) + 60;
  const body = {
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    referralId: input.referralId,
    participantKey: input.participantKey,
    personId: input.personId,
    exp,
  };
  const signature = createHmac('sha256', input.secret).update(canonical(body)).digest('hex');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-referrio-signature': signature,
  };
  const protectionToken = await resolveProtectionToken(input.protectionToken);
  if (protectionToken) headers['x-vercel-trusted-oidc-idp-token'] = protectionToken;
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(destination, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortAfter(input.timeoutMs ?? 8_000),
      cache: 'no-store',
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      return { state: 'unavailable', reason: 'unavailable', upstreamStatus: response.status };
    }
    const payload = await response.json().catch(() => null) as (Omit<Partial<RemoteCustomer>, 'state'> & { state?: 'ready' | 'incomplete' | 'no_records' | 'unavailable' | 'not_found'; reason?: unknown }) | null;
    if (!response.ok) {
      return {
        state: 'unavailable',
        reason: upstreamReason(payload, response.status),
        upstreamStatus: response.status,
      };
    }
    if (!payload || payload.personId !== input.personId || payload.officialScoring !== false) {
      return { state: 'unavailable', reason: 'tampered_person', upstreamStatus: response.status };
    }
    if (payload.state === 'not_found') return { state: 'not_found', personId: input.personId };
    if (payload.state !== 'ready' && payload.state !== 'incomplete' && payload.state !== 'no_records' && payload.state !== 'unavailable') {
      return { state: 'unavailable', reason: 'malformed', upstreamStatus: response.status };
    }
    if (payload.state === 'unavailable') return { state: 'unavailable', reason: 'unavailable', upstreamStatus: response.status };
    const value: RemoteCustomer = {
      state: payload.state,
      officialScoring: false,
      personId: input.personId,
      personStage: typeof payload.personStage === 'string' ? payload.personStage.trim() || null : null,
      latest: payload.latest ?? null,
      followUp: payload.followUp ?? null,
      fubAssignedUser: payload.fubAssignedUser ?? null,
      projectedClosings: payload.projectedClosings ?? [],
      freshness: payload.freshness ?? { readAt: new Date(nowMs).toISOString(), note: 'Stored read.' },
      coverageDetail: typeof payload.coverageDetail === 'string' ? payload.coverageDetail : null,
      detailPath: payload.detailPath ?? null,
    };
    cache.set(key, { at: nowMs, value });
    return value;
  } catch {
    return { state: 'unavailable', reason: 'timeout' };
  }
}

export function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(ms);
    } catch {
      return new AbortController().signal;
    }
  }
  return new AbortController().signal;
}

export async function resolveProtectionToken(override: string | null | undefined): Promise<string | null> {
  if (override !== undefined) return override || null;
  try {
    const token = await getVercelOidcToken();
    return token || null;
  } catch {
    return null;
  }
}

function upstreamReason(payload: { reason?: unknown } | null, status: number): string {
  if (typeof payload?.reason === 'string' && payload.reason.length > 0 && payload.reason.length < 80) return payload.reason;
  if (status === 401 || status === 403) return 'deployment_protection';
  return 'unavailable';
}

function canonical(body: { organization: string; fubAccountId: string; referralId: string; participantKey: string; personId: number; exp: number }): string {
  return `organization=${body.organization}\nfubAccountId=${body.fubAccountId}\nreferralId=${body.referralId}\nparticipantKey=${body.participantKey}\npersonId=${body.personId}\nexp=${body.exp}`;
}
