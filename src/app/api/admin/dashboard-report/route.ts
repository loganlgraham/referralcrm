import { NextRequest, NextResponse } from 'next/server';
import { addDays, endOfDay, startOfMonth, startOfWeek, startOfYear, subDays } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';

const METRIC_LABELS: Record<string, string> = {
  summary: 'Executive summary',
  revenue: 'Revenue trends & expected revenue',
  deals: 'Deals closed, pipeline, and under contract',
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

function resolveDateRange(payload: ReportPayload): DateRange {
  const now = new Date();
  switch (payload.reportTimeframe) {
    case 'This week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6)) };
    case 'This month':
      return { start: startOfMonth(now), end: endOfDay(addDays(startOfMonth(now), 32)) };
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

  const [referrals, payments] = await Promise.all([
    Referral.find(referralMatch)
      .select('status referralFeeDueCents referralFeeBasisPoints closedPriceCents assignedAgent ahaBucket preApprovalAmountCents propertyState')
      .populate('assignedAgent', 'name')
      .lean(),
    Payment.find(paymentMatch)
      .select('status receivedAmountCents expectedAmountCents terminatedReason agentAttribution createdAt')
      .populate({ path: 'referralId', select: 'referralFeeBasisPoints closedPriceCents assignedAgent', populate: { path: 'assignedAgent', select: 'name' } })
      .lean()
  ]);

  const totalReferrals = referrals.length;
  const closedReferrals = referrals.filter((referral) => (referral.status ?? '').toLowerCase() === 'closed').length;
  const closeRate = totalReferrals === 0 ? 0 : (closedReferrals / totalReferrals) * 100;

  const expectedRevenueCents = payments
    .filter((payment) =>
      ['under_contract', 'past_inspection', 'past_appraisal', 'clear_to_close', 'closed', 'payment_sent'].includes(
        payment.status
      )
    )
    .reduce((sum, payment) => sum + (payment.receivedAmountCents ?? (payment as any).expectedAmountCents ?? 0), 0);

  const revenueReceivedCents = payments
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + (payment.receivedAmountCents ?? 0), 0);

  const activePipeline = referrals.filter(
    (referral) => !['Closed', 'Lost', 'Terminated'].includes(referral.status ?? '')
  ).length;

  const attachRate = totalReferrals === 0
    ? 0
    : (referrals.filter((referral) => referral.assignedAgent != null).length / totalReferrals) * 100;

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

  return {
    summary: { totalReferrals, closedReferrals, closeRate, expectedRevenueCents, revenueReceivedCents },
    revenue: { expectedRevenueCents, revenueReceivedCents },
    deals: { activePipeline, closedReferrals },
    attachRate: { attachRate },
    preApprovals: { count: preApprovals },
    geography,
    network,
    termination
  };
}

function buildHtmlReport(payload: ReportPayload, metrics: Awaited<ReturnType<typeof computeMetrics>>) {
  const sections: string[] = [];

  payload.metrics.forEach((metric) => {
    const label = METRIC_LABELS[metric] ?? metric;
    switch (metric) {
      case 'summary':
        sections.push(`
          <h3>${label}</h3>
          <ul>
            <li>Total referrals: ${metrics.summary.totalReferrals}</li>
            <li>Closed referrals: ${metrics.summary.closedReferrals}</li>
            <li>Close rate: ${metrics.summary.closeRate.toFixed(1)}%</li>
            <li>Expected revenue: ${formatCurrency(metrics.summary.expectedRevenueCents)}</li>
            <li>Revenue received: ${formatCurrency(metrics.summary.revenueReceivedCents)}</li>
          </ul>
        `);
        break;
      case 'revenue':
        sections.push(`
          <h3>${label}</h3>
          <ul>
            <li>Expected revenue: ${formatCurrency(metrics.revenue.expectedRevenueCents)}</li>
            <li>Revenue received: ${formatCurrency(metrics.revenue.revenueReceivedCents)}</li>
          </ul>
        `);
        break;
      case 'deals':
        sections.push(`
          <h3>${label}</h3>
          <ul>
            <li>Active pipeline: ${metrics.deals.activePipeline}</li>
            <li>Closed deals: ${metrics.deals.closedReferrals}</li>
          </ul>
        `);
        break;
      case 'attachRate':
        sections.push(`
          <h3>${label}</h3>
          <p>Agent attach rate: ${metrics.attachRate.attachRate.toFixed(1)}%</p>
        `);
        break;
      case 'preApprovals':
        sections.push(`
          <h3>${label}</h3>
          <p>Pre-approvals recorded: ${metrics.preApprovals.count}</p>
        `);
        break;
      case 'geography':
        sections.push(`
          <h3>${label}</h3>
          <p>${Object.entries(metrics.geography)
            .map(([state, count]) => `${state}: ${count}`)
            .join('<br/>') || 'No geography data available.'}</p>
        `);
        break;
      case 'network':
        sections.push(`
          <h3>${label}</h3>
          <p>${Object.entries(metrics.network)
            .map(([bucket, count]) => `${bucket}: ${count}`)
            .join('<br/>') || 'No network data available.'}</p>
        `);
        break;
      case 'termination':
        sections.push(`
          <h3>${label}</h3>
          <p>${Object.entries(metrics.termination)
            .map(([reason, count]) => `${reason}: ${count}`)
            .join('<br/>') || 'No terminated deals recorded.'}</p>
        `);
        break;
      default:
        break;
    }
  });

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
  const session = await getCurrentSession();

  if (!session || session.user?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 });
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
