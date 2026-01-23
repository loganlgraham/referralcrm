import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { syncAgentOnboardingTasks } from '@/lib/server/task-sync';

// Disable caching for this route
export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

/**
 * POST /api/tasks/sync/agent
 *
 * Sync onboarding tasks for an agent.
 * Creates missing static tasks without overwriting existing ones.
 *
 * Body:
 * - agentId: string (required)
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
  if (!body || !body.agentId) {
    return NextResponse.json(
      { error: 'agentId is required' },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }

  const { agentId } = body;

  try {
    const result = await syncAgentOnboardingTasks(agentId);

    if (result.errors.length > 0) {
      console.error(`[Task Sync] Errors syncing agent ${agentId}:`, result.errors);
    }

    return NextResponse.json(
      {
        success: true,
        agentId,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    console.error(`[Task Sync] Failed to sync agent ${agentId}:`, error);
    return NextResponse.json(
      { error: 'Failed to sync tasks' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
