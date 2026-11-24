import { createHmac } from 'node:crypto';
import {
  resolveProtectionToken,
  trustedIntelligenceUrl,
} from '@/lib/intelligence/remote';
import {
  sopDashboardSchema,
  sopAuditSchema,
  type SopAudit,
  type SopDashboard,
} from '@/lib/intelligence/sop-contract';

export async function fetchSopDashboard(input: {
  days: 7 | 30 | 90;
  url: string;
  accountId: string;
  secret: string;
  fetchImpl?: typeof fetch;
  protectionToken?: string | null;
}): Promise<SopDashboard | null> {
  const customerUrl = trustedIntelligenceUrl(input.url);
  if (!customerUrl || !input.secret) return null;
  const destination = new URL(customerUrl);
  destination.pathname = '/api/integration/referrio/sop';
  const exp = Math.floor(Date.now() / 1000) + 60;
  const body = {
    organization: 'AHA',
    accountId: input.accountId,
    days: input.days,
    exp,
  };
  const signature = createHmac('sha256', input.secret)
    .update(`referrio-sop-v1\nAHA\n${input.accountId}\n${input.days}\n${exp}`)
    .digest('hex');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-referrio-signature': signature,
  };
  const token = await resolveProtectionToken(input.protectionToken);
  if (token) headers['x-vercel-trusted-oidc-idp-token'] = token;
  try {
    const response = await (input.fetchImpl ?? fetch)(destination.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed = sopDashboardSchema.safeParse(await response.json());
    return parsed.success && parsed.data.days === input.days
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

/** Validate a specific review without relying on the dashboard date range. */
export async function fetchSopReview(input: {
  personId: number;
  sourceNoteId: number;
  url: string;
  accountId: string;
  secret: string;
  fetchImpl?: typeof fetch;
  protectionToken?: string | null;
}): Promise<SopAudit | null> {
  const customerUrl = trustedIntelligenceUrl(input.url);
  if (!customerUrl || !input.secret || !Number.isSafeInteger(input.personId) || input.personId < 1 ||
    !Number.isSafeInteger(input.sourceNoteId) || input.sourceNoteId < 1) {
    throw new Error('Review connection is unavailable.');
  }
  const destination = new URL(customerUrl);
  destination.pathname = '/api/integration/referrio/sop/review';
  const exp = Math.floor(Date.now() / 1000) + 60;
  const body = { organization: 'AHA', accountId: input.accountId, personId: input.personId, sourceNoteId: input.sourceNoteId, exp };
  const signature = createHmac('sha256', input.secret)
    .update(`referrio-sop-review-v1\nAHA\n${input.accountId}\n${input.personId}\n${input.sourceNoteId}\n${exp}`)
    .digest('hex');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-referrio-signature': signature };
  const token = await resolveProtectionToken(input.protectionToken);
  if (token) headers['x-vercel-trusted-oidc-idp-token'] = token;
  const response = await (input.fetchImpl ?? fetch)(destination.toString(), {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Review evidence could not be verified.');
  const raw: unknown = await response.json();
  const parsed = sopAuditSchema.safeParse(raw && typeof raw === 'object' && 'review' in raw ? raw.review : null);
  if (!parsed.success || parsed.data.kind !== 'day-31' || parsed.data.personId !== input.personId || parsed.data.sourceNoteId !== input.sourceNoteId) {
    throw new Error('Review evidence could not be verified.');
  }
  return parsed.data;
}
