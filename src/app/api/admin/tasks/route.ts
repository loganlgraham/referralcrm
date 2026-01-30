import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as {
      status?: number;
      message?: string;
    };
    return new NextResponse(message, { status });
  }

  await connectMongo();

  const { searchParams } = new URL(request.url);
  const referralId = searchParams.get('referralId');
  const status = searchParams.get('status') ?? 'open';

  const filter: Record<string, unknown> = {};
  if (referralId) filter.referralId = referralId;
  if (status) filter.status = status;

  const tasks = await AdminTask.find(filter)
    .sort({ dueAt: 1, createdAt: 1 })
    .lean<AdminTaskLean[]>();

  const withEffectiveDue = tasks.map((task) => {
    const effectiveDue = getEffectiveDueDate(task);
    return {
      ...task,
      _id: task._id.toString(),
      referralId: task.referralId.toString(),
      effectiveDueAt: effectiveDue ? effectiveDue.toISOString() : null,
    };
  });

  return NextResponse.json(withEffectiveDue, { headers: NO_CACHE_HEADERS });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await connectMongo();

  const body = await request.json();
  const referralId = body.referralId;
  const title = body.title?.trim();
  const description = body.description?.trim();
  const category = body.category;
  const priority = body.priority ?? 'medium';
  const dueAt = body.dueAt ? new Date(body.dueAt) : undefined;

  if (!referralId || !title) {
    return NextResponse.json(
      { error: 'referralId and title are required' },
      { status: 400 }
    );
  }

  const task = await AdminTask.create({
    referralId,
    title,
    description: description || undefined,
    category: category || undefined,
    priority: priority || 'medium',
    status: 'open',
    dueAt: dueAt ?? undefined,
    ruleKey: null,
    cycleKey: 'once',
    createdBy: session.user.id,
    updatedBy: session.user.id,
  });

  const lean = task.toObject() as AdminTaskLean;
  const effectiveDue = getEffectiveDueDate(lean);

  return NextResponse.json(
    {
      ...lean,
      _id: lean._id.toString(),
      referralId: lean.referralId.toString(),
      effectiveDueAt: effectiveDue ? effectiveDue.toISOString() : null,
    },
    { status: 201, headers: NO_CACHE_HEADERS }
  );
}
