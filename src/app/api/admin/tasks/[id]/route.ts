import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as {
      status?: number;
      message?: string;
    };
    return new NextResponse(message, { status });
  }

  const { id } = await context.params;
  if (!id) {
    return new NextResponse('Task ID required', { status: 400 });
  }

  await connectMongo();

  const existing = await AdminTask.findById(id).lean<AdminTaskLean>();
  if (!existing) {
    return new NextResponse('Task not found', { status: 404 });
  }

  const body = await request.json();
  const action = body.action as string | undefined;
  const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: session.user.id };
  const unsetFields: Record<string, ''> = {};

  if (action === 'complete') {
    if (existing.status !== 'open') {
      return NextResponse.json(
        { error: 'Only open tasks can be completed' },
        { status: 400 }
      );
    }
    update.status = 'completed';
    update.completedAt = new Date();
    update.completedBy = session.user.id;
  } else if (action === 'dismiss') {
    if (existing.status !== 'open') {
      return NextResponse.json(
        { error: 'Only open tasks can be dismissed' },
        { status: 400 }
      );
    }
    if (!existing.ruleKey) {
      return NextResponse.json(
        { error: 'Only system tasks can be dismissed' },
        { status: 400 }
      );
    }
    update.status = 'dismissed';
    update.dismissedAt = new Date();
    update.dismissedBy = session.user.id;
  } else if (action === 'snooze') {
    const snoozedUntil = body.snoozedUntil ? new Date(body.snoozedUntil) : null;
    if (!snoozedUntil || Number.isNaN(snoozedUntil.getTime())) {
      return NextResponse.json(
        { error: 'Valid snoozedUntil date required' },
        { status: 400 }
      );
    }
    update.snoozedUntil = snoozedUntil;
  } else if (action === 'unsnooze') {
    unsetFields.snoozedUntil = '';
  } else if (action === 'set_due_override') {
    const dueAtOverride = body.dueAtOverride;
    if (dueAtOverride === null || dueAtOverride === undefined) {
      unsetFields.dueAtOverride = '';
    } else {
      const date = new Date(dueAtOverride);
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json(
          { error: 'Invalid dueAtOverride date' },
          { status: 400 }
        );
      }
      update.dueAtOverride = date;
      unsetFields.snoozedUntil = '';
    }
  } else if (action === 'edit') {
    if (body.title !== undefined) update.title = String(body.title).trim();
    if (body.description !== undefined) update.description = body.description ? String(body.description).trim() : undefined;
    if (body.category !== undefined) update.category = body.category || undefined;
    if (body.priority !== undefined) update.priority = body.priority || undefined;
    if (body.dueAt !== undefined) {
      if (body.dueAt === null) {
        update.dueAt = undefined;
      } else {
        const date = new Date(body.dueAt);
        if (!Number.isNaN(date.getTime())) update.dueAt = date;
      }
    }
  } else {
    return NextResponse.json(
      { error: 'Invalid action. Use: complete, dismiss, snooze, unsnooze, set_due_override, edit' },
      { status: 400 }
    );
  }

  const updateOp: Record<string, unknown> = { $set: update };
  if (Object.keys(unsetFields).length > 0) {
    updateOp.$unset = unsetFields;
  }
  const updated = await AdminTask.findByIdAndUpdate(
    id,
    updateOp,
    { new: true }
  ).lean<AdminTaskLean>();

  if (!updated) {
    return new NextResponse('Task not found', { status: 404 });
  }

  const effectiveDue = getEffectiveDueDate(updated);

  return NextResponse.json(
    {
      ...updated,
      _id: updated._id.toString(),
      referralId: updated.referralId.toString(),
      effectiveDueAt: effectiveDue ? effectiveDue.toISOString() : null,
    },
    { headers: NO_CACHE_HEADERS }
  );
}
