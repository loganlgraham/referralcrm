import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';
import { Referral } from '@/models/referral';
import type { ManualTask, ManualTaskInput, ManualTaskListResponse } from '@/types/follow-up-tasks';

interface RouteContext {
  params: { id: string };
}

const manualTaskSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  dueAt: z.string().trim().optional().or(z.null()),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  category: z.enum(['assignment', 'communication', 'pipeline', 'finance', 'ops']),
});

const mapManualTasks = (tasks: ManualTask[] | undefined | null): ManualTask[] =>
  Array.isArray(tasks)
    ? tasks.map((task) => ({
        ...task,
        dueAt: task.dueAt ?? null,
      }))
    : [];

const buildResponse = (tasks: ManualTask[]): ManualTaskListResponse => ({
  tasks,
});

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await connectMongo();
  const referral = await Referral.findById(context.params.id)
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

  const tasks = mapManualTasks(referral.manualTasks);
  return NextResponse.json(buildResponse(tasks));
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = manualTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(context.params.id)
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

  const payload: ManualTaskInput = parsed.data;
  const task: ManualTask = {
    id: randomUUID(),
    title: payload.title,
    message: payload.message,
    dueAt: payload.dueAt ?? null,
    priority: payload.priority,
    category: payload.category,
    createdAt: new Date().toISOString(),
  };

  referral.manualTasks = Array.isArray(referral.manualTasks) ? referral.manualTasks : [];
  referral.manualTasks.push(task);
  await referral.save();

  const tasks = mapManualTasks(referral.manualTasks);
  return NextResponse.json(buildResponse(tasks));
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
  }

  await connectMongo();
  const referral = await Referral.findById(context.params.id)
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

  const tasks = mapManualTasks(referral.manualTasks);
  const nextTasks = tasks.filter((task) => task.id !== taskId);
  referral.manualTasks = nextTasks;
  await referral.save();

  return NextResponse.json(buildResponse(nextTasks));
}
