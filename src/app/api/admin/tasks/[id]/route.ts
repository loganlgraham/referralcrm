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

type TaskAction =
  | 'complete'
  | 'dismiss'
  | 'snooze'
  | 'unsnooze'
  | 'set_due_override'
  | 'edit';

const VALID_ACTIONS: readonly TaskAction[] = [
  'complete',
  'dismiss',
  'snooze',
  'unsnooze',
  'set_due_override',
  'edit',
];

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

  const body = await request.json().catch(() => ({}));
  const action = body?.action as TaskAction | undefined;

  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Use: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 }
    );
  }

  await connectMongo();

  const now = new Date();
  const actorId = session.user.id;
  const baseSet: Record<string, unknown> = { updatedAt: now, updatedBy: actorId };
  const set: Record<string, unknown> = { ...baseSet };
  const unset: Record<string, ''> = {};
  // All mutating actions below only apply to open tasks. Collapsing the
  // pre-read + update into one findOneAndUpdate keeps concurrent admins from
  // stomping each other and prevents writes from landing on completed/dismissed rows.
  const filter: Record<string, unknown> = { _id: id, status: 'open' };

  switch (action) {
    case 'complete': {
      set.status = 'completed';
      set.completedAt = now;
      set.completedBy = actorId;
      break;
    }
    case 'dismiss': {
      // Only system-generated tasks (those with a ruleKey) can be dismissed.
      filter.ruleKey = { $ne: null };
      set.status = 'dismissed';
      set.dismissedAt = now;
      set.dismissedBy = actorId;
      break;
    }
    case 'snooze': {
      const snoozedUntil = body?.snoozedUntil ? new Date(body.snoozedUntil) : null;
      if (!snoozedUntil || Number.isNaN(snoozedUntil.getTime())) {
        return NextResponse.json(
          { error: 'Valid snoozedUntil date required' },
          { status: 400 }
        );
      }
      set.snoozedUntil = snoozedUntil;
      break;
    }
    case 'unsnooze': {
      unset.snoozedUntil = '';
      break;
    }
    case 'set_due_override': {
      const dueAtOverride = body?.dueAtOverride;
      if (dueAtOverride === null || dueAtOverride === undefined) {
        unset.dueAtOverride = '';
      } else {
        const date = new Date(dueAtOverride);
        if (Number.isNaN(date.getTime())) {
          return NextResponse.json(
            { error: 'Invalid dueAtOverride date' },
            { status: 400 }
          );
        }
        set.dueAtOverride = date;
      }
      // Setting or clearing a manual override also clears any active snooze so
      // the override is the sole due-date source of truth.
      unset.snoozedUntil = '';
      break;
    }
    case 'edit': {
      if (body?.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) {
          return NextResponse.json(
            { error: 'Title cannot be empty' },
            { status: 400 }
          );
        }
        set.title = title;
      }
      if (body?.description !== undefined) {
        const description = body.description ? String(body.description).trim() : '';
        if (description) {
          set.description = description;
        } else {
          unset.description = '';
        }
      }
      if (body?.category !== undefined) {
        if (body.category) {
          set.category = body.category;
        } else {
          unset.category = '';
        }
      }
      if (body?.priority !== undefined) {
        if (body.priority) {
          set.priority = body.priority;
        } else {
          unset.priority = '';
        }
      }
      if (body?.dueAt !== undefined) {
        if (body.dueAt === null) {
          unset.dueAt = '';
        } else {
          const date = new Date(body.dueAt);
          if (Number.isNaN(date.getTime())) {
            return NextResponse.json(
              { error: 'Invalid dueAt date' },
              { status: 400 }
            );
          }
          set.dueAt = date;
        }
      }
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unhandled task action: ${_exhaustive as string}`);
    }
  }

  const updateOp: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) {
    updateOp.$unset = unset;
  }

  const updated = await AdminTask.findOneAndUpdate(filter, updateOp, {
    new: true,
  }).lean<AdminTaskLean>();

  if (!updated) {
    // Either the task doesn't exist, isn't open anymore, or (for dismiss) isn't
    // a system task. Distinguish 404 vs 409 so the client can refetch board state.
    const existing = await AdminTask.findById(id)
      .select('_id status ruleKey')
      .lean<Pick<AdminTaskLean, '_id' | 'status' | 'ruleKey'>>();
    if (!existing) {
      return new NextResponse('Task not found', { status: 404 });
    }
    if (action === 'dismiss' && !existing.ruleKey) {
      return NextResponse.json(
        { error: 'Only system tasks can be dismissed' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Task is ${existing.status}; only open tasks can be modified` },
      { status: 409 }
    );
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
