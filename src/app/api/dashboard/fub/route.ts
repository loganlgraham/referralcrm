import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { canViewFubDashboard } from '@/lib/server/fub-access';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { trustedIntelligenceUrl } from '@/lib/intelligence/remote';
import { fetchSopDashboard } from '@/lib/intelligence/sop-remote';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return json({ error: 'Sign in to continue.' }, 401);
  await connectMongo();
  const allowed = await canViewFubDashboard(session.user.id);
  if (request.nextUrl.searchParams.get('access') === '1')
    return json(allowed ? { allowed, configured: connectionConfigured() } : { allowed }, 200);
  if (!allowed)
    return json(
      { error: 'The account owner must grant you FUB dashboard access.' },
      403,
    );
  const days = Number(request.nextUrl.searchParams.get('days') ?? 30);
  if (days !== 7 && days !== 30 && days !== 90)
    return json({ error: 'Choose 7, 30, or 90 days.' }, 400);
  if (!connectionConfigured())
    return json({ error: 'The FUB dashboard data connection has not been configured for this environment.' }, 503);
  const data = await fetchSopDashboard({
    days,
    url: process.env.REFERRIO_INTELLIGENCE_URL ?? '',
    accountId: process.env.REFERRIO_FUB_ACCOUNT_ID ?? '',
    secret: process.env.REFERRIO_SOP_SECRET ?? process.env.REFERRIO_INTEGRATION_SECRET ?? '',
  });
  if (!data)
    return json(
      { error: 'FUB evidence is temporarily unavailable. Try again shortly.' },
      503,
    );
  return json(data, 200);
}
function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}

function connectionConfigured(): boolean {
  return process.env.REFERRIO_FUB_ACCOUNT_ID === VERIFIED_FUB_ACCOUNT_ID &&
    Boolean(process.env.REFERRIO_SOP_SECRET ?? process.env.REFERRIO_INTEGRATION_SECRET) &&
    trustedIntelligenceUrl(process.env.REFERRIO_INTELLIGENCE_URL ?? '') !== null;
}
