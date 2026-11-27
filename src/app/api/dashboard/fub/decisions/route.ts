import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { sameOriginRequest } from '@/lib/intelligence/panel';
import { trustedIntelligenceUrl } from '@/lib/intelligence/remote';
import { day31DecisionCommandSchema, day31ReviewIdSchema } from '@/lib/intelligence/sop-decisions';
import { fetchSopReview } from '@/lib/intelligence/sop-remote';
import { canViewFubDashboard } from '@/lib/server/fub-access';
import { readDay31Decisions, saveDay31Decision } from '@/lib/server/fub-sop-decisions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const session = await getCurrentSession();
  if (!session?.user?.id) return json({ error: 'Sign in to continue.' }, 401);
  const personId = parseId(request.nextUrl.searchParams.get('personId'));
  const parsedReviewId = day31ReviewIdSchema.safeParse(request.nextUrl.searchParams.get('reviewId'));
  if (personId === null || !parsedReviewId.success) return json({ error: 'Choose a valid Day 31 review.' }, 400);
  const reviewId = parsedReviewId.data;
  try {
    await connectMongo();
    if (!await canViewFubDashboard(session.user.id)) return forbidden();
    if (!connectionConfigured()) return unavailable();
    const review = await readReview(personId, reviewId);
    if (!review || review.kind !== 'day-31' || review.personId !== personId || review.id !== reviewId) return missingReview();
    if (!await canViewFubDashboard(session.user.id)) return forbidden();
    const records = await readDay31Decisions([review]);
    return json({ record: records[0] ?? null }, 200);
  } catch {
    return unavailable();
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const session = await getCurrentSession();
  if (!session?.user?.id) return json({ error: 'Sign in to continue.' }, 401);
  const raw = await request.text().catch(() => '');
  if (raw.length > 10_000) return json({ error: 'That decision is too long.' }, 400);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: 'The decision could not be read.' }, 400); }
  const parsed = day31DecisionCommandSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Choose Keep or Release and enter a reason.' }, 400);
  try {
    await connectMongo();
    if (!await canViewFubDashboard(session.user.id)) return forbidden();
    if (!connectionConfigured()) return unavailable();
    const review = await readReview(parsed.data.personId, parsed.data.reviewId);
    if (!review || review.kind !== 'day-31' || review.personId !== parsed.data.personId || review.id !== parsed.data.reviewId) return missingReview();
    // The signed evidence read may take time. Recheck a revoked grant before
    // writing the decision, and never accept reviewer identity from the client.
    if (!await canViewFubDashboard(session.user.id)) return forbidden();
    const result = await saveDay31Decision({ command: parsed.data, origin: review, reviewerId: session.user.id });
    if (!result.ok) return json({ error: result.reason === 'limit'
      ? 'This review has reached its decision history limit.'
      : 'This review changed while you were viewing it. Refresh and try again.' }, result.status);
    return json(result, 200);
  } catch {
    return unavailable();
  }
}

function readReview(personId: number, reviewId: string) {
  return fetchSopReview({
    personId,
    reviewId,
    url: process.env.REFERRIO_INTELLIGENCE_URL ?? '',
    accountId: process.env.REFERRIO_FUB_ACCOUNT_ID ?? '',
    secret: process.env.REFERRIO_SOP_SECRET ?? process.env.REFERRIO_INTEGRATION_SECRET ?? '',
  });
}

function connectionConfigured(): boolean {
  return process.env.REFERRIO_FUB_ACCOUNT_ID === VERIFIED_FUB_ACCOUNT_ID &&
    Boolean(process.env.REFERRIO_SOP_SECRET ?? process.env.REFERRIO_INTEGRATION_SECRET) &&
    trustedIntelligenceUrl(process.env.REFERRIO_INTELLIGENCE_URL ?? '') !== null;
}

function parseId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function sameOrigin(request: NextRequest): boolean {
  return sameOriginRequest({ requestOrigin: request.headers.get('origin'), pageOrigin: request.nextUrl.origin, fetchSite: request.headers.get('sec-fetch-site') });
}

function forbidden(): NextResponse {
  return json({ error: 'The account owner must grant you FUB dashboard access.' }, 403);
}

function missingReview(): NextResponse {
  return json({ error: 'That Day 31 review is no longer available. Refresh the dashboard.' }, 404);
}

function unavailable(): NextResponse {
  return json({ error: 'Day 31 decisions are temporarily unavailable. Try again shortly.' }, 503);
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}
