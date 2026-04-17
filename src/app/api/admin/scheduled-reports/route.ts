import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import {
  ScheduledReport,
  computeNextRunAt,
  type ScheduledReportCadence
} from '@/models/scheduled-report';
import { DASHBOARD_REPORT_METRICS } from '@/lib/server/dashboard-report';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_METRICS = new Set(DASHBOARD_REPORT_METRICS.map((m) => m.id));
const VALID_CADENCES: ScheduledReportCadence[] = ['daily', 'weekly', 'monthly'];
const VALID_NETWORKS = new Set(['ALL', 'AHA', 'AHA_OOS']);

type CreatePayload = {
  name?: string;
  reportName?: string;
  reportTimeframe?: string;
  customStartDate?: string;
  customEndDate?: string;
  metrics?: string[];
  network?: 'ALL' | 'AHA' | 'AHA_OOS';
  recipients?: string[] | string;
  cadence?: ScheduledReportCadence;
  attachCsv?: boolean;
  enabled?: boolean;
};

function parseRecipients(payload: CreatePayload): string[] {
  const raw: string[] = [];
  if (Array.isArray(payload.recipients)) raw.push(...payload.recipients);
  else if (typeof payload.recipients === 'string') raw.push(...payload.recipients.split(/[,;]/));
  return Array.from(new Set(raw.map((entry) => entry.trim()).filter(Boolean)));
}

export async function GET(): Promise<NextResponse> {
  await connectMongo();
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  const schedules = await ScheduledReport.find({})
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    schedules: schedules.map((schedule) => ({
      id: schedule._id.toString(),
      name: schedule.name,
      reportName: schedule.reportName,
      reportTimeframe: schedule.reportTimeframe,
      customStartDate: schedule.customStartDate ?? null,
      customEndDate: schedule.customEndDate ?? null,
      metrics: schedule.metrics,
      network: schedule.network,
      recipients: schedule.recipients,
      cadence: schedule.cadence,
      attachCsv: schedule.attachCsv,
      enabled: schedule.enabled,
      lastRunAt: schedule.lastRunAt ? schedule.lastRunAt.toISOString() : null,
      nextRunAt: schedule.nextRunAt.toISOString(),
      createdAt: schedule.createdAt?.toISOString?.() ?? null
    }))
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json()) as CreatePayload;

  await connectMongo();
  let session;
  try {
    session = await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  const cadence = payload.cadence;
  if (!cadence || !VALID_CADENCES.includes(cadence)) {
    return new NextResponse('Invalid cadence (use daily, weekly, or monthly).', { status: 400 });
  }

  const metrics = (payload.metrics ?? []).filter((m): m is string => Boolean(m) && VALID_METRICS.has(m as never));
  if (!metrics.length) {
    return new NextResponse('Select at least one metric to include.', { status: 400 });
  }

  const recipients = parseRecipients(payload);
  if (recipients.length === 0) {
    return new NextResponse('At least one recipient email is required.', { status: 400 });
  }
  const invalid = recipients.filter((email) => !EMAIL_REGEX.test(email));
  if (invalid.length > 0) {
    return new NextResponse(`Invalid recipient email(s): ${invalid.join(', ')}`, { status: 400 });
  }

  const network: 'ALL' | 'AHA' | 'AHA_OOS' = VALID_NETWORKS.has(payload.network ?? 'ALL')
    ? (payload.network ?? 'ALL')
    : 'ALL';

  const name = payload.name?.trim() || `${cadence} schedule`;
  const reportName = payload.reportName?.trim() || 'Performance dashboard export';

  const created = await ScheduledReport.create({
    name,
    reportName,
    reportTimeframe: payload.reportTimeframe || 'This month',
    customStartDate: payload.customStartDate || null,
    customEndDate: payload.customEndDate || null,
    metrics,
    network,
    recipients,
    cadence,
    attachCsv: Boolean(payload.attachCsv),
    enabled: payload.enabled !== false,
    nextRunAt: computeNextRunAt(cadence),
    createdBy: session.user?.id ?? session.user?.email ?? null
  });

  return NextResponse.json({
    schedule: {
      id: created._id.toString(),
      name: created.name,
      cadence: created.cadence,
      nextRunAt: created.nextRunAt.toISOString(),
      enabled: created.enabled
    }
  });
}
