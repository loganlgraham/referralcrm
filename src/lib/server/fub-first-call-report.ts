import { createHmac } from 'node:crypto';
import { firstCallReportSchema } from '@/lib/intelligence/first-call-timing';
import { resolveProtectionToken, trustedIntelligenceUrl } from '@/lib/intelligence/remote';
import { readConfirmedHandoffs } from '@/lib/server/fub-confirmed-handoffs';

export async function readFirstCallReport(days: number, readAt: string) {
  const preview = process.env.VERCEL_ENV === 'preview' ? process.env.REFERRIO_FIRST_CALL_PREVIEW_URL : undefined;
  const base = trustedIntelligenceUrl(preview ?? process.env.REFERRIO_INTELLIGENCE_URL ?? '');
  const secret = process.env.REFERRIO_SOP_SECRET ?? process.env.REFERRIO_INTEGRATION_SECRET;
  if (!base || !secret) throw new Error('Missing timing connection.');
  const url = new URL('/api/integration/referrio/first-calls', base);
  const body = JSON.stringify({
    organization: 'AHA', accountId: process.env.REFERRIO_FUB_ACCOUNT_ID,
    days, readAt, exp: Math.floor(Date.now() / 1000) + 60,
    handoffs: await readConfirmedHandoffs(days, readAt),
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-referrio-signature': createHmac('sha256', secret).update('referrio-first-calls-v1\n').update(body).digest('hex'),
  };
  const token = await resolveProtectionToken(undefined);
  if (token) headers['x-vercel-trusted-oidc-idp-token'] = token;
  const response = await fetch(url, {
    method: 'POST', body, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Timing unavailable.');
  const data = firstCallReportSchema.parse(await response.json());
  if (data.readAt !== readAt) throw new Error('Timing window mismatch.');
  return data;
}
