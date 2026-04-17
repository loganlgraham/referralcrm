import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { ScheduledReport, computeNextRunAt } from '@/models/scheduled-report';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { getAppOrigin } from '@/lib/server/app-origin';
import {
  buildDashboardReport,
  type DashboardReportMetricId,
  type NetworkFilter
} from '@/lib/server/dashboard-report';

export const runtime = 'nodejs';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'dashboard-report';
}

/**
 * Hourly cron that fires due scheduled reports.
 * Schedules anchor at 7am America/Denver; this route filters by `nextRunAt <= now`
 * so the actual delivery occurs on the next hourly run after the anchor time.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 503 });
  }

  await connectMongo();

  const now = new Date();
  const due = await ScheduledReport.find({ enabled: true, nextRunAt: { $lte: now } });

  console.log(`[Scheduled Reports] Running ${due.length} due schedule(s) at ${now.toISOString()}`);

  const origin = getAppOrigin(request);
  const results: Array<{
    id: string;
    name: string;
    cadence: string;
    success: boolean;
    error?: string;
    nextRunAt?: string;
  }> = [];

  for (const schedule of due) {
    const id = schedule._id.toString();
    try {
      const report = await buildDashboardReport({
        reportName: schedule.reportName,
        reportTimeframe: schedule.reportTimeframe,
        customStartDate: schedule.customStartDate ?? undefined,
        customEndDate: schedule.customEndDate ?? undefined,
        metrics: schedule.metrics as DashboardReportMetricId[],
        network: schedule.network as NetworkFilter,
        origin,
        auth: { kind: 'cron', cronSecret }
      });

      const sent = await sendTransactionalEmail({
        to: schedule.recipients,
        subject: `${schedule.reportName} (${report.windowLabel})`,
        html: report.html,
        text: report.text,
        attachments: schedule.attachCsv
          ? [
              {
                filename: `${slugify(schedule.reportName)}-${new Date().toISOString().slice(0, 10)}.csv`,
                content: Buffer.from(report.csv, 'utf8')
              }
            ]
          : undefined
      });

      if (!sent) {
        throw new Error('Resend delivery failed');
      }

      const nextRunAt = computeNextRunAt(schedule.cadence, now);
      schedule.lastRunAt = now;
      schedule.nextRunAt = nextRunAt;
      await schedule.save();

      results.push({
        id,
        name: schedule.name,
        cadence: schedule.cadence,
        success: true,
        nextRunAt: nextRunAt.toISOString()
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduled Reports] Failed schedule ${id}:`, message);
      // Advance nextRunAt to avoid hot-looping on a permanently failing schedule.
      try {
        const nextRunAt = computeNextRunAt(schedule.cadence, now);
        schedule.nextRunAt = nextRunAt;
        await schedule.save();
      } catch (saveErr) {
        console.error(`[Scheduled Reports] Could not advance nextRunAt for ${id}:`, saveErr);
      }
      results.push({ id, name: schedule.name, cadence: schedule.cadence, success: false, error: message });
    }
  }

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    processed: results.length,
    results
  });
}
