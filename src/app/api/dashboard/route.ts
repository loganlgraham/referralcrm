import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import {
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfHour,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subYears
} from 'date-fns';
import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { PreApprovalMetric } from '@/models/pre-approval-metric';

type TimeframeKey = 'day' | 'week' | 'month' | 'year' | 'ytd';

interface TimeframeInfo {
  key: TimeframeKey;
  label: string;
  start?: Date;
}

interface DashboardRequestContext {
  referralMatch: Record<string, unknown>;
  paymentMatch: Record<string, unknown>;
  timeframe: TimeframeInfo;
}

interface AggregatedPayment {
  _id: Types.ObjectId;
  status: 'under_contract' | 'closed' | 'paid' | 'terminated';
  expectedAmountCents: number;
  receivedAmountCents: number;
  paidDate?: Date | null;
  invoiceDate?: Date | null;
  updatedAt: Date;
  usedAfc?: boolean;
  agentAttribution?: 'AHA' | 'AHA_OOS' | null;
  referral: {
    _id: Types.ObjectId;
    createdAt: Date;
    source: 'Lender' | 'MC';
    endorser?: string;
    org?: 'AFC' | 'AHA';
    lookingInZip?: string;
    propertyAddress?: string;
    propertyCity?: string;
    propertyState?: string;
    propertyPostalCode?: string;
    borrowerCurrentAddress?: string;
    closedPriceCents?: number;
    estPurchasePriceCents?: number;
    referralFeeDueCents?: number;
    referralFeeBasisPoints?: number;
    commissionBasisPoints?: number;
    ahaBucket?: 'AHA' | 'AHA_OOS' | null;
    assignedAgent?: Types.ObjectId | null;
    lender?: Types.ObjectId | null;
    status?: string;
    preApprovalAmountCents?: number;
    sla?: {
      daysToContract?: number | null;
      daysToClose?: number | null;
      timeToFirstAgentContactHours?: number | null;
      timeToAssignmentHours?: number | null;
    } | null;
  };
}

const ACTIVE_PIPELINE_STATUSES = new Set<string>([
  'Paired',
  'In Communication',
  'Showing Homes',
  'Under Contract',
]);

interface TrendPoint {
  key: string;
  label: string;
  value: number;
}

const TIMEFRAME_LABELS: Record<TimeframeKey, string> = {
  day: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'Last 12 Months',
  ytd: 'Year to Date'
};

function parseTimeframe(value: string | null): TimeframeInfo {
  const key = (value as TimeframeKey) || 'month';
  const now = new Date();

  switch (key) {
    case 'day':
      return { key: 'day', label: TIMEFRAME_LABELS.day, start: startOfDay(now) };
    case 'week':
      return { key: 'week', label: TIMEFRAME_LABELS.week, start: startOfWeek(now, { weekStartsOn: 1 }) };
    case 'year':
      return { key: 'year', label: TIMEFRAME_LABELS.year, start: subYears(now, 1) };
    case 'ytd':
      return { key: 'ytd', label: TIMEFRAME_LABELS.ytd, start: startOfYear(now) };
    case 'month':
    default:
      return { key: 'month', label: TIMEFRAME_LABELS.month, start: startOfMonth(now) };
  }
}

function extractState(referral: AggregatedPayment['referral']): string {
  const normalizedState = referral.propertyState?.toString().trim().toUpperCase();
  if (normalizedState) {
    return normalizedState;
  }
  const candidates = [referral.propertyAddress, referral.borrowerCurrentAddress];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/,\s*([A-Za-z]{2})\s*\d{5}/);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
    const looseMatch = candidate.match(/,\s*([A-Za-z]{2})\b/);
    if (looseMatch?.[1]) {
      return looseMatch[1].toUpperCase();
    }
  }
  return 'Unknown';
}

function resolveMetricDate(payment: AggregatedPayment): Date {
  if (payment.status === 'paid' && payment.paidDate) {
    return payment.paidDate;
  }
  if (payment.invoiceDate) {
    return payment.invoiceDate;
  }
  return payment.updatedAt;
}

