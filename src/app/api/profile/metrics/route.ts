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
import { DEFAULT_REFERRAL_FEE_BPS } from '@/constants/referrals';

type TimeframeKey = 'day' | 'week' | 'month' | 'year' | 'ytd' | 'all' | 'custom';

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
  ytd: 'Year to date',
  all: 'All time'
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
    timeframeParam === 'all' ||
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
    case 'all':
      return {
        key: 'all',
        label: TIMEFRAME_LABELS.all,
        start: startOfDay(new Date(0)),
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
  if (!userId || role !== 'agent') {
    return NextResponse.json({ role, metrics: null, timeframeLabel: timeframe.label });
  }

  const agent = await Agent.findOne({ userId }).select('_id npsScore');
  if (!agent) {
    return NextResponse.json({ role, metrics: null, timeframeLabel: timeframe.label });
  }

  const referralMatch: Partial<Record<'assignedAgent', unknown>> = { assignedAgent: agent._id };
  const referralKey: 'assignedAgent' = 'assignedAgent';
  const agentData = agent.toObject();
  const agentProfile = {
    npsScore: typeof agentData.npsScore === 'number' ? agentData.npsScore : null
  };

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

  const lostReferrals = await Referral.find({
    deletedAt: null,
    lostAssignments: {
      $elemMatch: {
        agent: agent._id,
        lostAt: { $gte: timeframe.start, $lte: timeframe.end }
      }
    }
  })
    .select('lostAssignments')
    .lean();

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

  const averageCommissionCents = (() => {
    const commissions = paymentsWithMetric
      .filter((payment) => (payment.receivedAmountCents ?? 0) > 0)
      .map((payment) => payment.receivedAmountCents ?? 0);
    if (!commissions.length) return 0;
    const total = commissions.reduce((sum, value) => sum + value, 0);
    return Math.round(total / commissions.length);
  })();

  const lostReferralsCount = lostReferrals.reduce((count, referral) => {
    const matches = (referral.lostAssignments ?? []).filter(
      (lost) =>
        lost.agent?.toString() === agent._id.toString() &&
        lost.lostAt >= timeframe.start &&
        lost.lostAt <= timeframe.end
    );
    return count + matches.length;
  }, 0);

  const { totalAgentRevenueCents, referralFeesPaidCents } = paymentsWithMetric.reduce(
    (acc, payment) => {
      const baseAmount = payment.receivedAmountCents ?? payment.expectedAmountCents ?? 0;
      const referralFeeBasisPoints =
        payment.referralFeeBasisPoints ??
        payment.referral?.referralFeeBasisPoints ??
        DEFAULT_REFERRAL_FEE_BPS;
      const referralFeeCents = Math.round(baseAmount * (referralFeeBasisPoints ?? 0) * 0.0001);
      acc.totalAgentRevenueCents += baseAmount - referralFeeCents;
      acc.referralFeesPaidCents += referralFeeCents;
      return acc;
    },
    { totalAgentRevenueCents: 0, referralFeesPaidCents: 0 }
  );

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
    lostReferrals: lostReferralsCount,
    totalAgentRevenueCents,
    referralFeesPaidCents,
    avgResponseHours,
    npsScore: agentProfile?.npsScore ?? null
  };

  return NextResponse.json({ role, metrics, timeframeLabel: timeframe.label });
}
