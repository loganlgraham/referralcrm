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

// Disable caching for this route - task state must always be fresh across users
export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

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

  return NextResponse.json({ referralId: params.referralId, state }, { headers: NO_CACHE_HEADERS });
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

  return NextResponse.json({ referralId, state: buildStateFromDocument(doc) }, { headers: NO_CACHE_HEADERS });
}