function createDashboardContext(request: NextRequest): DashboardRequestContext {
  const timeframe = parseTimeframe(request.nextUrl.searchParams.get('timeframe'));
  const referralMatch: Record<string, unknown> = { deletedAt: null };

  return {
    referralMatch,
    paymentMatch: {},
    timeframe
  };
}

function groupTrendByTimeframe(dates: Date[], timeframe: TimeframeInfo): TrendPoint[] {
  if (dates.length === 0) return [];

  const buckets = new Map<string, { label: string; value: number; sort: number }>();

  dates.forEach((date) => {
    const d = new Date(date);
    let key: string;
    let label: string;
    let sortValue: number;

    switch (timeframe.key) {
      case 'day': {
        const hourStart = startOfHour(d);
        key = format(hourStart, 'yyyy-MM-dd-HH');
        label = format(hourStart, 'ha');
        sortValue = hourStart.getTime();
        break;
      }
      case 'week': {
        const dayStart = startOfDay(d);
        key = format(dayStart, 'yyyy-MM-dd');
        label = format(dayStart, 'EEE dd');
        sortValue = dayStart.getTime();
        break;
      }
      case 'month': {
        const weekStart = startOfWeek(d, { weekStartsOn: 1 });
        key = `${format(weekStart, 'yyyy')}-W${format(weekStart, 'II')}`;
        label = `${format(weekStart, 'MMM d')}`;
        sortValue = weekStart.getTime();
        break;
      }
      case 'year':
      case 'ytd':
      default: {
        const monthStart = startOfMonth(d);
        key = `${format(monthStart, 'yyyy-MM')}`;
        label = format(monthStart, 'MMM yy');
        sortValue = monthStart.getTime();
        break;
      }
    }

    const bucket = buckets.get(key);
    if (bucket) {
      bucket.value += 1;
    } else {
      buckets.set(key, { label, value: 1, sort: sortValue });
    }
  });

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({ key, label: bucket.label, value: bucket.value, sort: bucket.sort }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _sort, ...rest }) => rest);
}

