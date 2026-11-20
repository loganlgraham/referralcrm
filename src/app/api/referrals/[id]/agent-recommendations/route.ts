import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';
import { connectMongo } from '@/lib/mongoose';
import { sameOriginRequest } from '@/lib/intelligence/panel';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { AGENT_RECOMMENDATION_POLICY } from '@/lib/recommendations/agent-policy';
import { emptyRecommendationResponse } from '@/lib/recommendations/agent-recommendation-response';
import { buildAgentRecommendations, parseMcParam, parseZipParam, type RecommendationReferral } from '@/lib/server/agent-recommendations';
import { authorizeFubViewer } from '@/lib/server/intelligence-viewer';
import { Referral } from '@/models/referral';

interface RouteContext {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

const version = AGENT_RECOMMENDATION_POLICY.version;

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const sameOrigin = sameOriginRequest({
    requestOrigin: request.headers.get('origin'),
    pageOrigin: request.nextUrl.origin,
    fetchSite: request.headers.get('sec-fetch-site'),
  });
  if (!sameOrigin) return json(emptyRecommendationResponse('denied', version), 403);
  const session = await getCurrentSession();
  if (!session?.user?.id) return json(emptyRecommendationResponse('denied', version), 401);
  if (!Types.ObjectId.isValid(context.params.id)) return json(emptyRecommendationResponse('unavailable', version), 404);

  try {
    await connectMongo();
    const referral = await Referral.findById(context.params.id)
      .select('org ahaBucket lookingInZip lookingInZips lender assignedAgent buySideAgent sellSideAgent deletedAt')
      .lean<(RecommendationReferral & { deletedAt?: Date | null; assignedAgent?: Types.ObjectId }) | null>();
    if (!referral || referral.deletedAt) return json(emptyRecommendationResponse('unavailable', version), 404);
    const organization = referral.org === 'AHA' || referral.org === 'AFC' ? referral.org : 'AFC';
    const canView = canViewReferral(session, { org: organization, assignedAgent: referral.assignedAgent ?? undefined });
    const viewer = await authorizeFubViewer({
      session,
      organization,
      accountId: process.env.REFERRIO_FUB_ACCOUNT_ID ?? '',
      canViewReferral: canView,
    });
    if (!canView || (viewer.role !== 'admin' && viewer.role !== 'manager')) {
      return json(emptyRecommendationResponse('denied', version), 403);
    }
    const fubPermitted = viewer.access.ok && process.env.REFERRIO_FUB_ACCOUNT_ID === VERIFIED_FUB_ACCOUNT_ID;
    const params = request.nextUrl.searchParams;
    const body = await buildAgentRecommendations({
      referral,
      mcOverride: parseMcParam(params.get('mcId')),
      zipOverride: parseZipParam(params.get('zips')),
      fubPermitted,
    });
    return json(body, 200);
  } catch (error) {
    console.error(JSON.stringify({ source: 'referrio-agent-recommendation', outcome: 'error', message: error instanceof Error ? error.message : 'unknown' }));
    return json(emptyRecommendationResponse('unavailable', version), 500);
  }
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}
