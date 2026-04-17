import { addDays, endOfDay, endOfMonth, startOfMonth, startOfWeek, startOfYear, subDays } from 'date-fns';
import { Types } from 'mongoose';

import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

export const DASHBOARD_REPORT_METRICS = [
  { id: 'summary', label: 'Executive summary' },
  { id: 'revenue', label: 'Revenue trend by period' },
  { id: 'deals', label: 'Deals closed, pipeline, and under contract' },
  { id: 'funnel', label: 'Conversion funnel by stage' },
  { id: 'attachRate', label: 'AFC and agent attach rates' },
  { id: 'preApprovals', label: 'Mortgage consultant transfers' },
  { id: 'geography', label: 'Revenue by state' },
  { id: 'network', label: 'Network breakdown (AHA / AHA OOS / AFC / Unpaired)' },
  { id: 'termination', label: 'Terminated deals & lost referral fees' }
] as const;

export type DashboardReportMetricId = (typeof DASHBOARD_REPORT_METRICS)[number]['id'];

const METRIC_LABEL_MAP: Record<DashboardReportMetricId, string> = DASHBOARD_REPORT_METRICS.reduce(
  (acc, m) => ({ ...acc, [m.id]: m.label }),
  {} as Record<DashboardReportMetricId, string>
);

export type DashboardReportTimeframe =
  | 'This week'
  | 'This month'
  | 'Last 90 days'
  | 'Year to date'
  | 'All'
  | 'Custom export window';

export type NetworkFilter = 'ALL' | 'AHA' | 'AHA_OOS';

export type BuildDashboardReportInput = {
  reportName: string;
  reportTimeframe: DashboardReportTimeframe | string;
  customStartDate?: string;
  customEndDate?: string;
  metrics: DashboardReportMetricId[];
  network?: NetworkFilter;
  /** Public origin for internal /api/dashboard fetch. */
  origin: string;
  /** Auth context used to call /api/dashboard. */
  auth: { kind: 'cookie'; cookie: string } | { kind: 'cron'; cronSecret: string };
};

export type ReportRow = { label: string; value: string };
export type ReportSection = {
  id: DashboardReportMetricId;
  title: string;
  rows: ReportRow[];
  emptyMessage?: string;
};

export type BuildDashboardReportResult = {
  reportName: string;
  windowLabel: string;
  range: { start: Date | null; end: Date | null };
  sections: ReportSection[];
  html: string;
  text: string;
  csv: string;
};

