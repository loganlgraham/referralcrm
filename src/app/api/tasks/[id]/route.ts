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

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/tasks/[id]
 *
 * Update a task. Primarily used for toggling completion status.
 *
 * Body (all optional):
 * - status: 'open' | 'completed'
 * - completedAt: ISO date string | null
 * - title: string (only for manual tasks)
 * - message: string (only for manual tasks)
 * - dueAt: ISO date string (only for manual tasks)
 * - category: string (only for manual tasks)
 * - type: string (only for manual tasks)
 *
 * Admin-only endpoint.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401, headers: NO_CACHE_HEADERS });
  }

  // Admin-only
  if (session.user?.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403, headers: NO_CACHE_HEADERS });
  }

  await connectMongo();

  const { id } = await params;

  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400, headers: NO_CACHE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_CACHE_HEADERS });
  }

  // Find the task first to check if it exists and get its source
  const existingTask = await FollowUpTask.findById(id).lean<FollowUpTaskLean>();
  if (!existingTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404, headers: NO_CACHE_HEADERS });
  }

  // Build update object
  const update: Record<string, unknown> = {};

  // Handle completion toggle
  if ('status' in body) {
    const newStatus = body.status;
    
    // Validate status
    if (!['open', 'completed', 'archived'].includes(newStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400, headers: NO_CACHE_HEADERS });
    }

    // Don't allow changing archived tasks (except to unarchive manually if needed)
    if (existingTask.status === 'archived' && newStatus !== 'archived') {
      // Allow unarchiving only for admins
      update.status = newStatus;
      if (newStatus === 'open') {
        update.completedAt = null;
        update.completedByUserId = null;
      }
    } else if (newStatus === 'completed') {
      update.status = 'completed';
      update.completedAt = body.completedAt ? new Date(body.completedAt) : new Date();
      update.completedByUserId = session.user?.id ? new Types.ObjectId(session.user.id) : null;
    } else if (newStatus === 'open') {
      update.status = 'open';
      update.completedAt = null;
      update.completedByUserId = null;
    } else if (newStatus === 'archived') {
      // Only allow archiving open tasks (not completed ones)
      if (existingTask.status === 'open') {
        update.status = 'archived';
      } else {
        return NextResponse.json(
          { error: 'Cannot archive completed tasks' },
          { status: 400, headers: NO_CACHE_HEADERS }
        );
      }
    }
  }

  // Allow editing these fields for manual tasks only
  if (existingTask.source === 'manual') {
    if ('title' in body) update.title = body.title;
    if ('message' in body) update.message = body.message;
    if ('dueAt' in body) update.dueAt = new Date(body.dueAt);
    if ('category' in body) update.category = body.category;
    if ('type' in body) update.type = body.type;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400, headers: NO_CACHE_HEADERS });
  }

  const updatedTask = await FollowUpTask.findByIdAndUpdate(id, { $set: update }, { new: true }).lean<FollowUpTaskLean>();

  if (!updatedTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404, headers: NO_CACHE_HEADERS });
  }

  return NextResponse.json({ task: toFollowUpTaskResponse(updatedTask) }, { headers: NO_CACHE_HEADERS });
}

/**
 * DELETE /api/tasks/[id]
 *
 * Delete a task. Only manual tasks can be deleted.
 *
 * Admin-only endpoint.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401, headers: NO_CACHE_HEADERS });
  }

  // Admin-only
  if (session.user?.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403, headers: NO_CACHE_HEADERS });
  }

  await connectMongo();

  const { id } = await params;

  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400, headers: NO_CACHE_HEADERS });
  }

  // Find the task first to verify it's a manual task
  const task = await FollowUpTask.findById(id).lean<FollowUpTaskLean>();
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404, headers: NO_CACHE_HEADERS });
  }

  // Only allow deleting manual tasks
  if (task.source !== 'manual') {
    return NextResponse.json(
      { error: 'Cannot delete static tasks. Only manual tasks can be deleted.' },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }

  await FollowUpTask.findByIdAndDelete(id);

  return NextResponse.json({ success: true }, { headers: NO_CACHE_HEADERS });
}
