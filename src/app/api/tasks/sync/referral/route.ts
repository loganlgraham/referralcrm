import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { syncReferralTasks } from '@/lib/server/task-sync';

// Disable caching for this route
export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

/**
 * POST /api/tasks/sync/referral
 *
 * Sync tasks for a referral based on its current status.
 * Creates missing static tasks without overwriting existing ones.
 *
 * Body:
 * - referralId: string (required)
 *
 * Admin-only endpoint.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401, headers: NO_CACHE_HEADERS });
  }

  // Admin-only
  if (session.user?.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403, headers: NO_CACHE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.referralId) {
    return NextResponse.json(
      { error: 'referralId is required' },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }

  const { referralId } = body;

  try {
    const result = await syncReferralTasks(referralId);

    if (result.errors.length > 0) {
      console.error(`[Task Sync] Errors syncing referral ${referralId}:`, result.errors);
    }

    return NextResponse.json(
      {
        success: true,
        referralId,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    console.error(`[Task Sync] Failed to sync referral ${referralId}:`, error);
    return NextResponse.json(
      { error: 'Failed to sync tasks' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
