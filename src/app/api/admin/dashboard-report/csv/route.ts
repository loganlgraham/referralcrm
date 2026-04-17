import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { getAppOrigin } from '@/lib/server/app-origin';
import {
  buildDashboardReport,
  type DashboardReportMetricId,
  type NetworkFilter
} from '@/lib/server/dashboard-report';

type CsvPayload = {
  reportName?: string;
  reportTimeframe?: string;
  customStartDate?: string;
  customEndDate?: string;
  metrics?: DashboardReportMetricId[];
  network?: NetworkFilter;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'dashboard-report';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json()) as CsvPayload;
  const metrics = (payload.metrics ?? []).filter(Boolean);
  if (!metrics.length) {
    return new NextResponse('Select at least one metric to include.', { status: 400 });
  }

  await connectMongo();

  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  const reportName = payload.reportName?.trim() || 'Performance dashboard export';

  let report;
  try {
    report = await buildDashboardReport({
      reportName,
      reportTimeframe: payload.reportTimeframe || 'This month',
      customStartDate: payload.customStartDate,
      customEndDate: payload.customEndDate,
      metrics,
      network: payload.network ?? 'ALL',
      origin: getAppOrigin(request),
      auth: { kind: 'cookie', cookie: request.headers.get('cookie') ?? '' }
    });
  } catch (err) {
    console.error('Failed to build dashboard report CSV', err);
    return new NextResponse('Unable to build dashboard report CSV.', { status: 500 });
  }

  const filename = `${slugify(reportName)}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(report.csv, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
