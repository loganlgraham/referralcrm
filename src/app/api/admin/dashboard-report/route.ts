import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { getAppOrigin } from '@/lib/server/app-origin';
import {
  buildDashboardReport,
  type BuildDashboardReportInput,
  type DashboardReportMetricId,
  type NetworkFilter
} from '@/lib/server/dashboard-report';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ReportPayload = {
  reportName?: string;
  reportTimeframe?: string;
  customStartDate?: string;
  customEndDate?: string;
  metrics?: DashboardReportMetricId[];
  network?: NetworkFilter;
  /** Comma-separated string OR array of email addresses. */
  recipients?: string | string[];
  /** Backward-compat single recipient. */
  recipient?: string;
  attachCsv?: boolean;
};

function debugLog(payload: {
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  // #region agent log
  fetch('http://127.0.0.1:7872/ingest/da1edebc-eb15-457d-a553-87cb363ce371',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4be0fc'},body:JSON.stringify({sessionId:'4be0fc',runId:payload.runId,hypothesisId:payload.hypothesisId,location:payload.location,message:payload.message,data:payload.data ?? {},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

function parseRecipients(payload: ReportPayload): string[] {
  const raw: string[] = [];
  if (Array.isArray(payload.recipients)) {
    raw.push(...payload.recipients);
  } else if (typeof payload.recipients === 'string') {
    raw.push(...payload.recipients.split(/[,;]/));
  }
  if (payload.recipient) raw.push(payload.recipient);

  const cleaned = Array.from(
    new Set(raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
  );
  return cleaned;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runId = `dashboard-report-${Date.now()}`;
  const payload = (await request.json()) as ReportPayload;
  debugLog({
    runId,
    hypothesisId: 'H1',
    location: 'src/app/api/admin/dashboard-report/route.ts:59',
    message: 'Dashboard report request received',
    data: {
      requestUrl: request.url,
      hasRecipientsArray: Array.isArray(payload.recipients),
      hasLegacyRecipient: Boolean(payload.recipient),
      metricsCount: Array.isArray(payload.metrics) ? payload.metrics.length : 0,
      timeframe: payload.reportTimeframe ?? null,
      network: payload.network ?? null
    }
  });

  const metrics = (payload.metrics ?? []).filter(Boolean);
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

  await connectMongo();

  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  if (!isTransactionalEmailConfigured()) {
    return new NextResponse('Email is not configured for this environment.', { status: 503 });
  }

  const reportName = payload.reportName?.trim() || 'Performance dashboard export';
  const reportTimeframe = payload.reportTimeframe || 'This month';
  const network: NetworkFilter = payload.network ?? 'ALL';
  const attachCsv = Boolean(payload.attachCsv);

  const buildInput: BuildDashboardReportInput = {
    reportName,
    reportTimeframe,
    customStartDate: payload.customStartDate,
    customEndDate: payload.customEndDate,
    metrics,
    network,
    origin: getAppOrigin(request),
    auth: { kind: 'cookie', cookie: request.headers.get('cookie') ?? '' }
  };
  debugLog({
    runId,
    hypothesisId: 'H2',
    location: 'src/app/api/admin/dashboard-report/route.ts:117',
    message: 'Prepared build input for dashboard report',
    data: {
      origin: buildInput.origin,
      authKind: buildInput.auth.kind,
      hasCookie: buildInput.auth.cookie.length > 0,
      cookieLength: buildInput.auth.cookie.length,
      metrics: buildInput.metrics,
      reportTimeframe: buildInput.reportTimeframe
    }
  });

  let report;
  try {
    report = await buildDashboardReport(buildInput);
  } catch (err) {
    const error = err as Error;
    debugLog({
      runId,
      hypothesisId: 'H5',
      location: 'src/app/api/admin/dashboard-report/route.ts:133',
      message: 'Dashboard report build failed',
      data: {
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(err),
        errorStackFirstLine: error?.stack?.split('\n')[0] ?? null
      }
    });
    console.error('Failed to build dashboard report', err);
    return new NextResponse('Unable to build dashboard report.', { status: 500 });
  }

  const delivered = await sendTransactionalEmail({
    to: recipients,
    subject: `${reportName} (${report.windowLabel})`,
    html: report.html,
    text: report.text,
    attachments: attachCsv
      ? [
          {
            filename: `${slugify(reportName)}-${new Date().toISOString().slice(0, 10)}.csv`,
            content: report.csv
          }
        ]
      : undefined
  });

  if (!delivered) {
    return new NextResponse('Unable to send dashboard report email.', { status: 500 });
  }

  return NextResponse.json({ success: true, recipients, sections: report.sections.length });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'dashboard-report';
}
