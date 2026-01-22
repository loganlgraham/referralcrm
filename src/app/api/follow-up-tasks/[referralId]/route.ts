import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTaskState } from '@/models/follow-up-task-state';
import { Referral } from '@/models/referral';
import {
  buildCompletionEntries,
  buildManualTaskEntries,
  buildShownTasks,
  buildStateFromDocument,
  buildTaskMetadataEntries,
} from '@/lib/server/follow-up-task-state';

interface RouteParams {
  params: { referralId: string };
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Admins have full access to all task states - no need to check referral permissions
  const isAdmin = session.user?.role === 'admin';
  
  await connectMongo();

  // For non-admins, verify they can view the referral
  if (!isAdmin) {
    const referral = await Referral.findById(params.referralId)
      .populate('assignedAgent', 'userId')
      .populate('buySideAgent', 'userId')
      .populate('sellSideAgent', 'userId')
      .populate('lender', 'userId');
    if (!referral || referral.deletedAt) {
      return new NextResponse('Not found', { status: 404 });
    }

    if (
      !canViewReferral(session, {
        assignedAgent: referral.assignedAgent,
        buySideAgent: referral.buySideAgent,
        sellSideAgent: referral.sellSideAgent,
        lender: referral.lender,
        org: referral.org,
      })
    ) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  const doc = await FollowUpTaskState.findOne({ referralId: params.referralId }).lean<{
    completions?: unknown;
    manualTasks?: unknown;
    shownTasks?: unknown;
    taskMetadata?: unknown;
  }>();

  const state = buildStateFromDocument(doc);
  const manualTasksCount = state.manualTasks?.length ?? 0;
  console.log(`[Task API] GET /api/follow-up-tasks/${params.referralId} - User: ${session.user?.id} (${session.user?.role}), Found ${manualTasksCount} manual tasks`);

  return NextResponse.json({ referralId: params.referralId, state });
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Admins have full access to manage all task states - no need to check referral permissions
  const isAdmin = session.user?.role === 'admin';
  
  await connectMongo();

  // For non-admins, verify they can manage the referral
  if (!isAdmin) {
    const referral = await Referral.findById(params.referralId)
      .populate('assignedAgent', 'userId')
      .populate('buySideAgent', 'userId')
      .populate('sellSideAgent', 'userId')
      .populate('lender', 'userId');
    if (!referral || referral.deletedAt) {
      return new NextResponse('Not found', { status: 404 });
    }

    if (
      !canManageReferral(session, {
        assignedAgent: referral.assignedAgent,
        buySideAgent: referral.buySideAgent,
        sellSideAgent: referral.sellSideAgent,
        lender: referral.lender,
        org: referral.org,
      })
    ) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  const payload = await request.json().catch(() => null);
  const referralId = params.referralId;

  // TEMPORARY LOGGING: Log incoming request
  console.log(`[Task API DEBUG] PUT /api/follow-up-tasks/${referralId} - User: ${session.user?.id} (${session.user?.role})`);
  if (payload && typeof payload === 'object') {
    if ('completions' in payload && payload.completions && typeof payload.completions === 'object') {
      const completions = payload.completions as Record<string, { completed?: boolean; completedAt?: string | null }>;
      const completionEntries = Object.entries(completions);
      console.log(`[Task API DEBUG] Incoming completions payload: ${completionEntries.length} entries`);
      completionEntries.forEach(([taskId, state]) => {
        console.log(`[Task API DEBUG]   - taskId: ${taskId}, completed: ${state.completed}, completedAt: ${state.completedAt ?? 'null'}`);
      });
    }
  }

  const update: Record<string, unknown> = {};

  // Only $set completions when explicitly provided. When omitted (e.g. debounced sync with
  // empty local completions), we never overwrite server completions.
  if (payload && 'completions' in payload) {
    update.completions = buildCompletionEntries(payload.completions, referralId);
  }

  if (payload && 'manualTasks' in payload) {
    update.manualTasks = buildManualTaskEntries(payload.manualTasks);
  }

  if (payload && 'shownTasks' in payload) {
    update.shownTasks = buildShownTasks(payload.shownTasks);
  }

  if (payload && 'taskMetadata' in payload) {
    update.taskMetadata = buildTaskMetadataEntries(payload.taskMetadata, referralId);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const manualTasksCount = Array.isArray(update.manualTasks) ? update.manualTasks.length : 0;
  const completionsCount = Array.isArray(update.completions) ? update.completions.length : 0;
  console.log(`[Task API] PUT /api/follow-up-tasks/${referralId} - User: ${session.user?.id} (${session.user?.role}), Manual tasks: ${manualTasksCount}, Completions: ${completionsCount}`);

  // TEMPORARY LOGGING: Log what we're about to save
  if (Array.isArray(update.completions)) {
    console.log(`[Task API DEBUG] Saving ${update.completions.length} completion entries:`);
    update.completions.forEach((entry: { taskId?: string; completed?: boolean; completedAt?: string | null }) => {
      console.log(`[Task API DEBUG]   - taskId: ${entry.taskId}, completed: ${entry.completed}, completedAt: ${entry.completedAt ?? 'null'}`);
    });
  }

  const doc = await FollowUpTaskState.findOneAndUpdate(
    { referralId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<{
    completions?: unknown;
    manualTasks?: unknown;
    shownTasks?: unknown;
    taskMetadata?: unknown;
    updatedAt?: Date;
  }>();

  const savedManualTasksCount = Array.isArray(doc?.manualTasks) ? doc.manualTasks.length : 0;
  console.log(`[Task API] Successfully saved task state for referral ${referralId}: ${savedManualTasksCount} manual tasks persisted`);

  return NextResponse.json({ referralId, state: buildStateFromDocument(doc) });
}
