import { NextRequest, NextResponse } from 'next/server';
import {
  endOfDay,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subYears
} from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

type TimeframeKey = 'day' | 'week' | 'month' | 'year' | 'ytd' | 'custom';

interface TimeframeInfo {
  key: TimeframeKey;
  label: string;
  start: Date;
  end: Date;
}

const TIMEFRAME_LABELS: Record<Exclude<TimeframeKey, 'custom'>, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  year: 'Last 12 months',
  ytd: 'Year to date'
};

const DISPLAY_LABEL_FORMAT = 'MMM d, yyyy';
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string | null): Date | null {
  if (!value || !DATE_ONLY_REGEX.test(value)) {
    return null;
  }
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeframe(request: NextRequest): TimeframeInfo {
  const now = new Date();
  const timeframeParam = request.nextUrl.searchParams.get('timeframe');
  const startParam = request.nextUrl.searchParams.get('start');
  const endParam = request.nextUrl.searchParams.get('end');

  const normalizedKey: TimeframeKey =
    timeframeParam === 'day' ||
    timeframeParam === 'week' ||
    timeframeParam === 'month' ||
    timeframeParam === 'year' ||
    timeframeParam === 'ytd' ||
    timeframeParam === 'custom'
      ? (timeframeParam as TimeframeKey)
      : 'month';

  if (normalizedKey === 'custom') {
    const startDate = parseDateOnly(startParam);
    const endDate = parseDateOnly(endParam);
    let start = startDate ? startOfDay(startDate) : startOfMonth(now);
    let end = endDate ? endOfDay(endDate) : endOfDay(now);
    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }
    const label = `Custom (${format(start, DISPLAY_LABEL_FORMAT)} – ${format(end, DISPLAY_LABEL_FORMAT)})`;
    return { key: 'custom', label, start, end };
  }

  switch (normalizedKey) {
    case 'day':
      return { key: 'day', label: TIMEFRAME_LABELS.day, start: startOfDay(now), end: endOfDay(now) };
    case 'week':
      return {
        key: 'week',
        label: TIMEFRAME_LABELS.week,
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfDay(now)
      };
    case 'year':
      return {
        key: 'year',
        label: TIMEFRAME_LABELS.year,
        start: startOfDay(subYears(now, 1)),
        end: endOfDay(now)
      };
    case 'ytd':
      return {
        key: 'ytd',
        label: TIMEFRAME_LABELS.ytd,
        start: startOfYear(now),
        end: endOfDay(now)
      };
    case 'month':
    default:
      return {
        key: 'month',
        label: TIMEFRAME_LABELS.month,
        start: startOfMonth(now),
        end: endOfDay(now)
      };
  }
}

function resolveMetricDate(payment: any): Date {
  if (payment.status === 'paid' && payment.paidDate) {
    return new Date(payment.paidDate);
  }
  if (payment.invoiceDate) {
    return new Date(payment.invoiceDate);
  }
  return new Date(payment.updatedAt ?? payment.createdAt ?? new Date());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const timeframe = parseTimeframe(request);
  await connectMongo();
  const session = await getCurrentSession();

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const role = session.user?.role ?? null;
  const userId = session.user?.id ?? null;
  if (!userId || (role !== 'mc' && role !== 'agent')) {
    return NextResponse.json({ role, metrics: null, timeframeLabel: timeframe.label });
  }

  let referralMatch: Partial<Record<'lender' | 'assignedAgent', unknown>> | null = null;

  let referralKey: 'lender' | 'assignedAgent' | null = null;
  let agentProfile: { npsScore: number | null } | null = null;

  if (role === 'mc') {
    const lender = await LenderMC.findOne({ userId }).select('_id');
    if (!lender) {
      return NextResponse.json({ role, metrics: null, timeframeLabel: timeframe.label });
    }
    referralMatch = { lender: lender._id };
    referralKey = 'lender';
  }

  if (role === 'agent') {
    const agent = await Agent.findOne({ userId }).select('_id npsScore');
    if (!agent) {
      return NextResponse.json({ role, metrics: null, timeframeLabel: timeframe.label });
    }
    referralMatch = { assignedAgent: agent._id };
    referralKey = 'assignedAgent';
    const agentData = agent.toObject();
    agentProfile = {
      npsScore: typeof agentData.npsScore === 'number' ? agentData.npsScore : null
    };
  }

  if (!referralMatch || !referralKey) {
    return NextResponse.json({ role, metrics: null, timeframeLabel: timeframe.label });
  }

  const [referrals, payments] = await Promise.all([
    Referral.find({
      deletedAt: null,
      ...referralMatch,
      createdAt: { $gte: timeframe.start, $lte: timeframe.end }
    })
      .select('createdAt status sla.timeToFirstAgentContactHours')
      .lean(),
    Payment.aggregate([
      {
        $lookup: {
          from: 'referrals',
          localField: 'referralId',
          foreignField: '_id',
          as: 'referral'
        }
      },
      { $unwind: '$referral' },
      {
        $match: {
          [`referral.${referralKey}`]: referralMatch[referralKey]
        }
      }
    ])
  ]);

  const paymentsWithMetric = payments
    .map((payment) => ({
      ...payment,
      metricDate: resolveMetricDate(payment)
    }))
    .filter((payment) => payment.metricDate >= timeframe.start && payment.metricDate <= timeframe.end);

  const totalReferrals = referrals.length;
  const dealsClosed = paymentsWithMetric.filter((payment) => payment.status === 'closed' || payment.status === 'paid');
  const dealsUnderContract = paymentsWithMetric.filter((payment) =>
    [
      'under_contract',
      'past_inspection',
      'past_appraisal',
      'clear_to_close',
    ].includes(payment.status)
  );
  const closeRate = totalReferrals === 0 ? 0 : (dealsClosed.length / totalReferrals) * 100;

  const revenueRealizedCents = paymentsWithMetric.reduce((sum, payment) => sum + (payment.receivedAmountCents ?? 0), 0);
  const revenueExpectedCents = paymentsWithMetric.reduce((sum, payment) => {
    if (
      payment.status === 'closed' ||
      payment.status === 'paid' ||
      payment.status === 'payment_sent' ||
      payment.status === 'clear_to_close' ||
      payment.status === 'past_appraisal' ||
      payment.status === 'past_inspection' ||
      payment.status === 'under_contract'
    ) {
      return sum + (payment.expectedAmountCents ?? 0);
    }
    return sum;
  }, 0);

  const averageCommissionCents = role === 'agent'
    ? (() => {
        const commissions = paymentsWithMetric
          .filter((payment) => (payment.receivedAmountCents ?? 0) > 0)
          .map((payment) => payment.receivedAmountCents ?? 0);
        if (!commissions.length) return 0;
        const total = commissions.reduce((sum, value) => sum + value, 0);
        return Math.round(total / commissions.length);
      })()
    : undefined;

  const responseSamples = referrals
    .map((referral: any) => referral.sla?.timeToFirstAgentContactHours ?? null)
    .filter((value): value is number => value != null);

  const avgResponseHours = responseSamples.length
    ? responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length
    : null;

  const metrics = {
    totalReferrals,
    dealsClosed: dealsClosed.length,
    activePipeline: dealsUnderContract.length,
    closeRate,
    revenueRealizedCents,
    revenueExpectedCents,
    averageCommissionCents,
    avgResponseHours,
    npsScore: agentProfile?.npsScore ?? null
  };

  return NextResponse.json({ role, metrics, timeframeLabel: timeframe.label });
}
