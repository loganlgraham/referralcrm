import { createHmac } from 'node:crypto';
import {
  resolveProtectionToken,
  trustedIntelligenceUrl,
} from '@/lib/intelligence/remote';
import {
  sopDashboardSchema,
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
