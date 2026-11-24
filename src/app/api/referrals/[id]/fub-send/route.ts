import { NextRequest, NextResponse } from 'next/server';

import { getFubAgentChoices, liveFubEnabled } from '@/lib/server/live-fub-handoff';
import { authorizeFubViewer } from '@/lib/server/intelligence-viewer';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { getCurrentSession } from '@/lib/auth';
import { sameOriginRequest } from '@/lib/intelligence/panel';
import { connectMongo } from '@/lib/mongoose';
import {
  approveMockFubSend,
  readMockFubApprovalPreview,
} from '@/lib/server/mock-fub-send';

type Params = { params: { id: string } };

function isSameOrigin(request: NextRequest): boolean {
  return sameOriginRequest({
    requestOrigin: request.headers.get('origin'),
    pageOrigin: request.nextUrl.origin,
    fetchSite: request.headers.get('sec-fetch-site'),
  });
}

async function requireAdmin(): Promise<
  | { ok: true; actorId: string }
  | { ok: false; response: NextResponse }
> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (session.user.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Only an admin can approve this send.' },
        { status: 403 },
      ),
    };
  }
  if (liveFubEnabled()) {
    await connectMongo();
    const viewer = await authorizeFubViewer({ session, organization: 'AHA', accountId: VERIFIED_FUB_ACCOUNT_ID, canViewReferral: true });
    if (!viewer.access.ok) return { ok: false, response: NextResponse.json({error:'Follow Up Boss access is required.'}, {status:403}) };
  }
  return { ok: true, actorId: session.user.id };
}

export async function GET(
  request: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await connectMongo();
  const result = await readMockFubApprovalPreview({
    referralId: params.id,
    actorId: admin.actorId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }
  if (liveFubEnabled() && request.nextUrl.searchParams.get('agents') === '1') {
    try {
      return NextResponse.json({ users: await getFubAgentChoices() });
    } catch {
      return NextResponse.json({ error: 'The Follow Up Boss agent directory could not be loaded.' }, {status:503});
    }
  }
  return NextResponse.json(result.preview);
}

export async function POST(
  request: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    approvalKey?: unknown;
  } | null;
  const approvalKey =
    typeof body?.approvalKey === 'string' ? body.approvalKey.trim() : '';
  if (!/^[a-zA-Z0-9:_-]{8,120}$/u.test(approvalKey)) {
    return NextResponse.json(
      { error: 'A valid approval key is required.' },
      { status: 422 },
    );
  }

  await connectMongo();
  const result = await approveMockFubSend({
    referralId: params.id,
    actorId: admin.actorId,
    approvalKey,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }
  return NextResponse.json(result.result);
}