type DashboardApiResponse = {
  main?: {
    summary?: {
      totalReferrals?: number;
      dealsClosed?: number;
      dealsClosedInTimeframe?: number;
      dealsUnderContract?: number;
      pendingClosings?: number;
      closeRate?: number;
      activePipeline?: number;
      expectedRevenueCents?: number;
      realizedRevenueCents?: number;
      generatedRevenueCents?: number;
      pipelineValueCents?: number;
      lostReferrals?: number;
      afcAttachRate?: number;
      afcDealsLost?: number;
      ahaAttachRate?: number;
      ahaDealsLost?: number;
      ahaOosAttachRate?: number;
      ahaOosDealsLost?: number;
    };
    funnel?: { stages?: { status: string; count: number }[] };
    revenueByState?: { label: string; value: number }[];
    trends?: {
      revenue?: { key: string; label: string; value: number }[];
    };
    terminatedDeals?: {
      breakdown?: { label: string; value: number; percentage?: number }[];
      totalDeals?: number;
      totalLostReferralFeeCents?: number;
    };
  };
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

function resolveDateRange(
  reportTimeframe: string,
  customStartDate?: string,
  customEndDate?: string
): { start: Date | null; end: Date | null } {
  const now = new Date();
  switch (reportTimeframe) {
    case 'This week': {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      return { start, end: endOfDay(addDays(start, 6)) };
    }
    case 'This month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'Last 90 days':
      return { start: subDays(now, 90), end: endOfDay(now) };
    case 'Year to date':
      return { start: startOfYear(now), end: endOfDay(now) };
    case 'All':
      return { start: null, end: null };
    case 'Custom export window': {
      const start = customStartDate ? new Date(customStartDate) : null;
      const end = customEndDate ? endOfDay(new Date(customEndDate)) : null;
      return { start, end };
    }
    default:
      return { start: null, end: null };
  }
}

function reportTimeframeToDashboardKey(reportTimeframe: string): string {
  switch (reportTimeframe) {
    case 'This week':
      return 'week';
    case 'This month':
      return 'month';
    case 'Year to date':
      return 'ytd';
    case 'All':
      return 'all';
    case 'Last 90 days':
    case 'Custom export window':
    default:
      return 'custom';
  }
}

function formatCents(cents: number | null | undefined): string {
  if (!cents) return '$0';
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

async function fetchDashboardData(input: BuildDashboardReportInput): Promise<DashboardApiResponse> {
  const runId = `dashboard-build-${Date.now()}`;
  const url = new URL(`${input.origin.replace(/\/$/, '')}/api/dashboard`);
  const dashboardKey = reportTimeframeToDashboardKey(input.reportTimeframe);
  url.searchParams.set('timeframe', dashboardKey);
  url.searchParams.set('network', input.network ?? 'ALL');

  const range = resolveDateRange(input.reportTimeframe, input.customStartDate, input.customEndDate);
  if (dashboardKey === 'custom') {
    if (range.start) url.searchParams.set('start', range.start.toISOString());
    if (range.end) url.searchParams.set('end', range.end.toISOString());
  }

  const headers: Record<string, string> = {};
  if (input.auth.kind === 'cookie') {
    headers.cookie = input.auth.cookie;
  } else {
    headers.authorization = `Bearer ${input.auth.cronSecret}`;
  }
  debugLog({
    runId,
    hypothesisId: 'H3',
    location: 'src/lib/server/dashboard-report.ts:196',
    message: 'Calling /api/dashboard for dashboard report',
    data: {
      dashboardUrl: url.toString(),
      authKind: input.auth.kind,
      hasCookie: input.auth.kind === 'cookie' ? input.auth.cookie.length > 0 : false,
      cookieLength: input.auth.kind === 'cookie' ? input.auth.cookie.length : 0,
      hasAuthHeader: Boolean(headers.authorization),
      timeframeKey: dashboardKey
    }
  });

  const response = await fetch(url.toString(), { headers, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    debugLog({
      runId,
      hypothesisId: 'H4',
      location: 'src/lib/server/dashboard-report.ts:214',
      message: 'Dashboard API returned non-OK response',
      data: {
        status: response.status,
        statusText: response.statusText,
        bodyPreview: body.slice(0, 400)
      }
    });
    throw new Error(`Failed to load dashboard data (${response.status}): ${body}`);
  }
  return (await response.json()) as DashboardApiResponse;
}

type ReferralLite = {
  _id: Types.ObjectId;
  status?: string;
  org?: 'AFC' | 'AHA';
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  origin?: string;
  lender?: Types.ObjectId | null;
  assignedAgent?: Types.ObjectId | null;
};

async function buildNetworkBreakdown(range: {
  start: Date | null;
  end: Date | null;
}): Promise<Record<'AHA' | 'AHA OOS' | 'AFC' | 'Unpaired', number>> {
  const referralMatch: Record<string, unknown> = { deletedAt: null };
  if (range.start || range.end) {
    const window: Record<string, Date> = {};
    if (range.start) window.$gte = range.start;
    if (range.end) window.$lte = range.end;
    referralMatch.createdAt = window;
  }

  const referrals = await Referral.find(referralMatch)
    .select('lender ahaBucket org assignedAgent')
    .lean<ReferralLite[]>();

  const agentIds = Array.from(
    new Set(
      referrals
        .map((r) => r.assignedAgent?.toString())
        .filter((id): id is string => Boolean(id))
    )
  );

  const designationMap = new Map<string, 'AHA' | 'AHA_OOS' | 'AGIT' | null>();
  if (agentIds.length > 0) {
    const agents = await Agent.find({ _id: { $in: agentIds.map((id) => new Types.ObjectId(id)) } })
      .select('ahaDesignation')
      .lean<{ _id: Types.ObjectId; ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null }[]>();
    agents.forEach((agent) => {
      designationMap.set(agent._id.toString(), agent.ahaDesignation ?? null);
    });
  }

  const buckets: Record<'AHA' | 'AHA OOS' | 'AFC' | 'Unpaired', number> = {
    AHA: 0,
    'AHA OOS': 0,
    AFC: 0,
    Unpaired: 0
  };

  for (const referral of referrals) {
    if (!referral.lender) {
      buckets.Unpaired += 1;
      continue;
    }
    const designation = referral.assignedAgent
      ? designationMap.get(referral.assignedAgent.toString()) ?? null
      : null;
    if (designation === 'AHA_OOS') {
      buckets['AHA OOS'] += 1;
      continue;
    }
    if (designation === 'AHA') {
      buckets.AHA += 1;
      continue;
    }
    if (referral.ahaBucket === 'AHA_OOS') {
      buckets['AHA OOS'] += 1;
      continue;
    }
    if (referral.ahaBucket === 'AHA' || referral.org === 'AHA') {
      buckets.AHA += 1;
      continue;
    }
    buckets.AFC += 1;
  }

  return buckets;
}

type LenderLite = { _id: Types.ObjectId; name: string };

async function buildMcTransfers(range: {
  start: Date | null;
  end: Date | null;
}): Promise<{ name: string; transfers: number }[]> {
  const match: Record<string, unknown> = {
    deletedAt: null,
    origin: 'admin',
    lender: { $ne: null }
  };
  if (range.start || range.end) {
    const window: Record<string, Date> = {};
    if (range.start) window.$gte = range.start;
    if (range.end) window.$lte = range.end;
    match.createdAt = window;
  }

  const grouped = await Referral.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: match },
    { $group: { _id: '$lender', total: { $sum: 1 } } }
  ]);

  if (grouped.length === 0) return [];

  const lenderIds = grouped.map((entry) => entry._id);
  const lenders = await LenderMC.find({ _id: { $in: lenderIds } })
    .select('name')
    .lean<LenderLite[]>();
  const nameMap = new Map(lenders.map((lender) => [lender._id.toString(), lender.name]));

  return grouped
    .map((entry) => ({
      name: nameMap.get(entry._id.toString()) ?? 'Unknown MC',
      transfers: entry.total
    }))
    .sort((a, b) => b.transfers - a.transfers || a.name.localeCompare(b.name));
}

