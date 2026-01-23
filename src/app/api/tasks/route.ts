import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTask, toFollowUpTaskResponse, type FollowUpTaskLean } from '@/models/follow-up-task';

// Disable caching for this route
export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

/**
 * GET /api/tasks
 *
 * Query tasks with filters:
 * - scope: 'referral' | 'agent'
 * - referralId: filter by referral
 * - agentId: filter by agent
 * - status: 'open' | 'completed'
 * - includeCompleted: boolean (if true, include completed tasks even when status=open)
 * - dueBefore: ISO date string (tasks due before this date)
 * - dueAfter: ISO date string (tasks due after this date)
 *
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401, headers: NO_CACHE_HEADERS });
  }

  // Admin-only
  if (session.user?.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403, headers: NO_CACHE_HEADERS });
  }

  await connectMongo();

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope');
  const referralId = searchParams.get('referralId');
  const referralIds = searchParams.get('referralIds'); // comma-separated for batch queries
  const agentId = searchParams.get('agentId');
  const status = searchParams.get('status');
  const includeCompleted = searchParams.get('includeCompleted') === 'true';
  const dueBefore = searchParams.get('dueBefore');
  const dueAfter = searchParams.get('dueAfter');

  // Build query filter
  const filter: Record<string, unknown> = {};

  if (scope) {
    filter.scope = scope;
  }

  if (referralId) {
    filter.referralId = new Types.ObjectId(referralId);
  }

  if (referralIds) {
    const ids = referralIds.split(',').map((id) => new Types.ObjectId(id.trim()));
    filter.referralId = { $in: ids };
  }

  if (agentId) {
    filter.agentId = new Types.ObjectId(agentId);
  }

  // Status filtering
  if (status === 'open' && !includeCompleted) {
    filter.status = 'open';
  } else if (status === 'completed') {
    filter.status = 'completed';
  }
  // If includeCompleted=true or no status specified, don't filter by status

  // Date range filtering
  if (dueBefore || dueAfter) {
    filter.dueAt = {};
    if (dueBefore) {
      (filter.dueAt as Record<string, Date>).$lte = new Date(dueBefore);
    }
    if (dueAfter) {
      (filter.dueAt as Record<string, Date>).$gte = new Date(dueAfter);
    }
  }

  const tasks = await FollowUpTask.find(filter)
    .sort({ dueAt: 1 })
    .lean<FollowUpTaskLean[]>();

  const response = tasks.map(toFollowUpTaskResponse);

  return NextResponse.json({ tasks: response }, { headers: NO_CACHE_HEADERS });
}

/**
 * POST /api/tasks
 *
 * Create a manual task.
 *
 * Body:
 * - referralId: string (required for referral tasks)
 * - agentId: string (required for agent tasks)
 * - scope: 'referral' | 'agent'
 * - type: 'Task' | 'Call' | 'Email' | 'Text' | 'Auto-Email'
 * - title: string
 * - message: string
 * - category: 'ops' | 'communication' | 'pipeline' | 'finance'
 * - dueAt: ISO date string
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

  await connectMongo();

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_CACHE_HEADERS });
  }

  const { referralId, agentId, scope, type, title, message, category, dueAt } = body;

  // Validate required fields
  if (!scope || !type || !title || !message || !category || !dueAt) {
    return NextResponse.json(
      { error: 'Missing required fields: scope, type, title, message, category, dueAt' },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }

  // Validate scope-specific requirements
  if (scope === 'referral' && !referralId) {
    return NextResponse.json(
      { error: 'referralId is required for referral tasks' },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }

  if (scope === 'agent' && !agentId) {
    return NextResponse.json(
      { error: 'agentId is required for agent tasks' },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }

  const task = await FollowUpTask.create({
    referralId: referralId ? new Types.ObjectId(referralId) : null,
    agentId: agentId ? new Types.ObjectId(agentId) : null,
    scope,
    type,
    title,
    message,
    category,
    dueAt: new Date(dueAt),
    status: 'open',
    completedAt: null,
    completedByUserId: null,
    source: 'manual',
    ruleId: null,
    statusWhenCreated: null,
  });

  const leanTask = task.toObject() as FollowUpTaskLean;

  return NextResponse.json({ task: toFollowUpTaskResponse(leanTask) }, { status: 201, headers: NO_CACHE_HEADERS });
}
