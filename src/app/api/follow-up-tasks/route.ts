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

// Disable caching for this route - task state must always be fresh across users
export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const parseReferralIds = (request: NextRequest): string[] => {
  const ids = request.nextUrl.searchParams.get('referralIds');
  if (!ids) return [];
  return ids
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unauthorized' }, { status: error.status || 401 });
  }

  const referralIds = parseReferralIds(request);
  if (referralIds.length === 0) {
    return NextResponse.json({ error: 'referralIds query param required' }, { status: 400 });
  }

  await connectMongo();

  const docs = await FollowUpTaskState.find({ referralId: { $in: referralIds } }).lean<Array<{
    referralId: string;
    completions?: unknown;
    manualTasks?: unknown;
    shownTasks?: unknown;
    taskMetadata?: unknown;
  }>>();
  const docMap = new Map(docs.map((doc) => [doc.referralId, doc]));

  const referrals = referralIds.reduce<Record<string, ReturnType<typeof buildStateFromDocument>>>((acc, id) => {
    acc[id] = buildStateFromDocument(docMap.get(id) ?? null);
    return acc;
  }, {});

  const totalManualTasks = Object.values(referrals).reduce((sum, state) => sum + (state.manualTasks?.length ?? 0), 0);
  console.log(`[Task API] GET /api/follow-up-tasks - User: admin, Requested ${referralIds.length} referrals, Found ${docs.length} documents, Total ${totalManualTasks} manual tasks`);

  return NextResponse.json({ referrals }, { headers: NO_CACHE_HEADERS });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unauthorized' }, { status: error.status || 401 });
  }

  const payload = await request.json().catch(() => null);
  const referralId = typeof payload?.referralId === 'string' ? payload.referralId : null;

  if (!referralId) {
    return NextResponse.json({ error: 'referralId is required' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ('completions' in payload) {
    update.completions = buildCompletionEntries(payload.completions, referralId);
  }

  if ('manualTasks' in payload) {
    update.manualTasks = buildManualTaskEntries(payload.manualTasks);
  }

  if ('shownTasks' in payload) {
    update.shownTasks = buildShownTasks(payload.shownTasks);
  }

  if ('taskMetadata' in payload) {
    update.taskMetadata = buildTaskMetadataEntries(payload.taskMetadata, referralId);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  await connectMongo();

  const doc = await FollowUpTaskState.findOneAndUpdate(
    { referralId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<{
    completions?: unknown;
    manualTasks?: unknown;
    shownTasks?: unknown;
    taskMetadata?: unknown;
  }>();

  return NextResponse.json({ referralId, state: buildStateFromDocument(doc) }, { headers: NO_CACHE_HEADERS });
}
