import { NextRequest, NextResponse } from 'next/server';
import { addDays, endOfDay, endOfMonth, startOfMonth, startOfWeek, startOfYear, subDays } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';

const METRIC_LABELS: Record<string, string> = {
  summary: 'Executive summary',
  revenue: 'Revenue trends & expected revenue',
  deals: 'Deals closed, pipeline, and under contract',
  funnel: 'Conversion funnel by stage',
  attachRate: 'AFC/AHA attach rates and lost deals',
  preApprovals: 'Pre-approval conversion by lender',
  geography: 'Revenue by geography and ZIP',
  network: 'Network filters (All / My Network)',
  termination: 'Terminated deals & lost referral fees'
};

type DashboardMetricId = keyof typeof METRIC_LABELS;

type ReportPayload = {
  reportName: string;
  reportTimeframe: string;
  customStartDate?: string;
  customEndDate?: string;
  metrics: DashboardMetricId[];
  recipient: string;
};

type DateRange = { start?: Date; end?: Date };

const CLOSED_DEAL_STATUSES = new Set(['closed', 'payment_sent', 'paid']);

function resolveDateRange(payload: ReportPayload): DateRange {
  const now = new Date();
  switch (payload.reportTimeframe) {
    case 'This week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6)) };
    case 'This month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'Last 90 days':
      return { start: subDays(now, 90), end: endOfDay(now) };
    case 'Year to date':
      return { start: startOfYear(now), end: endOfDay(now) };
    case 'All':
      return {};
    case 'Custom export window': {
      const start = payload.customStartDate ? new Date(payload.customStartDate) : undefined;
      const end = payload.customEndDate ? endOfDay(new Date(payload.customEndDate)) : undefined;
      return { start, end };
    }
    default:
      return {};
  }
}

