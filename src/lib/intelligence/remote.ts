import { createHmac } from 'node:crypto';

export type RemoteCustomer = {
  state: 'ready' | 'incomplete' | 'unavailable' | 'no_records';
  officialScoring: false;
  personId: number;
  latest: { channel: string; direction: string; occurredAt: string; displayTime: string } | null;
  followUp: { status: string; nextAction: string; detail: string } | null;
  fubAssignedUser: { id: number; name: string } | null;
  projectedClosings: { dealId: number; stage: string | null; display: string; dateOnly: boolean; projection: true }[];
  freshness: { readAt: string; note: string };
  detailPath: string | null;
};

export type RemoteResult =
  | { state: 'unavailable'; reason: string }
  | RemoteCustomer;

type CacheEntry = { at: number; value: RemoteCustomer };

const cache = new Map<string, CacheEntry>();
const CACHE_MS = 45_000;

export function clearIntelligenceCache(): void {
  cache.clear();
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
}): Promise<RemoteResult> {
  const key = `${input.organization}:${input.fubAccountId}:${input.referralId}:${input.participantKey}:${input.personId}`;
  const hit = cache.get(key);
  const nowMs = input.now ?? Date.now();
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
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
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(input.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-referrio-signature': signature },
      body: JSON.stringify(body),
      signal: abortAfter(input.timeoutMs ?? 8_000),
      cache: 'no-store',
    });
    if (!response.ok) return { state: 'unavailable', reason: response.status === 403 ? 'wrong_scope' : 'unavailable' };
    const payload = await response.json() as Partial<RemoteCustomer>;
    if (payload.personId !== input.personId || payload.officialScoring !== false) {
      return { state: 'unavailable', reason: 'tampered_person' };
    }
    if (payload.state !== 'ready' && payload.state !== 'incomplete' && payload.state !== 'no_records' && payload.state !== 'unavailable') {
      return { state: 'unavailable', reason: 'malformed' };
    }
    if (payload.state === 'unavailable') return { state: 'unavailable', reason: 'unavailable' };
    const value: RemoteCustomer = {
      state: payload.state,
      officialScoring: false,
      personId: input.personId,
      latest: payload.latest ?? null,
      followUp: payload.followUp ?? null,
      fubAssignedUser: payload.fubAssignedUser ?? null,
      projectedClosings: payload.projectedClosings ?? [],
      freshness: payload.freshness ?? { readAt: new Date(nowMs).toISOString(), note: 'Stored read.' },
      detailPath: payload.detailPath ?? null,
    };
    cache.set(key, { at: nowMs, value });
    return value;
  } catch {
    return { state: 'unavailable', reason: 'timeout' };
  }
}

function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(ms);
    } catch {
      return new AbortController().signal;
    }
  }
  return new AbortController().signal;
}

function canonical(body: { organization: string; fubAccountId: string; referralId: string; participantKey: string; personId: number; exp: number }): string {
  return `organization=${body.organization}\nfubAccountId=${body.fubAccountId}\nreferralId=${body.referralId}\nparticipantKey=${body.participantKey}\npersonId=${body.personId}\nexp=${body.exp}`;
}
