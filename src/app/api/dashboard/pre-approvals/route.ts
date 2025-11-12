import { NextRequest, NextResponse } from 'next/server';
import { isValid, parseISO, startOfMonth } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { PreApprovalMetric } from '@/models/pre-approval-metric';
import type { PreApprovalMetricDocument } from '@/models/pre-approval-metric';

export async function GET(): Promise<NextResponse> {
  await connectMongo();
  const session = await getCurrentSession();

  if (!session || session.user?.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const metrics = await PreApprovalMetric.find()
    .sort({ month: -1 })
    .lean<PreApprovalMetricDocument[]>();

  return NextResponse.json(
    metrics.map((metric) => ({
      id: metric._id.toString(),
      month: metric.month,
      preApprovals: metric.preApprovals,
      updatedAt: metric.updatedAt
    }))
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  await connectMongo();
  const session = await getCurrentSession();

  if (!session || session.user?.role !== 'admin' || !session.user?.id) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json();
  const rawMonth = typeof body.month === 'string' ? body.month : '';
  const preApprovals = Number(body.preApprovals);

  if (!rawMonth) {
    return NextResponse.json({ error: 'Month is required' }, { status: 400 });
  }

  if (!Number.isFinite(preApprovals) || preApprovals < 0) {
    return NextResponse.json({ error: 'Pre-approvals must be a non-negative number' }, { status: 400 });
  }

  const parsed = parseISO(`${rawMonth}-01`);
  if (!isValid(parsed)) {
    return NextResponse.json({ error: 'Invalid month provided' }, { status: 400 });
  }

  const monthStart = startOfMonth(parsed);

  const metric = await PreApprovalMetric.findOneAndUpdate(
    { month: monthStart },
    {
      month: monthStart,
      preApprovals,
      createdBy: session.user.id,
      updatedBy: session.user.id
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<PreApprovalMetricDocument>();

  if (!metric) {
    return NextResponse.json({ error: 'Unable to save pre-approval metric' }, { status: 500 });
  }

  return NextResponse.json({
    id: metric._id.toString(),
    month: metric.month,
    preApprovals: metric.preApprovals,
    updatedAt: metric.updatedAt
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  await connectMongo();
  const session = await getCurrentSession();

  if (!session || session.user?.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawMonth = typeof body.month === 'string' ? body.month : '';

  if (!rawMonth) {
    return NextResponse.json({ error: 'Month is required' }, { status: 400 });
  }

  const parsed = parseISO(`${rawMonth}-01`);
  if (!isValid(parsed)) {
    return NextResponse.json({ error: 'Invalid month provided' }, { status: 400 });
  }

  const monthStart = startOfMonth(parsed);

  const deleted = await PreApprovalMetric.findOneAndDelete({ month: monthStart });

  if (!deleted) {
    return NextResponse.json({ error: 'Pre-approval metric not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