function computeAverage(values: number[]): number {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  await connectMongo();
  const session = await getCurrentSession();

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const context = createDashboardContext(request);
  const { referralMatch, timeframe } = context;

  const role = session.user?.role;
  const userId = session.user?.id;

  let missingProfile = false;

  if (role === 'mc' && userId) {
    const lender = await LenderMC.findOne({ userId }).select('_id');
    if (!lender) {
      missingProfile = true;
    } else {
      referralMatch.lender = lender._id as Types.ObjectId;
    }
  }

  if (role === 'agent' && userId) {
    const agent = await Agent.findOne({ userId }).select('_id');
    if (!agent) {
      missingProfile = true;
    } else {
      referralMatch.assignedAgent = agent._id as Types.ObjectId;
    }
  }

  if (missingProfile) {
    return NextResponse.json({
      timeframe,
      permissions: {
        canViewGlobal: role === 'admin',
        role: role ?? null
      },
      main: {
        summary: {
          totalReferrals: 0,
          dealsClosed: 0,
          dealsUnderContract: 0,
          closeRate: 0,
          afcDealsLost: 0,
          afcAttachRate: 0,
          ahaAttachRate: 0,
          ahaOosAttachRate: 0,
          activePipeline: 0,
          expectedRevenueCents: 0,
          realizedRevenueCents: 0,
          closedNotPaidCents: 0,
          averageDaysClosedToPaid: 0,
          averageRevenuePerDealCents: 0,
          totalVolumeClosedCents: 0,
          averagePaAmountCents: 0,
          averageReferralFeePaidCents: 0,
          pipelineValueCents: 0
        },
        trends: {
          revenue: [],
          deals: [],
          closeRate: [],
          mcTransfers: []
        },
        revenueBySource: [],
        revenueByEndorser: [],
        revenueByState: [],
        referralRequestsByZip: [],
        monthlyReferrals: [],
        preApprovalConversion: {
          trend: [],
          entries: []
        }
      },
      mc: {
        requestTrend: { all: [], aha: [], ahaOos: [] },
        revenueLeaderboard: [],
        closeRateLeaderboard: [],
        requestLeaderboard: { all: [], aha: [], ahaOos: [] }
      },
      agent: {
        averageCommissionCents: 0,
        averageCommissionPercent: 0,
        commissionSampleSize: 0,
        referralLeaderboard: [],
        closeRateLeaderboard: [],
        revenuePaid: [],
        revenueExpected: [],
        netRevenue: []
      },
      admin: {
        slaAverages: {
          timeToFirstAgentContactHours: 0,
          timeToAssignmentHours: 0,
          daysToContract: 0,
          daysToClose: 0
        },
        averageDaysNewLeadToContract: 0,
        averageDaysContractToClose: 0,
        totalReferrals: 0,
        assignedReferrals: 0,
        unassignedReferrals: 0,
        firstContactWithin24HoursRate: 0,
        firstContactWithin24HoursCount: 0,
        firstContactSampleSize: 0
      }
    });
  }

  const paymentMatch = Object.entries(referralMatch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[`referral.${key}`] = value;
    return acc;
  }, {});

  context.paymentMatch = paymentMatch;

  const timeframeStart = timeframe.start;

  const [referrals, payments] = await Promise.all([
    Referral.find({
      ...referralMatch,
      ...(timeframeStart ? { createdAt: { $gte: timeframeStart } } : {})
    })
      .select(
        'createdAt status referralFeeDueCents referralFeeBasisPoints commissionBasisPoints estPurchasePriceCents preApprovalAmountCents assignedAgent lender org ahaBucket propertyAddress propertyCity propertyState propertyPostalCode borrowerCurrentAddress closedPriceCents source endorser sla'
      )
      .lean(),
    Payment.aggregate<AggregatedPayment>([
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
          ...paymentMatch,
          status: { $in: ['under_contract', 'closed', 'paid'] }
        }
      }
    ])
  ]);

  const paymentsWithMetric = payments.map((payment) => ({
    ...payment,
    metricDate: resolveMetricDate(payment)
  }));

  const filteredPayments = timeframeStart
    ? paymentsWithMetric.filter((payment) => payment.metricDate >= timeframeStart)
    : paymentsWithMetric;

  const totalReferrals = referrals.length;
  const referralZipMap = new Map<string, number>();
  referrals.forEach((referral) => {
    const candidates = [referral.lookingInZip, referral.propertyPostalCode];
    const zipCandidate = candidates.find((value) => {
      if (value == null) return false;
      const trimmed = value.toString().trim();
      return trimmed.length > 0;
    });
    if (!zipCandidate) return;
    const zip = zipCandidate.toString().trim();
    referralZipMap.set(zip, (referralZipMap.get(zip) ?? 0) + 1);
  });
  const dealsClosed = filteredPayments.filter((payment) => payment.status === 'closed' || payment.status === 'paid');
  const dealsUnderContract = filteredPayments.filter((payment) => payment.status === 'under_contract');
  const closeRate = totalReferrals === 0 ? 0 : (dealsClosed.length / totalReferrals) * 100;

  const afcRelevant = filteredPayments.filter(
    (payment) => payment.referral?.org === 'AFC' && ['under_contract', 'closed', 'paid'].includes(payment.status)
  );
  const afcDealsLost = afcRelevant.filter((payment) => !payment.usedAfc).length;
  const afcAttachRate = afcRelevant.length
    ? (afcRelevant.filter((payment) => Boolean(payment.usedAfc)).length / afcRelevant.length) * 100
    : 0;

  const ahaRelevant = filteredPayments.filter(
    (payment) => payment.referral?.ahaBucket === 'AHA' && ['under_contract', 'closed', 'paid'].includes(payment.status)
  );
  const ahaAttached = ahaRelevant.filter((payment) => payment.agentAttribution === 'AHA');
  const ahaAttachRate = ahaRelevant.length ? (ahaAttached.length / ahaRelevant.length) * 100 : 0;

  const ahaOosRelevant = filteredPayments.filter(
    (payment) => payment.referral?.ahaBucket === 'AHA_OOS' && ['under_contract', 'closed', 'paid'].includes(payment.status)
  );
  const ahaOosAttached = ahaOosRelevant.filter((payment) => payment.agentAttribution === 'AHA_OOS');
  const ahaOosAttachRate = ahaOosRelevant.length ? (ahaOosAttached.length / ahaOosRelevant.length) * 100 : 0;

  const expectedRevenueCents = filteredPayments.reduce((sum, payment) => sum + (payment.expectedAmountCents ?? 0), 0);
  const realizedRevenueCents = filteredPayments.reduce((sum, payment) => sum + (payment.receivedAmountCents ?? 0), 0);

  const closedNotPaidCents = filteredPayments.reduce((sum, payment) => {
    if (payment.status === 'closed') {
      const outstanding = (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0);
      return sum + Math.max(outstanding, 0);
    }
    if (payment.status === 'paid' && (payment.receivedAmountCents ?? 0) < (payment.expectedAmountCents ?? 0)) {
      const outstanding = (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0);
      return sum + Math.max(outstanding, 0);
    }
    return sum;
  }, 0);

  const paidPayments = filteredPayments.filter((payment) => payment.status === 'paid');
  const paidPaymentsWithDates = paidPayments.filter((payment) => payment.paidDate);
  const averageDaysClosedToPaid = computeAverage(
    paidPaymentsWithDates
      .map((payment) => {
        const end = payment.paidDate ? new Date(payment.paidDate) : undefined;
        const start = payment.invoiceDate ? new Date(payment.invoiceDate) : new Date(payment.updatedAt);
        if (!end) return null;
        return differenceInCalendarDays(end, start);
      })
      .filter((value): value is number => value != null)
  );

  const averageRevenuePerDealCents = dealsClosed.length ? realizedRevenueCents / dealsClosed.length : 0;
  const totalVolumeClosedCents = dealsClosed.reduce((sum, payment) => {
    const closedPrice = payment.referral?.closedPriceCents ?? payment.referral?.estPurchasePriceCents ?? 0;
    return sum + closedPrice;
  }, 0);

  const revenueBySourceMap = new Map<string, number>();
  const revenueByEndorserMap = new Map<string, number>();
  const revenueByStateMap = new Map<string, number>();

  filteredPayments.forEach((payment) => {
    const revenue = payment.receivedAmountCents ?? 0;
    if (revenue <= 0) return;

    const source = payment.referral?.source ?? 'Unknown';
    revenueBySourceMap.set(source, (revenueBySourceMap.get(source) ?? 0) + revenue);

    const endorser = payment.referral?.endorser?.trim() || 'Unattributed';
    revenueByEndorserMap.set(endorser, (revenueByEndorserMap.get(endorser) ?? 0) + revenue);

    const state = extractState(payment.referral);
    revenueByStateMap.set(state, (revenueByStateMap.get(state) ?? 0) + revenue);
  });

  const averagePaAmountCents = computeAverage(
    referrals
      .map((referral) => referral.preApprovalAmountCents ?? 0)
      .filter((amount) => amount > 0)
  );

  const averageReferralFeePaidCents = computeAverage(
    paidPayments
      .map((payment) => payment.receivedAmountCents ?? 0)
      .filter((amount) => amount > 0)
  );

  const pipelineValueCents = filteredPayments
    .filter((payment) => payment.status === 'under_contract')
    .reduce((sum, payment) => sum + (payment.expectedAmountCents ?? 0), 0);

  const activePipeline = referrals.filter((referral) =>
    ACTIVE_PIPELINE_STATUSES.has((referral.status as string | undefined) ?? '')
  ).length;

  const revenueBySource = Array.from(revenueBySourceMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const revenueByEndorser = Array.from(revenueByEndorserMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const revenueByState = Array.from(revenueByStateMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const referralRequestsByZip = Array.from(referralZipMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const referralsMonthlyStart = startOfMonth(subMonths(new Date(), 11));
  const [monthlyReferralsAgg, monthlyDealsAgg] = await Promise.all([
    Referral.aggregate([
      {
        $match: {
          ...referralMatch,
          createdAt: { $gte: referralsMonthlyStart }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalReferrals: { $sum: 1 },
          mcTransfers: {
            $sum: {
              $cond: [{ $eq: ['$source', 'MC'] }, 1, 0]
            }
          }
        }
      }
    ]),
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
          ...paymentMatch,
          status: { $in: ['closed', 'paid'] }
        }
      },
      {
        $addFields: {
          metricDate: {
            $ifNull: [
              {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'paid'] },
                      { $ne: ['$paidDate', null] }
                    ]
                  },
                  '$paidDate',
                  '$updatedAt'
                ]
              },
              '$updatedAt'
            ]
          }
        }
      },
      {
        $match: {
          metricDate: { $gte: referralsMonthlyStart }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$metricDate' },
            month: { $month: '$metricDate' }
          },
          dealsClosed: { $sum: 1 },
          revenueReceivedCents: {
            $sum: {
              $cond: [
                { $gt: ['$receivedAmountCents', 0] },
                '$receivedAmountCents',
                0
              ]
            }
          }
        }
      }
    ])
  ]);

  const monthBuckets: { key: string; label: string; year: number; month: number }[] = [];
  const startMonth = referralsMonthlyStart;

  for (let i = 0; i < 12; i += 1) {
    const date = startOfMonth(new Date(startMonth.getFullYear(), startMonth.getMonth() + i));
    monthBuckets.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      year: date.getFullYear(),
      month: date.getMonth() + 1
    });
  }

  const referralMonthlyMap = new Map<string, { total: number; transfers: number }>();
  monthlyReferralsAgg.forEach((entry: any) => {
    if (!entry?._id) return;
    const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}`;
    referralMonthlyMap.set(key, {
      total: entry.totalReferrals ?? 0,
      transfers: entry.mcTransfers ?? 0
    });
  });

  const dealMonthlyMap = new Map<string, { dealsClosed: number; revenueReceivedCents: number }>();
  monthlyDealsAgg.forEach((entry: any) => {
    if (!entry?._id) return;
    const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}`;
    dealMonthlyMap.set(key, {
      dealsClosed: entry.dealsClosed ?? 0,
      revenueReceivedCents: entry.revenueReceivedCents ?? 0
    });
  });

  const preApprovalMetrics = await PreApprovalMetric.find({
    month: { $gte: referralsMonthlyStart }
  })
    .sort({ month: 1 })
    .lean();

  const preApprovalMap = new Map<string, { preApprovals: number; updatedAt: Date }>();
  preApprovalMetrics.forEach((metric) => {
    const key = `${metric.month.getFullYear()}-${String(metric.month.getMonth() + 1).padStart(2, '0')}`;
    preApprovalMap.set(key, { preApprovals: metric.preApprovals, updatedAt: metric.updatedAt });
  });

  const monthlyReferrals = monthBuckets.map((bucket) => {
    const referralStats = referralMonthlyMap.get(bucket.key) ?? { total: 0, transfers: 0 };
    const dealStats = dealMonthlyMap.get(bucket.key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
    const preApprovalStats = preApprovalMap.get(bucket.key) ?? { preApprovals: 0, updatedAt: undefined };
    const monthlyCloseRate = referralStats.total === 0
      ? 0
      : (dealStats.dealsClosed / Math.max(referralStats.total, 1)) * 100;
    const conversionRate =
      preApprovalStats.preApprovals > 0
        ? Number(((referralStats.total / preApprovalStats.preApprovals) * 100).toFixed(1))
        : 0;

    return {
      monthKey: bucket.key,
      label: bucket.label,
      totalReferrals: referralStats.total,
      mcTransfers: referralStats.transfers,
      dealsClosed: dealStats.dealsClosed,
      revenueReceivedCents: dealStats.revenueReceivedCents,
      closeRate: Number(monthlyCloseRate.toFixed(1)),
      preApprovals: preApprovalStats.preApprovals,
      conversionRate,
      preApprovalsUpdatedAt: preApprovalStats.updatedAt
    };
  });

  const lenderIds = new Set<string>();
  const agentIds = new Set<string>();

  referrals.forEach((referral) => {
    if (referral.lender) lenderIds.add(referral.lender.toString());
    if (referral.assignedAgent) agentIds.add(referral.assignedAgent.toString());
  });

  filteredPayments.forEach((payment) => {
    if (payment.referral?.lender) lenderIds.add(payment.referral.lender.toString());
    if (payment.referral?.assignedAgent) agentIds.add(payment.referral.assignedAgent.toString());
  });

  const [lenders, agents] = await Promise.all([
    lenderIds.size
      ? LenderMC.find({ _id: { $in: Array.from(lenderIds, (id) => new Types.ObjectId(id)) } }).select('name')
      : Promise.resolve([]),
    agentIds.size
      ? Agent.find({ _id: { $in: Array.from(agentIds, (id) => new Types.ObjectId(id)) } }).select('name')
      : Promise.resolve([])
  ]);

  const lenderNameMap = new Map<string, string>();
  lenders.forEach((lender) => {
    lenderNameMap.set(lender._id.toString(), lender.name || 'Unnamed MC');
  });

  const agentNameMap = new Map<string, string>();
  agents.forEach((agent) => {
    agentNameMap.set(agent._id.toString(), agent.name || 'Unnamed Agent');
  });

  const buildMcRequestLeaderboard = (sourceMap: Map<string, number>) =>
    Array.from(sourceMap.entries())
      .map(([key, value]) => ({
        id: key,
        name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
        referrals: value
      }))
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, 10);

  const mcRevenueMap = new Map<string, { revenue: number; expected: number; closed: number; totalReferrals: number }>();
  const mcCloseRateMap = new Map<string, { closed: number; total: number }>();

  const referralByMcMap = new Map<string, number>();
  const referralByMcAhaMap = new Map<string, number>();
  const referralByMcAhaOosMap = new Map<string, number>();
  const allReferralDates = referrals.map((referral) => referral.createdAt);
  const ahaReferralDates: Date[] = [];
  const ahaOosReferralDates: Date[] = [];
  referrals.forEach((referral) => {
    const key = referral.lender ? referral.lender.toString() : 'unassigned';
    referralByMcMap.set(key, (referralByMcMap.get(key) ?? 0) + 1);

    if (referral.ahaBucket === 'AHA') {
      referralByMcAhaMap.set(key, (referralByMcAhaMap.get(key) ?? 0) + 1);
      ahaReferralDates.push(referral.createdAt);
    } else if (referral.ahaBucket === 'AHA_OOS') {
      referralByMcAhaOosMap.set(key, (referralByMcAhaOosMap.get(key) ?? 0) + 1);
      ahaOosReferralDates.push(referral.createdAt);
    }
  });

  const mcRequestTrend = {
    all: groupTrendByTimeframe(allReferralDates, timeframe),
    aha: groupTrendByTimeframe(ahaReferralDates, timeframe),
    ahaOos: groupTrendByTimeframe(ahaOosReferralDates, timeframe)
  };

  filteredPayments.forEach((payment) => {
    const key = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    const current = mcRevenueMap.get(key) ?? { revenue: 0, expected: 0, closed: 0, totalReferrals: referralByMcMap.get(key) ?? 0 };
    current.revenue += payment.receivedAmountCents ?? 0;
    current.expected += payment.expectedAmountCents ?? 0;
    if (payment.status === 'closed' || payment.status === 'paid') {
      current.closed += 1;
    }
    current.totalReferrals = referralByMcMap.get(key) ?? current.totalReferrals;
    mcRevenueMap.set(key, current);

    const closeStats = mcCloseRateMap.get(key) ?? { closed: 0, total: referralByMcMap.get(key) ?? 0 };
    if (payment.status === 'closed' || payment.status === 'paid') {
      closeStats.closed += 1;
    }
    closeStats.total = referralByMcMap.get(key) ?? closeStats.total;
    mcCloseRateMap.set(key, closeStats);
  });

  const mcRevenueLeaderboard = Array.from(mcRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
      revenueCents: value.revenue,
      expectedRevenueCents: value.expected
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const mcCloseRateLeaderboard = Array.from(mcCloseRateMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
      closeRate: value.total === 0 ? 0 : (value.closed / value.total) * 100,
      dealsClosed: value.closed,
      totalReferrals: value.total
    }))
    .sort((a, b) => b.closeRate - a.closeRate)
    .slice(0, 10);

  const mcRequestLeaderboard = {
    all: buildMcRequestLeaderboard(referralByMcMap),
    aha: buildMcRequestLeaderboard(referralByMcAhaMap),
    ahaOos: buildMcRequestLeaderboard(referralByMcAhaOosMap)
  };

  const agentReferralCount = new Map<string, number>();
  referrals.forEach((referral) => {
    const key = referral.assignedAgent ? referral.assignedAgent.toString() : 'unassigned';
    agentReferralCount.set(key, (agentReferralCount.get(key) ?? 0) + 1);
  });

  const agentRevenueMap = new Map<
    string,
    {
      revenue: number;
      expected: number;
      closed: number;
      totalReferrals: number;
      commissionCents: number[];
      commissionPercentages: number[];
      netCommissionCents: number;
    }
  >();

  filteredPayments.forEach((payment) => {
    const key = payment.referral?.assignedAgent ? payment.referral.assignedAgent.toString() : 'unassigned';
    const current = agentRevenueMap.get(key) ?? {
      revenue: 0,
      expected: 0,
      closed: 0,
      totalReferrals: agentReferralCount.get(key) ?? 0,
      commissionCents: [],
      commissionPercentages: [],
      netCommissionCents: 0
    };
    current.revenue += payment.receivedAmountCents ?? 0;
    current.expected += payment.expectedAmountCents ?? 0;
    if (payment.status === 'closed' || payment.status === 'paid') {
      current.closed += 1;
      const closedPriceCents =
        payment.referral?.closedPriceCents ??
        payment.referral?.estPurchasePriceCents ??
        payment.referral?.referralFeeDueCents ??
        0;
      const commissionBasisPoints = payment.referral?.commissionBasisPoints ?? 0;
      const commissionCents = (closedPriceCents * commissionBasisPoints) / 10000;
      const commissionPercent = commissionBasisPoints / 100;
      if (commissionCents > 0 && commissionPercent > 0) {
        current.commissionCents.push(commissionCents);
        current.commissionPercentages.push(commissionPercent);
        const referralFeeCents = payment.referral?.referralFeeDueCents ?? 0;
        current.netCommissionCents += commissionCents - referralFeeCents;
      }
    }
    current.totalReferrals = agentReferralCount.get(key) ?? current.totalReferrals;
    agentRevenueMap.set(key, current);
  });

  const agentReferralLeaderboard = Array.from(agentReferralCount.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      referrals: value
    }))
    .sort((a, b) => b.referrals - a.referrals)
    .slice(0, 10);

  const agentCloseRateLeaderboard = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      closeRate: value.totalReferrals === 0 ? 0 : (value.closed / value.totalReferrals) * 100,
      dealsClosed: value.closed,
      totalReferrals: value.totalReferrals
    }))
    .sort((a, b) => b.closeRate - a.closeRate)
    .slice(0, 10);

  const agentRevenuePaid = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.revenue
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const agentRevenueExpected = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.expected
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const agentCommissionValues = Array.from(agentRevenueMap.values())
    .flatMap((value) => value.commissionCents);
  const averageAgentCommissionCents = computeAverage(agentCommissionValues);

  const agentCommissionPercentages = Array.from(agentRevenueMap.values())
    .flatMap((value) => value.commissionPercentages);
  const averageAgentCommissionPercent = computeAverage(agentCommissionPercentages);
  const agentCommissionSampleSize = agentCommissionPercentages.length;

  const agentNetRevenue = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.netCommissionCents
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const assignedReferrals = referrals.filter((referral) => Boolean(referral.assignedAgent)).length;
  const unassignedReferrals = Math.max(totalReferrals - assignedReferrals, 0);

  const slaFields = referrals
    .map((referral) => referral.sla)
    .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

  const firstContactRecords = slaFields
    .map((sla) => sla.timeToFirstAgentContactHours ?? null)
    .filter((value): value is number => value != null);
  const firstContactWithin24HoursCount = firstContactRecords.filter((value) => value <= 24).length;
  const firstContactWithin24HoursRate = firstContactRecords.length
    ? (firstContactWithin24HoursCount / firstContactRecords.length) * 100
    : 0;

  const timeToFirstContactAvg = computeAverage(
    slaFields
      .map((sla) => sla.timeToFirstAgentContactHours ?? null)
      .filter((value): value is number => value != null)
  );

  const timeToAssignmentAvg = computeAverage(
    slaFields
      .map((sla) => sla.timeToAssignmentHours ?? null)
      .filter((value): value is number => value != null)
  );

  const daysToContractAvg = computeAverage(
    slaFields
      .map((sla) => sla.daysToContract ?? null)
      .filter((value): value is number => value != null)
  );

  const daysToCloseAvg = computeAverage(
    slaFields
      .map((sla) => sla.daysToClose ?? null)
      .filter((value): value is number => value != null)
  );

  const adminAverageLeadToContract = daysToContractAvg;
  const adminAverageContractToClose = daysToCloseAvg;

  const preApprovalConversionTrend = monthlyReferrals
    .filter((entry) => entry.preApprovals > 0)
    .map((entry) => ({
      key: entry.monthKey,
      label: entry.label,
      value: entry.conversionRate
    }));

  const preApprovalEntries = monthlyReferrals
    .filter((entry) => entry.preApprovals > 0)
    .map((entry) => ({
      monthKey: entry.monthKey,
      label: entry.label,
      totalReferrals: entry.totalReferrals,
      preApprovals: entry.preApprovals,
      conversionRate: entry.conversionRate,
      updatedAt: entry.preApprovalsUpdatedAt
    }));

  const responsePayload = {
    timeframe,
    permissions: {
      canViewGlobal: role === 'admin',
      role: role ?? null
    },
    main: {
      summary: {
        totalReferrals,
        dealsClosed: dealsClosed.length,
        dealsUnderContract: dealsUnderContract.length,
        closeRate,
        afcDealsLost,
        afcAttachRate,
        ahaAttachRate,
        ahaOosAttachRate,
        activePipeline,
        expectedRevenueCents,
        realizedRevenueCents,
        closedNotPaidCents,
        averageDaysClosedToPaid,
        averageRevenuePerDealCents,
        totalVolumeClosedCents,
        averagePaAmountCents,
        averageReferralFeePaidCents,
        pipelineValueCents
      },
      trends: {
        revenue: monthlyReferrals.map((entry) => ({ key: entry.monthKey, label: entry.label, value: entry.revenueReceivedCents })),
        deals: monthlyReferrals.map((entry) => ({ key: entry.monthKey, label: entry.label, value: entry.dealsClosed })),
        closeRate: monthlyReferrals.map((entry) => ({ key: entry.monthKey, label: entry.label, value: entry.closeRate })),
        mcTransfers: monthlyReferrals.map((entry) => ({ key: entry.monthKey, label: entry.label, value: entry.mcTransfers }))
      },
      revenueBySource,
      revenueByEndorser,
      revenueByState,
      referralRequestsByZip,
      monthlyReferrals: monthlyReferrals.map((entry) => ({
        monthKey: entry.monthKey,
        label: entry.label,
        totalReferrals: entry.totalReferrals,
        preApprovals: entry.preApprovals,
        conversionRate: entry.conversionRate,
        updatedAt: entry.preApprovalsUpdatedAt
      })),
      preApprovalConversion: {
        trend: preApprovalConversionTrend,
        entries: preApprovalEntries
      }
    },
    mc: {
      requestTrend: mcRequestTrend,
      revenueLeaderboard: mcRevenueLeaderboard,
      closeRateLeaderboard: mcCloseRateLeaderboard,
      requestLeaderboard: mcRequestLeaderboard
    },
    agent: {
      averageCommissionCents: averageAgentCommissionCents,
      averageCommissionPercent: averageAgentCommissionPercent,
      commissionSampleSize: agentCommissionSampleSize,
      referralLeaderboard: agentReferralLeaderboard,
      closeRateLeaderboard: agentCloseRateLeaderboard,
      revenuePaid: agentRevenuePaid,
      revenueExpected: agentRevenueExpected,
      netRevenue: agentNetRevenue
    },
    admin: {
      slaAverages: {
        timeToFirstAgentContactHours: timeToFirstContactAvg,
        timeToAssignmentHours: timeToAssignmentAvg,
        daysToContract: daysToContractAvg,
        daysToClose: daysToCloseAvg
      },
      averageDaysNewLeadToContract: adminAverageLeadToContract,
      averageDaysContractToClose: adminAverageContractToClose,
      totalReferrals,
      assignedReferrals,
      unassignedReferrals,
      firstContactWithin24HoursRate,
      firstContactWithin24HoursCount,
      firstContactSampleSize: firstContactRecords.length
    }
  };

  return NextResponse.json(responsePayload);
}
