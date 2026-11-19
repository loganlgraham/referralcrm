import { createHmac } from 'node:crypto';
import { abortAfter, resolveProtectionToken, trustedIntelligenceUrl } from '@/lib/intelligence/remote';

export const AGENT_ACTIVITY_PATH = '/api/integration/referrio/agent-activity';
export const AGENT_ACTIVITY_WINDOW_DAYS = 30;
const MAX_USERS = 50;

export type StoredAgentActivity = {
  fubUserId: number;
  state: 'measured' | 'not_found';
  assignedPeople: number;
  contactedPeople: number;
};

export type AgentActivityResult =
  | { state: 'ready'; coverageComplete: boolean; users: StoredAgentActivity[] }
  | { state: 'unavailable'; reason: string };

/** Sibling of the reviewed customer read; anything else is not trusted. */
export function agentActivityUrl(customerUrl: string): string | null {
  const trusted = trustedIntelligenceUrl(customerUrl);
  if (!trusted) return null;
  const url = new URL(trusted);
  url.pathname = AGENT_ACTIVITY_PATH;
  return url.toString();
}

/**
 * Stored-only read of calls and texts by linked Follow Up Boss users. It never
 * asks Follow Up Boss for data and never writes. A failure means Referrio-only.
 */
export async function fetchStoredAgentActivity(input: {
  organization: string;
  fubAccountId: string;
  referralId: string;
  fubUserIds: readonly number[];
  secret: string;
  customerUrl: string;
  fetchImpl?: typeof fetch;
  now?: number;
  protectionToken?: string | null;
}): Promise<AgentActivityResult> {
  const destination = agentActivityUrl(input.customerUrl);
  if (!destination || !input.secret) return { state: 'unavailable', reason: 'not_configured' };
  const fubUserIds = Array.from(new Set(input.fubUserIds.filter((id) => Number.isSafeInteger(id) && id > 0))).sort((a, b) => a - b).slice(0, MAX_USERS);
  if (fubUserIds.length === 0) return { state: 'ready', coverageComplete: false, users: [] };
  const body = {
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    referralId: input.referralId,
    fubUserIds,
    windowDays: AGENT_ACTIVITY_WINDOW_DAYS,
    exp: Math.floor((input.now ?? Date.now()) / 1000) + 60,
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-referrio-signature': createHmac('sha256', input.secret).update(canonicalAgentActivity(body)).digest('hex'),
  };
  const protectionToken = await resolveProtectionToken(input.protectionToken);
  if (protectionToken) headers['x-vercel-trusted-oidc-idp-token'] = protectionToken;
  try {
    const response = await (input.fetchImpl ?? fetch)(destination, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortAfter(6_000),
      cache: 'no-store',
      redirect: 'manual',
    });
    if (!response.ok) return { state: 'unavailable', reason: response.status === 404 ? 'not_deployed' : 'unavailable' };
    const payload = await response.json().catch(() => null) as { officialScoring?: unknown; coverageComplete?: unknown; users?: unknown } | null;
    if (!payload || payload.officialScoring !== false || !Array.isArray(payload.users)) return { state: 'unavailable', reason: 'malformed' };
    const requested = new Set(fubUserIds);
    const users: StoredAgentActivity[] = [];
    for (const raw of payload.users as Record<string, unknown>[]) {
      const id = raw?.fubUserId;
      const assigned = raw?.assignedPeople;
      const contacted = raw?.contactedPeople;
      if (typeof id !== 'number' || !requested.has(id)) return { state: 'unavailable', reason: 'tampered_user' };
      if (raw.state !== 'measured' && raw.state !== 'not_found') return { state: 'unavailable', reason: 'malformed' };
      if (typeof assigned !== 'number' || typeof contacted !== 'number' || assigned < 0 || contacted < 0) return { state: 'unavailable', reason: 'malformed' };
      users.push({ fubUserId: id, state: raw.state, assignedPeople: assigned, contactedPeople: Math.min(contacted, assigned) });
    }
    return { state: 'ready', coverageComplete: payload.coverageComplete === true, users };
  } catch {
    return { state: 'unavailable', reason: 'timeout' };
  }
}

export function canonicalAgentActivity(body: { organization: string; fubAccountId: string; referralId: string; fubUserIds: readonly number[]; windowDays: number; exp: number }): string {
  return `organization=${body.organization}\nfubAccountId=${body.fubAccountId}\nreferralId=${body.referralId}\nfubUserIds=${body.fubUserIds.join(',')}\nwindowDays=${body.windowDays}\nexp=${body.exp}`;
}