async function countReferralsEnteredUnderContract(range: {
  start: Date | null;
  end: Date | null;
}): Promise<number> {
  if (!range.start && !range.end) {
    const ids = await Payment.distinct('referralId', { underContractDate: { $ne: null } });
    return ids.length;
  }
  const window: Record<string, Date> = {};
  if (range.start) window.$gte = range.start;
  if (range.end) window.$lte = range.end;
  const ids = await Payment.distinct('referralId', { underContractDate: window });
  return ids.length;
}

function describeWindow(input: BuildDashboardReportInput): string {
  if (input.reportTimeframe === 'Custom export window') {
    const start = input.customStartDate || 'Start';
    const end = input.customEndDate || 'End';
    return `${start} to ${end}`;
  }
  return String(input.reportTimeframe);
}

function buildSections(args: {
  metrics: DashboardReportMetricId[];
  dashboard: DashboardApiResponse;
  network: Record<'AHA' | 'AHA OOS' | 'AFC' | 'Unpaired', number>;
  mcTransfers: { name: string; transfers: number }[];
  referralsEnteredUnderContract: number;
}): ReportSection[] {
  const summary = args.dashboard.main?.summary ?? {};
  const sections: ReportSection[] = [];

  for (const metric of args.metrics) {
    switch (metric) {
      case 'summary': {
        sections.push({
          id: 'summary',
          title: METRIC_LABEL_MAP.summary,
          rows: [
            { label: 'Total referrals', value: String(summary.totalReferrals ?? 0) },
            { label: 'Deals closed (in period)', value: String(summary.dealsClosedInTimeframe ?? summary.dealsClosed ?? 0) },
            { label: 'Referrals that entered Under Contract', value: String(args.referralsEnteredUnderContract) },
            { label: 'Close rate', value: formatPercent(summary.closeRate) },
            { label: 'Revenue received', value: formatCents(summary.realizedRevenueCents) },
            { label: 'Expected revenue (outstanding)', value: formatCents(summary.expectedRevenueCents) }
          ]
        });
        break;
      }
      case 'revenue': {
        const trend = args.dashboard.main?.trends?.revenue ?? [];
        sections.push({
          id: 'revenue',
          title: METRIC_LABEL_MAP.revenue,
          rows: trend.length
            ? trend.map((point) => ({ label: point.label, value: formatCents(point.value) }))
            : [],
          emptyMessage: 'No revenue received in this period.'
        });
        break;
      }
      case 'deals': {
        sections.push({
          id: 'deals',
          title: METRIC_LABEL_MAP.deals,
          rows: [
            { label: 'Active pipeline', value: String(summary.activePipeline ?? 0) },
            { label: 'Currently under contract', value: String(summary.dealsUnderContract ?? 0) },
            { label: 'Entered under contract in period', value: String(args.referralsEnteredUnderContract) },
            { label: 'Closed deals (in period)', value: String(summary.dealsClosedInTimeframe ?? summary.dealsClosed ?? 0) },
            { label: 'Pipeline value', value: formatCents(summary.pipelineValueCents) }
          ]
        });
        break;
      }
      case 'funnel': {
        const stages = args.dashboard.main?.funnel?.stages ?? [];
        sections.push({
          id: 'funnel',
          title: METRIC_LABEL_MAP.funnel,
          rows: stages.map((stage) => ({ label: stage.status, value: String(stage.count) })),
          emptyMessage: 'No funnel data available.'
        });
        break;
      }
      case 'attachRate': {
        sections.push({
          id: 'attachRate',
          title: METRIC_LABEL_MAP.attachRate,
          rows: [
            { label: 'AFC attach rate', value: formatPercent(summary.afcAttachRate) },
            { label: 'AFC deals lost (used outside lender)', value: String(summary.afcDealsLost ?? 0) },
            { label: 'AHA agent attach rate', value: formatPercent(summary.ahaAttachRate) },
            { label: 'AHA deals lost (used outside agent)', value: String(summary.ahaDealsLost ?? 0) },
            { label: 'AHA OOS agent attach rate', value: formatPercent(summary.ahaOosAttachRate) },
            { label: 'AHA OOS deals lost (used outside agent)', value: String(summary.ahaOosDealsLost ?? 0) }
          ]
        });
        break;
      }
      case 'preApprovals': {
        sections.push({
          id: 'preApprovals',
          title: METRIC_LABEL_MAP.preApprovals,
          rows: args.mcTransfers.map((entry) => ({
            label: entry.name,
            value: `${entry.transfers} transfer${entry.transfers === 1 ? '' : 's'}`
          })),
          emptyMessage: 'No mortgage consultant transfers in this period.'
        });
        break;
      }
      case 'geography': {
        const entries = (args.dashboard.main?.revenueByState ?? [])
          .filter((entry) => entry.value > 0 && entry.label && entry.label.toUpperCase() !== 'UNKNOWN')
          .sort((a, b) => b.value - a.value);
        sections.push({
          id: 'geography',
          title: METRIC_LABEL_MAP.geography,
          rows: entries.map((entry) => ({ label: entry.label, value: formatCents(entry.value) })),
          emptyMessage: 'No revenue received in this period.'
        });
        break;
      }
      case 'network': {
        const ordered: Array<keyof typeof args.network> = ['AHA', 'AHA OOS', 'AFC', 'Unpaired'];
        sections.push({
          id: 'network',
          title: METRIC_LABEL_MAP.network,
          rows: ordered.map((bucket) => ({ label: bucket, value: String(args.network[bucket]) }))
        });
        break;
      }
      case 'termination': {
        const breakdown = args.dashboard.main?.terminatedDeals?.breakdown ?? [];
        const totalLost = args.dashboard.main?.terminatedDeals?.totalLostReferralFeeCents ?? 0;
        const rows: ReportRow[] = breakdown.map((entry) => ({
          label: entry.label,
          value: `${entry.value} deal${entry.value === 1 ? '' : 's'}`
        }));
        if (totalLost > 0) {
          rows.push({ label: 'Lost referral fees (total)', value: formatCents(totalLost) });
        }
        sections.push({
          id: 'termination',
          title: METRIC_LABEL_MAP.termination,
          rows,
          emptyMessage: 'No terminated deals in this period.'
        });
        break;
      }
      default: {
        const _exhaustive: never = metric;
        void _exhaustive;
      }
    }
  }

  return sections;
}