function formatCurrency(cents: number | null | undefined): string {
  if (!cents) return '$0';
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

async function computeMetrics(range: DateRange) {
  const referralMatch: Record<string, any> = { deletedAt: null };
  const paymentMatch: Record<string, any> = {};

  if (range.start || range.end) {
    referralMatch.createdAt = {} as Record<string, Date>;
    paymentMatch.createdAt = {} as Record<string, Date>;
    if (range.start) {
      referralMatch.createdAt.$gte = range.start;
      paymentMatch.createdAt.$gte = range.start;
    }
    if (range.end) {
      referralMatch.createdAt.$lte = range.end;
      paymentMatch.createdAt.$lte = range.end;
    }
  }

  const ACTIVE_PIPELINE_STATUSES = new Set([
    'Paired',
    'In Communication',
    'Active Lead',
    'Showing Homes',
    'Under Contract'
  ]);

  const [referrals, payments] = await Promise.all([
    Referral.find(referralMatch)
      .select('status referralFeeDueCents referralFeeBasisPoints closedPriceCents assignedAgent ahaBucket preApprovalAmountCents propertyState')
      .populate('assignedAgent', 'name')
      .lean(),
    Payment.find(paymentMatch)
      .select('status receivedAmountCents expectedAmountCents terminatedReason agentAttribution usedAssignedAgent createdAt')
      .populate({ path: 'referralId', select: 'referralFeeBasisPoints closedPriceCents assignedAgent', populate: { path: 'assignedAgent', select: 'name' } })
      .lean()
  ]);

  const totalReferrals = referrals.length;
  const closedReferrals = referrals.filter((referral) => referral.status === 'Closed').length;
  const closeRate = totalReferrals === 0 ? 0 : (closedReferrals / totalReferrals) * 100;

  const expectedRevenueCents = payments
    .filter((payment) =>
      ['under_contract', 'past_inspection', 'past_appraisal', 'clear_to_close', 'closed', 'payment_sent'].includes(
        payment.status
      )
    )
    .reduce((sum, payment) => sum + (payment.expectedAmountCents ?? 0), 0);

  const revenueReceivedCents = payments
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + (payment.receivedAmountCents ?? 0), 0);

  const activePipeline = referrals.filter(
    (referral) => ACTIVE_PIPELINE_STATUSES.has(referral.status ?? '')
  ).length;

  const closedOrPaidPayments = payments.filter(
    (p) => CLOSED_DEAL_STATUSES.has(p.status) && p.agentAttribution !== 'OUTSIDE_AGENT'
  );
  const attachRate = closedOrPaidPayments.length === 0
    ? 0
    : (closedOrPaidPayments.filter((p) => (p as any).usedAssignedAgent === true).length / closedOrPaidPayments.length) * 100;

  const preApprovals = referrals.filter((referral) => (referral.preApprovalAmountCents ?? 0) > 0).length;

  const geography = referrals.reduce<Record<string, number>>((acc, referral) => {
    const state = referral.propertyState || 'Unknown';
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, {});

  const network = referrals.reduce(
    (acc, referral) => {
      const bucket = referral.ahaBucket || 'Unspecified';
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const termination = payments
    .filter((payment) => payment.status === 'terminated')
    .reduce<Record<string, number>>((acc, payment) => {
      const reason = payment.terminatedReason || 'unknown';
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  const funnelOrder = ['New Lead', 'Paired', 'In Communication', 'Active Lead', 'Under Contract', 'Closed', 'Lost', 'Terminated'];
  const funnel = funnelOrder.reduce<Record<string, number>>((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});
  referrals.forEach((referral) => {
    const s = referral.status === 'Showing Homes' ? 'Active Lead' : (referral.status ?? 'New Lead');
    if (funnel[s] !== undefined) funnel[s] += 1;
  });

  return {
    summary: { totalReferrals, closedReferrals, closeRate, expectedRevenueCents, revenueReceivedCents },
    revenue: { expectedRevenueCents, revenueReceivedCents },
    deals: { activePipeline, closedReferrals },
    funnel: { stages: funnel },
    attachRate: { attachRate },
    preApprovals: { count: preApprovals },
    geography,
    network,
    termination
  };
}

type MetricsData = Awaited<ReturnType<typeof computeMetrics>>;

const formatRecordList = (record: Record<string, number>, fallback: string): string => {
  const entries = Object.entries(record);
  return entries.length > 0
    ? entries.map(([key, count]) => `${key}: ${count}`).join('<br/>')
    : fallback;
};

const metricRenderers: Record<DashboardMetricId, (m: MetricsData) => string> = {
  summary: (m) => `
    <h3>${METRIC_LABELS.summary}</h3>
    <ul>
      <li>Total referrals: ${m.summary.totalReferrals}</li>
      <li>Closed referrals: ${m.summary.closedReferrals}</li>
      <li>Close rate: ${m.summary.closeRate.toFixed(1)}%</li>
      <li>Expected revenue: ${formatCurrency(m.summary.expectedRevenueCents)}</li>
      <li>Revenue received: ${formatCurrency(m.summary.revenueReceivedCents)}</li>
    </ul>`,
  revenue: (m) => `
    <h3>${METRIC_LABELS.revenue}</h3>
    <ul>
      <li>Expected revenue: ${formatCurrency(m.revenue.expectedRevenueCents)}</li>
      <li>Revenue received: ${formatCurrency(m.revenue.revenueReceivedCents)}</li>
    </ul>`,
  deals: (m) => `
    <h3>${METRIC_LABELS.deals}</h3>
    <ul>
      <li>Active pipeline: ${m.deals.activePipeline}</li>
      <li>Closed deals: ${m.deals.closedReferrals}</li>
    </ul>`,
  funnel: (m) => `
    <h3>${METRIC_LABELS.funnel}</h3>
    <ul>
      ${Object.entries(m.funnel.stages)
        .map(([status, count]) => `<li>${status}: ${count}</li>`)
        .join('\n      ')}
    </ul>`,
  attachRate: (m) => `
    <h3>${METRIC_LABELS.attachRate}</h3>
    <p>Agent attach rate: ${m.attachRate.attachRate.toFixed(1)}%</p>`,
  preApprovals: (m) => `
    <h3>${METRIC_LABELS.preApprovals}</h3>
    <p>Pre-approvals recorded: ${m.preApprovals.count}</p>`,
  geography: (m) => `
    <h3>${METRIC_LABELS.geography}</h3>
    <p>${formatRecordList(m.geography, 'No geography data available.')}</p>`,
  network: (m) => `
    <h3>${METRIC_LABELS.network}</h3>
    <p>${formatRecordList(m.network, 'No network data available.')}</p>`,
  termination: (m) => `
    <h3>${METRIC_LABELS.termination}</h3>
    <p>${formatRecordList(m.termination, 'No terminated deals recorded.')}</p>`,
};

function buildHtmlReport(payload: ReportPayload, metrics: MetricsData) {
  const sections = payload.metrics
    .map((metric) => metricRenderers[metric]?.(metrics))
    .filter(Boolean);

  const reportWindow = payload.reportTimeframe === 'Custom export window'
    ? `${payload.customStartDate || 'Start'} to ${payload.customEndDate || 'End'}`
    : payload.reportTimeframe;

  return `
    <div>
      <h2>${payload.reportName}</h2>
      <p>Timeframe: ${reportWindow}</p>
      ${sections.join('\n')}
    </div>
  `;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json()) as ReportPayload;

  if (!payload.metrics?.length) {
    return new NextResponse('Select at least one metric to include.', { status: 400 });
  }

  if (!payload.recipient) {
    return new NextResponse('Recipient email is required.', { status: 400 });
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

  const range = resolveDateRange(payload);
  const metrics = await computeMetrics(range);

  const html = buildHtmlReport(payload, metrics);
  const text = `${payload.reportName} (${payload.reportTimeframe})\n${payload.metrics
    .map((metric) => METRIC_LABELS[metric] || metric)
    .join(', ')}`;

  const delivered = await sendTransactionalEmail({
    to: [payload.recipient],
    subject: `${payload.reportName} metrics`,
    html,
    text
  });

  if (!delivered) {
    return new NextResponse('Unable to send dashboard report email.', { status: 500 });
  }

  return NextResponse.json({ success: true });
}
