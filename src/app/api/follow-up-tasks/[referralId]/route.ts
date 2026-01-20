import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTaskState } from '@/models/follow-up-task-state';
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
  try {
    await requireAdmin();
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unauthorized' }, { status: error.status || 401 });
  }

  await connectMongo();

  const doc = (await FollowUpTaskState.findOne({ referralId: params.referralId }).lean()) as {
    completions?: unknown;
    manualTasks?: unknown;
    shownTasks?: unknown;
    taskMetadata?: unknown;
  } | null;

  return NextResponse.json({ referralId: params.referralId, state: buildStateFromDocument(doc) });
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unauthorized' }, { status: error.status || 401 });
  }

  const payload = await request.json().catch(() => null);
  const referralId = params.referralId;

  const update: Record<string, unknown> = {};

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

  await connectMongo();

  const doc = (await FollowUpTaskState.findOneAndUpdate(
    { referralId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean()) as {
    completions?: unknown;
    manualTasks?: unknown;
    shownTasks?: unknown;
    taskMetadata?: unknown;
  } | null;

  return NextResponse.json({ referralId, state: buildStateFromDocument(doc) });
}