function renderHtml(args: {
  reportName: string;
  windowLabel: string;
  network: NetworkFilter;
  sections: ReportSection[];
}): string {
  const sectionsHtml = args.sections
    .map((section) => {
      const body = section.rows.length
        ? `<table style="border-collapse:collapse;margin:6px 0 14px;"><tbody>${section.rows
            .map(
              (row) =>
                `<tr><td style="padding:4px 14px 4px 0;color:#475569;">${escapeHtml(
                  row.label
                )}</td><td style="padding:4px 0;font-weight:600;color:#0f172a;">${escapeHtml(
                  row.value
                )}</td></tr>`
            )
            .join('')}</tbody></table>`
        : `<p style="margin:6px 0 14px;color:#94a3b8;font-style:italic;">${escapeHtml(
            section.emptyMessage ?? 'No data available.'
          )}</p>`;
      return `<section><h3 style="margin:18px 0 4px;color:#0f172a;font-size:15px;">${escapeHtml(section.title)}</h3>${body}</section>`;
    })
    .join('');

  return `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:640px;">
      <h2 style="margin:0 0 4px;color:#0f172a;">${escapeHtml(args.reportName)}</h2>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;">Timeframe: ${escapeHtml(args.windowLabel)} &nbsp;&middot;&nbsp; Network: ${escapeHtml(args.network)}</p>
      ${sectionsHtml}
      <p style="margin-top:24px;color:#94a3b8;font-size:11px;">Generated by Referrio.</p>
    </div>
  `.trim();
}

