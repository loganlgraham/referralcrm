import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { ScheduledReport, computeNextRunAt } from '@/models/scheduled-report';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PatchPayload = {
  name?: string;
  reportName?: string;
  reportTimeframe?: string;
  customStartDate?: string | null;
  customEndDate?: string | null;
  metrics?: string[];
  network?: 'ALL' | 'AHA' | 'AHA_OOS';
  recipients?: string[] | string;
  cadence?: 'daily' | 'weekly' | 'monthly';
  attachCsv?: boolean;
  enabled?: boolean;
};

export async function PATCH(request: NextRequest, context: { params: { id: string } }): Promise<NextResponse> {
  const { id } = context.params;
  if (!Types.ObjectId.isValid(id)) {
    return new NextResponse('Invalid schedule id', { status: 400 });
  }

  await connectMongo();
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  const payload = (await request.json()) as PatchPayload;
  const update: Record<string, unknown> = {};

  if (payload.name !== undefined) update.name = String(payload.name).trim();
  if (payload.reportName !== undefined) update.reportName = String(payload.reportName).trim();
  if (payload.reportTimeframe !== undefined) update.reportTimeframe = payload.reportTimeframe;
  if (payload.customStartDate !== undefined) update.customStartDate = payload.customStartDate;
  if (payload.customEndDate !== undefined) update.customEndDate = payload.customEndDate;
  if (payload.metrics !== undefined) update.metrics = payload.metrics;
  if (payload.network !== undefined) update.network = payload.network;
  if (payload.attachCsv !== undefined) update.attachCsv = Boolean(payload.attachCsv);
  if (payload.enabled !== undefined) update.enabled = Boolean(payload.enabled);

  if (payload.recipients !== undefined) {
    const list = Array.isArray(payload.recipients)
      ? payload.recipients
      : String(payload.recipients).split(/[,;]/);
    const cleaned = Array.from(new Set(list.map((entry) => entry.trim()).filter(Boolean)));
    const invalid = cleaned.filter((email) => !EMAIL_REGEX.test(email));
    if (invalid.length > 0) {
      return new NextResponse(`Invalid recipient email(s): ${invalid.join(', ')}`, { status: 400 });
    }
    update.recipients = cleaned;
  }

  if (payload.cadence !== undefined) {
    update.cadence = payload.cadence;
    update.nextRunAt = computeNextRunAt(payload.cadence);
  } else if (payload.enabled === true) {
    const existing = await ScheduledReport.findById(id).select('cadence nextRunAt').lean();
    if (existing && existing.nextRunAt && existing.nextRunAt <= new Date()) {
      update.nextRunAt = computeNextRunAt(existing.cadence);
    }
  }

  const updated = await ScheduledReport.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!updated) {
    return new NextResponse('Schedule not found', { status: 404 });
  }

  return NextResponse.json({ success: true, id: updated._id.toString() });
}

export async function DELETE(_request: NextRequest, context: { params: { id: string } }): Promise<NextResponse> {
  const { id } = context.params;
  if (!Types.ObjectId.isValid(id)) {
    return new NextResponse('Invalid schedule id', { status: 400 });
  }

  await connectMongo();
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  const deleted = await ScheduledReport.findByIdAndDelete(id);
  if (!deleted) {
    return new NextResponse('Schedule not found', { status: 404 });
  }
  return NextResponse.json({ success: true });
}
