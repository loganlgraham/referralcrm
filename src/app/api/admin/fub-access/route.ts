import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { fubAccessFeedback, parseFubAccessCommand } from '@/lib/intelligence/access-control';
import { sameOriginRequest } from '@/lib/intelligence/panel';
import { changeFubAccess, readFubAccessPage } from '@/lib/server/fub-access';
import { connectMongo } from '@/lib/mongoose';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!allowed(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const session = await getCurrentSession();
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  await connectMongo();
  const page = await readFubAccessPage(session.user.id);
  if (!page.ok) return json({ error: 'Only the account owner can manage Follow Up Boss access.' }, 403);
  return json(page, 200);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!allowed(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const session = await getCurrentSession();
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const command = parseFubAccessCommand(await request.json().catch(() => null));
  if ('error' in command) return json({ error: 'The access change was not valid.' }, 400);
  await connectMongo();
  const result = await changeFubAccess({
    actorUserId: session.user.id,
    targetUserId: command.userId,
    organization: command.organization,
    access: command.access,
    at: new Date().toISOString(),
  });
  if (!result.ok) {
    if (result.reason === 'conflict') {
      return json({ error: 'That access change was saved by another request. Refresh and try again.' }, 409);
    }
    return json({ error: fubAccessFeedback(command.organization, result) }, result.status);
  }
  return json({ ok: true, changed: result.changed, message: fubAccessFeedback(command.organization, result) }, 200);
}

function allowed(request: NextRequest): boolean {
  return sameOriginRequest({
    requestOrigin: request.headers.get('origin'),
    pageOrigin: request.nextUrl.origin,
    fetchSite: request.headers.get('sec-fetch-site'),
  });
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}