function renderText(args: {
  reportName: string;
  windowLabel: string;
  network: NetworkFilter;
  sections: ReportSection[];
}): string {
  const lines: string[] = [];
  lines.push(args.reportName);
  lines.push(`Timeframe: ${args.windowLabel} | Network: ${args.network}`);
  lines.push('');
  for (const section of args.sections) {
    lines.push(section.title);
    lines.push('-'.repeat(section.title.length));
    if (section.rows.length === 0) {
      lines.push(section.emptyMessage ?? 'No data available.');
    } else {
      for (const row of section.rows) {
        lines.push(`${row.label}: ${row.value}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderCsv(args: {
  reportName: string;
  windowLabel: string;
  network: NetworkFilter;
  sections: ReportSection[];
}): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows: string[][] = [];
  rows.push(['Report', args.reportName]);
  rows.push(['Timeframe', args.windowLabel]);
  rows.push(['Network', args.network]);
  rows.push([]);
  for (const section of args.sections) {
    rows.push([section.title]);
    if (section.rows.length === 0) {
      rows.push([section.emptyMessage ?? 'No data available.']);
    } else {
      rows.push(['Metric', 'Value']);
      for (const row of section.rows) {
        rows.push([row.label, row.value]);
      }
    }
    rows.push([]);
  }
  return rows.map((row) => row.map((cell) => escape(cell ?? '')).join(',')).join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function buildDashboardReport(
  input: BuildDashboardReportInput
): Promise<BuildDashboardReportResult> {
  const range = resolveDateRange(input.reportTimeframe, input.customStartDate, input.customEndDate);
  const network = input.network ?? 'ALL';

  const needsNetworkBreakdown = input.metrics.includes('network');
  const needsMcTransfers = input.metrics.includes('preApprovals');
  const needsUcCount =
    input.metrics.includes('summary') || input.metrics.includes('deals');

  const [dashboard, networkBreakdown, mcTransfers, referralsEnteredUnderContract] = await Promise.all([
    fetchDashboardData(input),
    needsNetworkBreakdown
      ? buildNetworkBreakdown(range)
      : Promise.resolve({ AHA: 0, 'AHA OOS': 0, AFC: 0, Unpaired: 0 } as Record<
          'AHA' | 'AHA OOS' | 'AFC' | 'Unpaired',
          number
        >),
    needsMcTransfers ? buildMcTransfers(range) : Promise.resolve([] as { name: string; transfers: number }[]),
    needsUcCount ? countReferralsEnteredUnderContract(range) : Promise.resolve(0)
  ]);

  const sections = buildSections({
    metrics: input.metrics,
    dashboard,
    network: networkBreakdown,
    mcTransfers,
    referralsEnteredUnderContract
  });

  const windowLabel = describeWindow(input);
  const html = renderHtml({ reportName: input.reportName, windowLabel, network, sections });
  const text = renderText({ reportName: input.reportName, windowLabel, network, sections });
  const csv = renderCsv({ reportName: input.reportName, windowLabel, network, sections });

  return {
    reportName: input.reportName,
    windowLabel,
    range,
    sections,
    html,
    text,
    csv
  };
}
