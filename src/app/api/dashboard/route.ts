import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import {
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  endOfMonth,
  addMonths,
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

type TimeframeKey = 'day' | 'week' | 'month' | 'year' | 'ytd' | 'all' | 'custom';
type NetworkFilter = 'ALL' | 'AHA' | 'AHA_OOS';

interface TimeframeInfo {
  key: TimeframeKey;
  label: string;
  start?: Date;
  end?: Date;
}

interface DashboardRequestContext {
  referralMatch: Record<string, unknown>;
  paymentMatch: Record<string, unknown>;
  timeframe: TimeframeInfo;
  networkFilter: NetworkFilter;
}

interface AggregatedPayment {
  _id: Types.ObjectId;
  agentId?: Types.ObjectId | null;
  status:
    | 'under_contract'
    | 'past_inspection'
    | 'past_appraisal'
    | 'clear_to_close'
    | 'closed'
    | 'payment_sent'
    | 'paid'
    | 'terminated';
  expectedAmountCents: number;
  receivedAmountCents: number;
  contractPriceCents?: number | null;
  closingDate?: Date | null;
  terminatedReason?: 'inspection' | 'appraisal' | 'financing' | 'changed_mind' | null;
  paidDate?: Date | null;
  invoiceDate?: Date | null;
  updatedAt: Date;
  usedAfc?: boolean;
  usedAssignedAgent?: boolean;
  agentAttribution?: 'AHA' | 'AHA_OOS' | 'OUTSIDE_AGENT' | null;
  referral: {
    _id: Types.ObjectId;
    createdAt: Date;
    referralDate?: Date | null;
    source: 'Lender' | 'MC';
    endorser?: string;
    origin?: 'agent' | 'mc' | 'admin' | '';
    org?: 'AFC' | 'AHA';
    lookingInZip?: string;
    lookingInZips?: string[] | null;
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
      contractToCloseMinutes?: number | null;
      closedToPaidMinutes?: number | null;
      previousContractToCloseMinutes?: number | null;
      previousClosedToPaidMinutes?: number | null;
      lastClosedAt?: Date | string | null;
      lastUnderContractAt?: Date | string | null;
      lastPairedAt?: Date | string | null;
    } | null;
  };
}

interface DashboardReferral {
  _id: Types.ObjectId;
  createdAt: Date;
  referralDate?: Date | null;
  source: 'Lender' | 'MC';
  endorser?: string;
  origin?: 'agent' | 'mc' | 'admin' | '';
  org?: 'AFC' | 'AHA';
  lookingInZip?: string;
  lookingInZips?: string[] | null;
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
    lastClosedAt?: Date | string | null;
    lastUnderContractAt?: Date | string | null;
    lastPairedAt?: Date | string | null;
  } | null;
}

const ACTIVE_PIPELINE_STATUSES = new Set<string>([
  'Paired',
  'In Communication',
  'Active Lead',
  'Showing Homes',
  'Under Contract',
]);

const TERMINATED_REASON_LABELS: Record<string, string> = {
  inspection: 'Inspection',
  appraisal: 'Appraisal',
  financing: 'Financing',
  changed_mind: 'Changed Mind',
  unknown: 'Unknown'
};

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
  ytd: 'Year to Date',
  all: 'All time',
  custom: 'Custom range'
};

const UNDER_CONTRACT_STATUSES = new Set<AggregatedPayment['status']>([
  'under_contract',
  'past_inspection',
  'past_appraisal',
  'clear_to_close'
]);

const EXPECTED_REVENUE_STATUSES = new Set<AggregatedPayment['status']>([
  ...UNDER_CONTRACT_STATUSES,
  'closed',
  'payment_sent'
]);

function parseDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parseTimeframe(
  value: string | null,
  startParam: string | null,
  endParam: string | null
): TimeframeInfo {
  const now = new Date();
  const normalizedKey: TimeframeKey =
    value === 'day' ||
    value === 'week' ||
    value === 'month' ||
    value === 'year' ||
    value === 'ytd' ||
    value === 'all' ||
    value === 'custom'
      ? (value as TimeframeKey)
      : 'month';

  if (normalizedKey === 'custom') {
    const startDate = parseDateOnly(startParam);
    const endDate = parseDateOnly(endParam);

    let start = startDate ? startOfDay(startDate) : null;
    let end = endDate ? endOfDay(endDate) : null;

    if (start && end && start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    const fallbackStart = start ?? startOfMonth(now);
    const fallbackEnd = end ?? endOfDay(now);
    const label =
      start && end
        ? `Custom (${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')})`
        : TIMEFRAME_LABELS.custom;

    return {
      key: 'custom',
      label,
      start: start ?? fallbackStart,
      end: end ?? fallbackEnd
    };
  }

  switch (normalizedKey) {
    case 'day':
      return {
        key: 'day',
        label: TIMEFRAME_LABELS.day,
        start: startOfDay(now),
        end: endOfDay(now)
      };
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
        start: subYears(now, 1),
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

function calculateOutstandingExpected(payment: AggregatedPayment): number {
  const outstanding = Math.max(
    (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0),
    0
  );

  if (EXPECTED_REVENUE_STATUSES.has(payment.status)) {
    return outstanding;
  }

  if (payment.status === 'paid' && outstanding > 0) {
    return outstanding;
  }

  return 0;
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
  const timeframe = parseTimeframe(
    request.nextUrl.searchParams.get('timeframe'),
    request.nextUrl.searchParams.get('start'),
    request.nextUrl.searchParams.get('end')
  );
  const referralMatch: Record<string, unknown> = { deletedAt: null };
  const networkParam = request.nextUrl.searchParams.get('network');
  const normalizedNetwork =
    networkParam === 'AHA' || networkParam === 'AHA_OOS' || networkParam === 'ALL'
      ? (networkParam as NetworkFilter)
      : 'ALL';

  return {
    referralMatch,
    paymentMatch: {},
    timeframe,
    networkFilter: normalizedNetwork
  };
}

function groupTrendByTimeframe(dates: Date[], timeframe: TimeframeInfo): TrendPoint[] {
  if (dates.length === 0) return [];

  if (timeframe.key === 'custom') {
    const firstDate = new Date(dates[0]);
    const earliest = dates.reduce((min, current) => {
      const candidate = new Date(current);
      return candidate < min ? candidate : min;
    }, firstDate);
    const latest = dates.reduce((max, current) => {
      const candidate = new Date(current);
      return candidate > max ? candidate : max;
    }, firstDate);

    const rangeStart = timeframe.start ?? earliest;
    const rangeEnd = timeframe.end ?? latest;
    const dayDiff = Math.max(differenceInCalendarDays(rangeEnd, rangeStart), 0);

    const derivedKey: TimeframeKey =
      dayDiff <= 1 ? 'day' : dayDiff <= 31 ? 'week' : dayDiff <= 180 ? 'month' : 'year';

    return groupTrendByTimeframe(dates, { ...timeframe, key: derivedKey });
  }

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

function isWithinTimeframe(date: Date | null | undefined, timeframe: TimeframeInfo): boolean {
  if (!date) return false;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return false;
  if (timeframe.start && value < timeframe.start) return false;
  if (timeframe.end && value > timeframe.end) return false;
  return true;
}

function getSlaMetricDate(
  referral: AggregatedPayment['referral'] | DashboardReferral,
  fallback: Date | null = null
): Date | null {
  const sla = referral.sla;
  if (!sla) return fallback;
  return (
    (sla.lastClosedAt ? new Date(sla.lastClosedAt) : null) ??
    (sla.lastUnderContractAt ? new Date(sla.lastUnderContractAt) : null) ??
    (sla.lastPairedAt ? new Date(sla.lastPairedAt) : null) ??
    fallback
  );
}

function formatTerminatedAddress(referral: AggregatedPayment['referral']): string {
  const parts = [referral.propertyAddress, referral.propertyCity, referral.propertyState].filter(
    (part): part is string => Boolean(part && part.toString().trim())
  );
  if (parts.length) {
    return parts.join(', ');
  }
  return 'Unknown address';
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
          pendingClosings: 0,
          pendingClosingsThisMonth: 0,
          pendingClosingsNextMonth: 0,
          closeRate: 0,
          afcDealsLost: 0,
          afcAttachRate: 0,
          ahaDealsLost: 0,
          ahaAttachRate: 0,
          ahaOosDealsLost: 0,
          ahaOosAttachRate: 0,
          activePipeline: 0,
          expectedRevenueCents: 0,
          realizedRevenueCents: 0,
          closedNotPaidCents: 0,
          averageDaysNewLeadToContract: 0,
          averageDaysClosedToPaid: 0,
          averageClosedDealAmountCents: 0,
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
        },
        terminatedDeals: {
          breakdown: [],
          totalLostReferralFeeCents: 0,
          totalDeals: 0,
          deals: []
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
        averageClosedDealAmount: [],
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
      },
      agit: {
        totalReferrals: 0,
        glennBeckReferrals: 0,
        usedAfcCount: 0,
        usedAfcRate: 0,
        lostReferrals: 0,
        closeRate: 0,
        dealsClosed: 0
      }
    });
  }

  const paymentMatch = Object.entries(referralMatch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[`referral.${key}`] = value;
    return acc;
  }, {});

  context.paymentMatch = paymentMatch;

  const timeframeStart = timeframe.start;
  const timeframeEnd = timeframe.end;

  const referralsPromise: Promise<DashboardReferral[]> = Referral.find({
    ...referralMatch,
  })
    .select(
      'createdAt referralDate status referralFeeDueCents referralFeeBasisPoints commissionBasisPoints estPurchasePriceCents preApprovalAmountCents assignedAgent lender org ahaBucket propertyAddress propertyCity propertyState propertyPostalCode borrowerCurrentAddress closedPriceCents source endorser origin sla lookingInZip lookingInZips'
    )
    .lean<DashboardReferral[]>()
    .exec();

  const paymentsPromise: Promise<AggregatedPayment[]> = Payment.aggregate<AggregatedPayment>([
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
        status: {
          $in: [
            'under_contract',
            'past_inspection',
            'past_appraisal',
            'clear_to_close',
            'closed',
            'payment_sent',
            'paid',
          ]
        }
      }
    },
    {
      $project: {
        _id: 1,
        agentId: 1,
        status: 1,
        expectedAmountCents: 1,
        receivedAmountCents: 1,
        contractPriceCents: 1,
        closingDate: 1,
        terminatedReason: 1,
        paidDate: 1,
        invoiceDate: 1,
        updatedAt: 1,
        usedAfc: 1,
        usedAssignedAgent: 1,
        agentAttribution: 1,
        referral: {
          _id: '$referral._id',
          createdAt: '$referral.createdAt',
          referralDate: '$referral.referralDate',
          source: '$referral.source',
          endorser: '$referral.endorser',
          origin: '$referral.origin',
          org: '$referral.org',
          lookingInZip: '$referral.lookingInZip',
          lookingInZips: '$referral.lookingInZips',
          propertyAddress: '$referral.propertyAddress',
          propertyCity: '$referral.propertyCity',
          propertyState: '$referral.propertyState',
          propertyPostalCode: '$referral.propertyPostalCode',
          borrowerCurrentAddress: '$referral.borrowerCurrentAddress',
          closedPriceCents: '$referral.closedPriceCents',
          estPurchasePriceCents: '$referral.estPurchasePriceCents',
          referralFeeDueCents: '$referral.referralFeeDueCents',
          referralFeeBasisPoints: '$referral.referralFeeBasisPoints',
          commissionBasisPoints: '$referral.commissionBasisPoints',
          ahaBucket: '$referral.ahaBucket',
          assignedAgent: '$referral.assignedAgent',
          lender: '$referral.lender',
          status: '$referral.status',
          preApprovalAmountCents: '$referral.preApprovalAmountCents',
          sla: '$referral.sla'
        }
      }
    }
  ]).exec();

  const terminatedPaymentsPromise: Promise<AggregatedPayment[]> = Payment.aggregate<AggregatedPayment>([
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
        status: 'terminated'
      }
    }
  ]).exec();

  const [referrals, payments, terminatedPayments] = await Promise.all([
    referralsPromise,
    paymentsPromise,
    terminatedPaymentsPromise,
  ]);

  const paymentsWithMetric = payments.map((payment) => ({
    ...payment,
    metricDate: resolveMetricDate(payment)
  }));

  const filteredPayments = paymentsWithMetric.filter((payment) => {
    if (timeframeStart && payment.metricDate < timeframeStart) {
      return false;
    }
    if (timeframeEnd && payment.metricDate > timeframeEnd) {
      return false;
    }
    return true;
  });

  const terminatedWithMetric = terminatedPayments.map((payment) => ({
    ...payment,
    metricDate: resolveMetricDate(payment)
  }));

  const terminatedWithinTimeframe = terminatedWithMetric.filter((payment) => {
    if (timeframeStart && payment.metricDate < timeframeStart) {
      return false;
    }
    if (timeframeEnd && payment.metricDate > timeframeEnd) {
      return false;
    }
    return true;
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
    if (payment.agentId) agentIds.add(payment.agentId.toString());
  });

  terminatedWithinTimeframe.forEach((payment) => {
    if (payment.referral?.assignedAgent) agentIds.add(payment.referral.assignedAgent.toString());
    if (payment.agentId) agentIds.add(payment.agentId.toString());
  });

  const [lenders, agents] = await Promise.all([
    lenderIds.size
      ? LenderMC.find({ _id: { $in: Array.from(lenderIds, (id) => new Types.ObjectId(id)) } }).select('name')
      : Promise.resolve([]),
    agentIds.size
      ? Agent.find({ _id: { $in: Array.from(agentIds, (id) => new Types.ObjectId(id)) } }).select('name ahaDesignation')
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

  const agentDesignationMap = new Map<string, 'AHA' | 'AHA_OOS' | 'AGIT' | null>();
  agents.forEach((agent) => {
    agentDesignationMap.set(agent._id.toString(), agent.ahaDesignation ?? null);
  });

  const getAgentDesignation = (payment: AggregatedPayment): 'AHA' | 'AHA_OOS' | 'AGIT' | null => {
    const agentId = payment.agentId ?? payment.referral?.assignedAgent;
    if (!agentId) return null;
    return agentDesignationMap.get(agentId.toString()) ?? null;
  };

  const getReferralDesignation = (referral: DashboardReferral): 'AHA' | 'AHA_OOS' | 'AGIT' | null => {
    if (!referral.assignedAgent) return null;
    return agentDesignationMap.get(referral.assignedAgent.toString()) ?? null;
  };

  const matchesNetwork = (designation: 'AHA' | 'AHA_OOS' | 'AGIT' | null) => {
    if (context.networkFilter === 'ALL') return true;
    return designation === context.networkFilter;
  };

  const paymentsByNetwork =
    context.networkFilter === 'ALL'
      ? paymentsWithMetric
      : paymentsWithMetric.filter((payment) => matchesNetwork(getAgentDesignation(payment)));

  const filteredPaymentsByNetwork =
    context.networkFilter === 'ALL'
      ? filteredPayments
      : filteredPayments.filter((payment) => matchesNetwork(getAgentDesignation(payment)));

  const isWithinTimeframe = (date: Date | string | null | undefined) => {
    if (!date) return true;
    const candidate = new Date(date);
    if (Number.isNaN(candidate.getTime())) return false;
    if (timeframeStart && candidate < timeframeStart) return false;
    if (timeframeEnd && candidate > timeframeEnd) return false;
    return true;
  };

  const referralsByNetwork =
    context.networkFilter === 'ALL'
      ? referrals
      : referrals.filter((referral) => matchesNetwork(getReferralDesignation(referral)));

  const filteredReferrals = referralsByNetwork.filter((referral) =>
    isWithinTimeframe(referral.createdAt)
  );

  const terminatedWithinNetwork =
    context.networkFilter === 'ALL'
      ? terminatedWithinTimeframe
      : terminatedWithinTimeframe.filter((payment) => matchesNetwork(getAgentDesignation(payment)));

  const totalReferrals = filteredReferrals.length;
  const referralZipMap = new Map<string, number>();
  referralsByNetwork.forEach((referral) => {
    const zipCandidates = Array.isArray(referral.lookingInZips)
      ? referral.lookingInZips
      : referral.lookingInZip
        ? [referral.lookingInZip]
        : [];

    const uniqueZips = Array.from(
      new Set(
        zipCandidates
          .map((zip) => zip?.toString().trim())
          .filter((zip): zip is string => Boolean(zip))
      )
    );

    uniqueZips.forEach((zip) => {
      referralZipMap.set(zip, (referralZipMap.get(zip) ?? 0) + 1);
    });
  });
  // Close rate calculation: For accurate close rate, we need to match deals to referrals
  // created in the timeframe, not just deals closed in the timeframe.
  // This ensures we're measuring "of referrals created this period, how many closed?"
  const filteredReferralIds = new Set(filteredReferrals.map((r) => r._id.toString()));
  
  const dealsClosed = filteredPaymentsByNetwork.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent === true &&
      (payment.status === 'closed' || payment.status === 'paid') &&
      filteredReferralIds.has(payment.referral._id.toString())
  );
  
  const lostReferrals = filteredReferrals.filter((referral) => referral.status === 'Lost');
  const endOfToday = endOfDay(new Date());
  const startOfCurrentMonth = startOfMonth(new Date());
  const endOfCurrentMonth = endOfMonth(new Date());
  const startOfNextMonth = startOfMonth(addMonths(new Date(), 1));
  const endOfNextMonth = endOfMonth(addMonths(new Date(), 1));
  const dealStatuses = [
    'under_contract',
    'past_inspection',
    'past_appraisal',
    'clear_to_close',
  ];
  const dealsUnderContract = filteredPaymentsByNetwork.filter((payment) =>
    dealStatuses.includes(payment.status)
  );
  const pendingClosings = paymentsByNetwork.filter((payment) => {
    if (!dealStatuses.includes(payment.status)) return false;
    if (payment.usedAssignedAgent !== true) return false;
    const closingDate = payment.closingDate ? new Date(payment.closingDate) : null;
    if (!closingDate) return false;
    return closingDate > endOfToday;
  });
  const pendingClosingsThisMonth = pendingClosings.filter((payment) => {
    const closingDate = payment.closingDate ? new Date(payment.closingDate) : null;
    return (
      closingDate &&
      closingDate >= startOfCurrentMonth &&
      closingDate <= endOfCurrentMonth
    );
  });
  const pendingClosingsNextMonth = pendingClosings.filter((payment) => {
    const closingDate = payment.closingDate ? new Date(payment.closingDate) : null;
    return (
      closingDate &&
      closingDate >= startOfNextMonth &&
      closingDate <= endOfNextMonth
    );
  });
  const closeRate = totalReferrals === 0 ? 0 : (dealsClosed.length / totalReferrals) * 100;

  // Identify Glenn Beck referrals early to exclude from revenue
  // Use referralsByNetwork (not filteredReferrals) to exclude all Glenn Beck referrals
  // regardless of timeframe from revenue calculations
  const glennBeckReferralIdsForExclusion = referralsByNetwork
    .filter((referral) => {
      const endorser = referral.endorser?.trim().toLowerCase();
      return endorser === 'glenn beck';
    })
    .map((r) => r._id.toString());
  const glennBeckReferralIdsSet = new Set(glennBeckReferralIdsForExclusion);

  const revenueEligiblePayments = filteredPaymentsByNetwork.filter(
    (payment) => 
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      !glennBeckReferralIdsSet.has(payment.referral._id.toString())
  );

  const closedOrPaidStatuses = new Set(['closed', 'paid']);

  const expectedRevenueCents = revenueEligiblePayments.reduce(
    (sum, payment) => sum + calculateOutstandingExpected(payment),
    0
  );
  const realizedRevenueCents = revenueEligiblePayments.reduce(
    (sum, payment) => sum + (payment.receivedAmountCents ?? 0),
    0
  );

  const closedNotPaidCents = revenueEligiblePayments.reduce((sum, payment) => {
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

  // Avg. days closed → paid should consider all paid deals where usedAssignedAgent is true
  // (not just revenue-eligible payments)
  const paidPayments = filteredPaymentsByNetwork.filter(
    (payment) => payment.status === 'paid' && payment.usedAssignedAgent === true
  );
  
  // Calculate average days from closing date to paid date
  const averageDaysClosedToPaid = computeAverage(
    paidPayments
      .map((payment) => {
        // Use paidDate as the end date
        const end = payment.paidDate ? new Date(payment.paidDate) : null;
        if (!end) {
          return null;
        }

        // Try to get closing date from payment first, then from referral SLA
        const closingDate = payment.closingDate
          ? new Date(payment.closingDate)
          : payment.referral?.sla?.lastClosedAt
          ? new Date(payment.referral.sla.lastClosedAt)
          : null;

        // If we have both dates, calculate the difference
        if (end && closingDate) {
          const days = differenceInCalendarDays(end, closingDate);
          return days >= 0 ? days : null; // Only return positive values
        }

        // Fallback to stored minutes from SLA if available
        const storedMinutes =
          payment.referral?.sla?.closedToPaidMinutes ?? payment.referral?.sla?.previousClosedToPaidMinutes ?? null;
        if (storedMinutes != null && storedMinutes >= 0) {
          return storedMinutes / (60 * 24);
        }

        // Last resort: use invoiceDate or updatedAt as fallback start date
        if (end) {
          const fallbackStart = closingDate ?? (payment.invoiceDate ? new Date(payment.invoiceDate) : new Date(payment.updatedAt));
          const days = differenceInCalendarDays(end, fallbackStart);
          return days >= 0 ? days : null;
        }

        return null;
      })
      .filter((value): value is number => value != null && !Number.isNaN(value))
  );

  const underContractOrLaterStatuses = new Set<AggregatedPayment['status']>([
    'under_contract',
    'past_inspection',
    'past_appraisal',
    'clear_to_close',
    'closed',
    'payment_sent',
    'paid'
  ]);
  const paymentsUnderContractOrLater = revenueEligiblePayments.filter((payment) =>
    underContractOrLaterStatuses.has(payment.status)
  );
  const averageDaysNewLeadToContract = computeAverage(
    paymentsUnderContractOrLater
      .map((payment) => {
        const storedDays = payment.referral?.sla?.daysToContract;
        if (storedDays != null && storedDays >= 0) {
          return storedDays;
        }

        const leadStart = payment.referral?.referralDate
          ? new Date(payment.referral.referralDate)
          : payment.referral?.createdAt
            ? new Date(payment.referral.createdAt)
            : null;
        const underContractAt = payment.referral?.sla?.lastUnderContractAt
          ? new Date(payment.referral.sla.lastUnderContractAt)
          : null;

        if (leadStart && underContractAt) {
          return differenceInCalendarDays(underContractAt, leadStart);
        }

        if (leadStart && payment.status === 'under_contract') {
          const paymentCreatedAt = new Date(payment.updatedAt);
          return differenceInCalendarDays(paymentCreatedAt, leadStart);
        }

        return null;
      })
      .filter((value): value is number => value != null && value >= 0)
  );

  const revenueContributingClosedDeals = revenueEligiblePayments.filter(
    (payment) => payment.status === 'closed' || payment.status === 'paid'
  );
  const closedDealPrices = revenueContributingClosedDeals
    .map((payment) =>
      payment.contractPriceCents ??
      payment.referral?.closedPriceCents ??
      payment.referral?.estPurchasePriceCents ??
      null
    )
    .filter((value): value is number => value != null && value > 0);
  const averageRevenuePerDealCents = revenueContributingClosedDeals.length
    ? realizedRevenueCents / revenueContributingClosedDeals.length
    : 0;
  const totalVolumeClosedCents = dealsClosed.reduce((sum, payment) => {
    const contractPrice = payment.contractPriceCents ?? 0;
    return contractPrice > 0 ? sum + contractPrice : sum;
  }, 0);
  const averageClosedDealAmountCents = computeAverage(closedDealPrices);

  const revenueBySourceMap = new Map<string, number>();
  const revenueByEndorserMap = new Map<string, number>();
  const revenueByStateMap = new Map<string, number>();

  revenueEligiblePayments.forEach((payment) => {
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
    filteredReferrals
      .map((referral) => referral.preApprovalAmountCents ?? 0)
      .filter((amount) => amount > 0)
  );

  const averageReferralFeePaidCents = computeAverage(
    paidPayments
      .map((payment) => payment.receivedAmountCents ?? 0)
      .filter((amount) => amount > 0)
  );

  const pipelineValueCents = filteredReferrals
    .filter((referral) => ACTIVE_PIPELINE_STATUSES.has((referral.status as string | undefined) ?? ''))
    .reduce((sum, referral) => sum + (referral.preApprovalAmountCents ?? 0), 0);

  const activePipeline = filteredReferrals.filter((referral) =>
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

  const monthCandidates: Date[] = [];
  referralsByNetwork.forEach((referral) => {
    if (referral.createdAt) monthCandidates.push(new Date(referral.createdAt));
  });
  paymentsByNetwork.forEach((payment) => {
    if (payment.metricDate) monthCandidates.push(payment.metricDate);
  });

  const preApprovalMetrics = await PreApprovalMetric.find()
    .sort({ month: 1 })
    .lean();

  preApprovalMetrics.forEach((metric) => monthCandidates.push(metric.month));

  const earliestMonth = monthCandidates.length
    ? startOfMonth(
        monthCandidates.reduce((earliest, date) => (date < earliest ? date : earliest), monthCandidates[0])
      )
    : startOfMonth(subMonths(new Date(), 11));

  const monthBuckets: { key: string; label: string; year: number; month: number }[] = [];
  let cursor = earliestMonth;
  const finalMonth = startOfMonth(new Date());

  while (cursor <= finalMonth) {
    monthBuckets.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1
    });
    cursor = startOfMonth(addMonths(cursor, 1));
  }

  const referralMonthlyMap = new Map<
    string,
    { total: number; transfers: number; ahaReferrals: number; ahaOosReferrals: number }
  >();
  referralsByNetwork.forEach((referral) => {
    if (!referral.createdAt) return;
    const createdAt = new Date(referral.createdAt);
    const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
    const current =
      referralMonthlyMap.get(key) ?? { total: 0, transfers: 0, ahaReferrals: 0, ahaOosReferrals: 0 };
    current.total += 1;
    if (referral.origin === 'admin' && referral.lender) {
      current.transfers += 1;
    }
    const designation = getReferralDesignation(referral);
    if (designation === 'AHA') {
      current.ahaReferrals += 1;
    } else if (designation === 'AHA_OOS') {
      current.ahaOosReferrals += 1;
    }
    referralMonthlyMap.set(key, current);
  });

  const dealMonthlyMap = new Map<string, { dealsClosed: number; revenueReceivedCents: number }>();
  paymentsByNetwork.forEach((payment) => {
    const metricDate = payment.metricDate ?? resolveMetricDate(payment);
    if (!metricDate) return;
    if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
    if (payment.usedAssignedAgent !== true) return;
    if (!['closed', 'payment_sent', 'paid'].includes(payment.status)) return;

    const key = `${metricDate.getFullYear()}-${String(metricDate.getMonth() + 1).padStart(2, '0')}`;
    const current = dealMonthlyMap.get(key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
    current.dealsClosed += 1;
    current.revenueReceivedCents += payment.receivedAmountCents ?? 0;
    dealMonthlyMap.set(key, current);
  });

  const preApprovalMap = new Map<
    string,
    { preApprovals: number; ahaPreApprovals: number; ahaOosPreApprovals: number; updatedAt: Date }
  >();
  preApprovalMetrics.forEach((metric) => {
    const key = `${metric.month.getFullYear()}-${String(metric.month.getMonth() + 1).padStart(2, '0')}`;
    preApprovalMap.set(key, {
      preApprovals: metric.preApprovals,
      ahaPreApprovals: metric.ahaPreApprovals ?? 0,
      ahaOosPreApprovals: metric.ahaOosPreApprovals ?? 0,
      updatedAt: metric.updatedAt
    });
  });

  const monthlyReferrals = monthBuckets.map((bucket) => {
    const referralStats =
      referralMonthlyMap.get(bucket.key) ?? { total: 0, transfers: 0, ahaReferrals: 0, ahaOosReferrals: 0 };
    const dealStats = dealMonthlyMap.get(bucket.key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
    const preApprovalStats =
      preApprovalMap.get(bucket.key) ?? { preApprovals: 0, ahaPreApprovals: 0, ahaOosPreApprovals: 0, updatedAt: undefined };
    const monthlyCloseRate = referralStats.total === 0
      ? 0
      : (dealStats.dealsClosed / Math.max(referralStats.total, 1)) * 100;
    const totalPreApprovals = preApprovalStats.preApprovals > 0
      ? preApprovalStats.preApprovals
      : preApprovalStats.ahaPreApprovals + preApprovalStats.ahaOosPreApprovals;

    const conversionRate =
      totalPreApprovals > 0 ? Number(((referralStats.total / totalPreApprovals) * 100).toFixed(1)) : 0;

    const ahaConversionRate =
      preApprovalStats.ahaPreApprovals > 0
        ? Number(((referralStats.ahaReferrals / preApprovalStats.ahaPreApprovals) * 100).toFixed(1))
        : 0;

    const ahaOosConversionRate =
      preApprovalStats.ahaOosPreApprovals > 0
        ? Number(((referralStats.ahaOosReferrals / preApprovalStats.ahaOosPreApprovals) * 100).toFixed(1))
        : 0;

    return {
      monthKey: bucket.key,
      label: bucket.label,
      totalReferrals: referralStats.total,
      mcTransfers: referralStats.transfers,
      ahaReferrals: referralStats.ahaReferrals,
      ahaOosReferrals: referralStats.ahaOosReferrals,
      dealsClosed: dealStats.dealsClosed,
      revenueReceivedCents: dealStats.revenueReceivedCents,
      closeRate: Number(monthlyCloseRate.toFixed(1)),
      preApprovals: preApprovalStats.preApprovals,
      ahaPreApprovals: preApprovalStats.ahaPreApprovals,
      ahaOosPreApprovals: preApprovalStats.ahaOosPreApprovals,
      conversionRate,
      conversionRateAha: ahaConversionRate,
      conversionRateAhaOos: ahaOosConversionRate,
      preApprovalsUpdatedAt: preApprovalStats.updatedAt
    };
  });

  const afcRelevant = filteredPaymentsByNetwork.filter(
    (payment) =>
      payment.referral?.org === 'AFC' &&
      closedOrPaidStatuses.has(payment.status)
  );
  const afcDealsLost = afcRelevant.filter((payment) => !payment.usedAfc).length;
  const afcAttachRate = afcRelevant.length
    ? (afcRelevant.filter((payment) => Boolean(payment.usedAfc)).length / afcRelevant.length) * 100
    : 0;

  const ahaRelevant = filteredPaymentsByNetwork.filter((payment) => {
    if (!closedOrPaidStatuses.has(payment.status)) return false;
    const designation = getAgentDesignation(payment);
    return designation === 'AHA';
  });
  const ahaAttached = ahaRelevant.filter((payment) => Boolean(payment.usedAssignedAgent));
  const ahaDealsLost = ahaRelevant.length - ahaAttached.length;
  const ahaAttachRate = ahaRelevant.length ? (ahaAttached.length / ahaRelevant.length) * 100 : 0;

  const ahaOosRelevant = filteredPaymentsByNetwork.filter((payment) => {
    if (!closedOrPaidStatuses.has(payment.status)) return false;
    const designation = getAgentDesignation(payment);
    return designation === 'AHA_OOS';
  });
  const ahaOosAttached = ahaOosRelevant.filter((payment) => Boolean(payment.usedAssignedAgent));
  const ahaOosDealsLost = ahaOosRelevant.length - ahaOosAttached.length;
  const ahaOosAttachRate = ahaOosRelevant.length
    ? (ahaOosAttached.length / ahaOosRelevant.length) * 100
    : 0;

  // MC Leaderboard: Build leaderboard from referral counts by MC
  // Sorts by referral count descending and returns top 10
  const buildMcRequestLeaderboard = (sourceMap: Map<string, number>) =>
    Array.from(sourceMap.entries())
      .map(([key, value]) => ({
        id: key,
        name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
        referrals: value
      }))
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, 10);

  // MC Revenue and Close Rate tracking
  // Revenue map tracks: realized revenue, expected revenue, closed deals, and total referrals per MC
  // Close rate map tracks: closed deals and total referrals for calculating close rate percentage
  const mcRevenueMap = new Map<string, { revenue: number; expected: number; closed: number; totalReferrals: number }>();
  const mcCloseRateMap = new Map<string, { closed: number; total: number }>();

  const referralByMcMap = new Map<string, number>();
  const referralByMcAhaMap = new Map<string, number>();
  const referralByMcAhaOosMap = new Map<string, number>();
  const allReferralDates = filteredReferrals.map((referral) => referral.createdAt);
  const ahaReferralDates: Date[] = [];
  const ahaOosReferralDates: Date[] = [];
  filteredReferrals.forEach((referral) => {
    const key = referral.lender ? referral.lender.toString() : 'unassigned';
    referralByMcMap.set(key, (referralByMcMap.get(key) ?? 0) + 1);

    const designation = getReferralDesignation(referral);
    if (designation === 'AHA') {
      referralByMcAhaMap.set(key, (referralByMcAhaMap.get(key) ?? 0) + 1);
      ahaReferralDates.push(referral.createdAt);
    } else if (designation === 'AHA_OOS') {
      referralByMcAhaOosMap.set(key, (referralByMcAhaOosMap.get(key) ?? 0) + 1);
      ahaOosReferralDates.push(referral.createdAt);
    }
  });

  const mcRequestTrend = {
    all: groupTrendByTimeframe(allReferralDates, timeframe),
    aha: groupTrendByTimeframe(ahaReferralDates, timeframe),
    ahaOos: groupTrendByTimeframe(ahaOosReferralDates, timeframe)
  };

  // Aggregate MC metrics from payments
  // Excludes deals attributed to outside agents from revenue/close rate calculations
  filteredPaymentsByNetwork.forEach((payment) => {
    const key = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    const current = mcRevenueMap.get(key) ?? { revenue: 0, expected: 0, closed: 0, totalReferrals: referralByMcMap.get(key) ?? 0 };
    const isOutsideAgentDeal = payment.agentAttribution === 'OUTSIDE_AGENT';
    if (!isOutsideAgentDeal) {
      current.revenue += payment.receivedAmountCents ?? 0;
      current.expected += calculateOutstandingExpected(payment);
    }
    if (!isOutsideAgentDeal && (payment.status === 'closed' || payment.status === 'paid')) {
      current.closed += 1;
    }
    current.totalReferrals = referralByMcMap.get(key) ?? current.totalReferrals;
    mcRevenueMap.set(key, current);

    const closeStats = mcCloseRateMap.get(key) ?? { closed: 0, total: referralByMcMap.get(key) ?? 0 };
    if (!isOutsideAgentDeal && (payment.status === 'closed' || payment.status === 'paid')) {
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

  // Agent Leaderboard: Count referrals per agent from filtered referrals
  const agentReferralCount = new Map<string, number>();
  filteredReferrals.forEach((referral) => {
    const key = referral.assignedAgent ? referral.assignedAgent.toString() : 'unassigned';
    agentReferralCount.set(key, (agentReferralCount.get(key) ?? 0) + 1);
  });

  // Agent Revenue Map: Comprehensive tracking of agent performance metrics
  // - revenue: Realized revenue (received amounts)
  // - expected: Outstanding expected revenue
  // - closed: Number of closed deals
  // - totalReferrals: Total referrals assigned to agent
  // - commissionCents/Percentages: For calculating average commission
  // - referralFeePercentages: For calculating average referral fee
  // - netCommissionCents: Agent's net earnings (commission - referral fee paid)
  // - closedVolumeCents: Total contract value of closed deals
  const agentRevenueMap = new Map<
    string,
    {
      revenue: number;
      expected: number;
      closed: number;
      totalReferrals: number;
      commissionCents: number[];
      commissionPercentages: number[];
      referralFeePercentages: number[];
      netCommissionCents: number;
      closedVolumeCents: number;
    }
  >();
  // Track deals lost to outside agents per agent
  const agentLostDealsMap = new Map<string, number>();

  // Aggregate agent metrics from payments
  // Excludes terminated deals and tracks outside agent attribution separately
  filteredPaymentsByNetwork.forEach((payment) => {
    if (payment.status === 'terminated') {
      return;
    }
    const key = payment.referral?.assignedAgent ? payment.referral.assignedAgent.toString() : 'unassigned';
    const current = agentRevenueMap.get(key) ?? {
      revenue: 0,
      expected: 0,
      closed: 0,
      totalReferrals: agentReferralCount.get(key) ?? 0,
      commissionCents: [],
      commissionPercentages: [],
      referralFeePercentages: [],
      netCommissionCents: 0,
      closedVolumeCents: 0
    };
    const isOutsideAgentDeal = payment.agentAttribution === 'OUTSIDE_AGENT';
    const contractPriceCents =
      payment.contractPriceCents ?? payment.referral?.closedPriceCents ?? payment.referral?.estPurchasePriceCents ?? 0;
    
    // Only count revenue for deals that stayed with assigned agent
    if (!isOutsideAgentDeal) {
      current.revenue += payment.receivedAmountCents ?? 0;
      current.expected += calculateOutstandingExpected(payment);
    }
    
    if (payment.status === 'closed' || payment.status === 'paid') {
      if (!isOutsideAgentDeal) {
        current.closed += 1;
        if (contractPriceCents > 0) {
          current.closedVolumeCents += contractPriceCents;
        }
        
        // Calculate commission and referral fee percentages for averages
        const referralFeeCents = payment.referral?.referralFeeDueCents ?? 0;
        let referralFeePercent: number | null =
          typeof payment.referral?.referralFeeBasisPoints === 'number'
            ? (payment.referral.referralFeeBasisPoints ?? 0) / 100
            : null;
        if ((!referralFeePercent || referralFeePercent <= 0) && contractPriceCents > 0 && referralFeeCents > 0) {
          referralFeePercent = (referralFeeCents / contractPriceCents) * 100;
        }
        const commissionBasisPoints = payment.referral?.commissionBasisPoints ?? 0;
        const commissionPercent = commissionBasisPoints / 100;
        const commissionCents = (contractPriceCents * commissionBasisPoints) / 10000;
        
        if (commissionPercent > 0) {
          current.commissionPercentages.push(commissionPercent);
          if (commissionCents > 0) {
            current.commissionCents.push(commissionCents);
          }
        }
        if (referralFeePercent && referralFeePercent > 0) {
          current.referralFeePercentages.push(referralFeePercent);
        }
        
        // Net commission = commission earned - referral fee paid (only for paid deals)
        if (payment.status === 'paid' && commissionBasisPoints > 0) {
          const paidReferralFeeCents = payment.receivedAmountCents ?? referralFeeCents;
          current.netCommissionCents += commissionCents - paidReferralFeeCents;
        }
      } else {
        // Track deals lost to outside agents
        agentLostDealsMap.set(key, (agentLostDealsMap.get(key) ?? 0) + 1);
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

  const agentAverageClosedDeal = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.closed > 0 ? value.closedVolumeCents / value.closed : 0,
    }))
    .sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0))
    .slice(0, 10);

  const agentCommissionValues = Array.from(agentRevenueMap.values())
    .flatMap((value) => value.commissionCents);
  const averageAgentCommissionCents = computeAverage(agentCommissionValues);

  const agentCommissionPercentages = Array.from(agentRevenueMap.values())
    .flatMap((value) => value.commissionPercentages);
  const averageAgentCommissionPercent = computeAverage(agentCommissionPercentages);
  const agentCommissionSampleSize = agentCommissionPercentages.length;

  const agentReferralFeePercentages = Array.from(agentRevenueMap.values())
    .flatMap((value) => value.referralFeePercentages);
  const averageReferralFeePercent = computeAverage(agentReferralFeePercentages);
  const referralFeeSampleSize = agentReferralFeePercentages.length;

  const agentNetRevenue = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.netCommissionCents
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const agentLostDeals = Array.from(agentLostDealsMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      referrals: value
    }))
    .sort((a, b) => b.referrals - a.referrals)
    .slice(0, 10);

  const agentCreatedMcAssignmentCount = new Map<string, number>();
  filteredReferrals.forEach((referral) => {
    if (referral.origin === 'agent' && referral.lender && referral.assignedAgent) {
      const key = referral.assignedAgent.toString();
      agentCreatedMcAssignmentCount.set(key, (agentCreatedMcAssignmentCount.get(key) ?? 0) + 1);
    }
  });

  const agentCreatedMcLeaderboard = Array.from(agentCreatedMcAssignmentCount.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      referrals: value
    }))
    .sort((a, b) => b.referrals - a.referrals)
    .slice(0, 10);

  const adminEligibleReferrals = referralsByNetwork.filter((referral) => {
    const metricDate = getSlaMetricDate(referral, referral.createdAt ?? null);
    return metricDate ? isWithinTimeframe(metricDate) : false;
  });

  const assignedReferrals = adminEligibleReferrals.filter((referral) => Boolean(referral.assignedAgent)).length;
  const unassignedReferrals = Math.max(adminEligibleReferrals.length - assignedReferrals, 0);
  const assignmentRate = adminEligibleReferrals.length
    ? (assignedReferrals / adminEligibleReferrals.length) * 100
    : 0;

  const slaFields = adminEligibleReferrals
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

  const daysToContractValues = adminEligibleReferrals
    .filter((referral): referral is typeof referral & { sla: NonNullable<typeof referral.sla> } =>
      Boolean(referral.sla)
    )
    .map((referral) => {
      const stored = referral.sla.daysToContract;
      if (stored != null && stored >= 0) return stored;

      const referralDate = referral.referralDate ? new Date(referral.referralDate) : null;
      const lastUnderContractAt = referral.sla.lastUnderContractAt
        ? new Date(referral.sla.lastUnderContractAt)
        : null;
      if (referralDate && lastUnderContractAt && lastUnderContractAt >= referralDate) {
        return differenceInCalendarDays(lastUnderContractAt, referralDate);
      }
      return null;
    })
    .filter((value): value is number => value != null && value >= 0);
  const daysToContractAvg = computeAverage(daysToContractValues);

  const daysToCloseAvg = computeAverage(
    slaFields
      .map((sla) => sla.daysToClose ?? null)
      .filter((value): value is number => value != null)
  );

  const adminAverageLeadToContract = daysToContractAvg;
  const adminAverageContractToClose = daysToCloseAvg;

  const terminatedDealsByReason = terminatedWithinNetwork.reduce((map, payment) => {
    const reason = payment.terminatedReason;
    if (!reason) return map;
    map.set(reason, (map.get(reason) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  const totalTerminatedWithReason = Array.from(terminatedDealsByReason.values()).reduce(
    (sum, value) => sum + value,
    0
  );

  const terminatedReasonBreakdown = Array.from(terminatedDealsByReason.entries())
    .map(([reason, value]) => ({
      label: TERMINATED_REASON_LABELS[reason] ?? reason,
      value,
      percentage: totalTerminatedWithReason ? (value / totalTerminatedWithReason) * 100 : 0
    }))
    .sort((a, b) => b.value - a.value);

  const terminatedDeals = terminatedWithinNetwork.map((payment) => ({
    id: payment._id.toString(),
    reasonKey: payment.terminatedReason ?? 'unknown',
    reasonLabel: TERMINATED_REASON_LABELS[payment.terminatedReason ?? 'unknown'] ?? 'Unknown',
    lostReferralFeeCents:
      payment.expectedAmountCents ?? payment.referral?.referralFeeDueCents ?? 0,
    mcName: payment.referral?.lender
      ? lenderNameMap.get(payment.referral.lender.toString()) ?? 'Unassigned MC'
      : 'Unassigned MC',
    agentName: payment.referral?.assignedAgent
      ? agentNameMap.get(payment.referral.assignedAgent.toString()) ?? 'Unassigned Agent'
      : 'Unassigned Agent'
  }));

  const terminatedDealsSummary = {
    breakdown: terminatedReasonBreakdown,
    totalLostReferralFeeCents: terminatedDeals.reduce((sum, deal) => sum + deal.lostReferralFeeCents, 0),
    totalDeals: terminatedDeals.length,
    deals: terminatedDeals
      .sort((a, b) => b.lostReferralFeeCents - a.lostReferralFeeCents)
      .slice(0, 10)
  };

  const preApprovalConversionTrend = monthlyReferrals.reduce(
    (acc, entry) => {
      acc.all.push({ key: entry.monthKey, label: entry.label, value: entry.conversionRate });
      acc.aha.push({ key: entry.monthKey, label: entry.label, value: entry.conversionRateAha });
      acc.ahaOos.push({ key: entry.monthKey, label: entry.label, value: entry.conversionRateAhaOos });
      return acc;
    },
    { all: [] as TrendPoint[], aha: [] as TrendPoint[], ahaOos: [] as TrendPoint[] }
  );

  const hasMonthlyActivity = (entry: (typeof monthlyReferrals)[number]) =>
    entry.totalReferrals > 0 ||
    entry.preApprovals > 0 ||
    entry.ahaPreApprovals > 0 ||
    entry.ahaOosPreApprovals > 0 ||
    entry.dealsClosed > 0 ||
    entry.revenueReceivedCents > 0;

  const preApprovalEntries = monthlyReferrals
    .filter(hasMonthlyActivity)
    .map((entry) => ({
      monthKey: entry.monthKey,
      label: entry.label,
      totalReferrals: entry.totalReferrals,
      ahaReferrals: entry.ahaReferrals,
      ahaOosReferrals: entry.ahaOosReferrals,
      preApprovals: entry.preApprovals,
      ahaPreApprovals: entry.ahaPreApprovals,
      ahaOosPreApprovals: entry.ahaOosPreApprovals,
      conversionRate: entry.conversionRate,
      conversionRateAha: entry.conversionRateAha,
      conversionRateAhaOos: entry.conversionRateAhaOos,
      updatedAt: entry.preApprovalsUpdatedAt
    }));

  // AGIT Dashboard Metrics: Filter referrals where endorser is "Glenn Beck"
  const glennBeckReferrals = referralsByNetwork.filter((referral) => {
    const endorser = referral.endorser?.trim().toLowerCase();
    return endorser === 'glenn beck';
  });

  const glennBeckReferralsInTimeframe = glennBeckReferrals.filter((referral) =>
    isWithinTimeframe(referral.createdAt)
  );

  const glennBeckReferralIds = new Set(glennBeckReferralsInTimeframe.map((r) => r._id.toString()));

  // Filter payments for Glenn Beck referrals
  const glennBeckPayments = paymentsByNetwork.filter((payment) =>
    glennBeckReferralIds.has(payment.referral._id.toString())
  );

  const glennBeckFilteredPayments = filteredPaymentsByNetwork.filter((payment) =>
    glennBeckReferralIds.has(payment.referral._id.toString())
  );

  // Calculate AGIT metrics
  const agitTotalReferrals = glennBeckReferralsInTimeframe.length;
  const agitGlennBeckReferrals = agitTotalReferrals; // Same value for clarity

  // Lost referrals (status === 'Lost')
  const agitLostReferrals = glennBeckReferralsInTimeframe.filter(
    (referral) => referral.status === 'Lost'
  ).length;

  // Closed/paid deals
  const agitDealsClosed = glennBeckFilteredPayments.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      (payment.status === 'closed' || payment.status === 'paid')
  ).length;

  // Close rate
  const agitCloseRate = agitTotalReferrals === 0 ? 0 : (agitDealsClosed / agitTotalReferrals) * 100;

  // Used AFC / AFC Attach Rate
  // Count payments where usedAfc === false (went to another lender, not AFC)
  const agitClosedOrPaidPayments = glennBeckFilteredPayments.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      (payment.status === 'closed' || payment.status === 'paid')
  );

  const agitUsedAfcCount = agitClosedOrPaidPayments.filter((payment) => !payment.usedAfc).length;
  const agitUsedAfcRate =
    agitClosedOrPaidPayments.length === 0
      ? 0
      : (agitUsedAfcCount / agitClosedOrPaidPayments.length) * 100;

  const timeframeResponse = {
    key: timeframe.key,
    label: timeframe.label,
    start: timeframe.start?.toISOString() ?? null,
    end: timeframe.end?.toISOString() ?? null
  };

  const responsePayload = {
    timeframe: timeframeResponse,
    permissions: {
      canViewGlobal: role === 'admin',
      role: role ?? null
    },
    main: {
      summary: {
        totalReferrals,
        dealsClosed: dealsClosed.length,
        dealsUnderContract: dealsUnderContract.length,
        pendingClosings: pendingClosings.length,
        pendingClosingsThisMonth: pendingClosingsThisMonth.length,
        pendingClosingsNextMonth: pendingClosingsNextMonth.length,
        closeRate,
        afcDealsLost,
        afcAttachRate,
        ahaDealsLost,
        ahaAttachRate,
        ahaOosDealsLost,
        ahaOosAttachRate,
    activePipeline,
    expectedRevenueCents,
    realizedRevenueCents,
    closedNotPaidCents,
    averageDaysNewLeadToContract,
    averageDaysClosedToPaid,
    averageClosedDealAmountCents,
    averageRevenuePerDealCents,
    totalVolumeClosedCents,
    averagePaAmountCents,
    averageReferralFeePaidCents,
    pipelineValueCents,
    lostReferrals: lostReferrals.length
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
        ahaReferrals: entry.ahaReferrals,
        ahaOosReferrals: entry.ahaOosReferrals,
        preApprovals: entry.preApprovals,
        ahaPreApprovals: entry.ahaPreApprovals,
        ahaOosPreApprovals: entry.ahaOosPreApprovals,
        conversionRate: entry.conversionRate,
        conversionRateAha: entry.conversionRateAha,
        conversionRateAhaOos: entry.conversionRateAhaOos,
        updatedAt: entry.preApprovalsUpdatedAt
      })),
      preApprovalConversion: {
        trend: preApprovalConversionTrend,
        entries: preApprovalEntries
      },
      terminatedDeals: terminatedDealsSummary
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
      averageReferralFeePercent,
      referralFeeSampleSize,
      commissionSampleSize: agentCommissionSampleSize,
      referralLeaderboard: agentReferralLeaderboard,
      closeRateLeaderboard: agentCloseRateLeaderboard,
      revenuePaid: agentRevenuePaid,
      revenueExpected: agentRevenueExpected,
      averageClosedDealAmount: agentAverageClosedDeal,
      netRevenue: agentNetRevenue,
      lostDeals: agentLostDeals,
      agentCreatedMcAssignments: agentCreatedMcLeaderboard
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
      totalReferrals: adminEligibleReferrals.length,
      assignedReferrals,
      unassignedReferrals,
      assignmentRate,
      firstContactWithin24HoursRate,
      firstContactWithin24HoursCount,
      firstContactSampleSize: firstContactRecords.length
    },
    agit: {
      totalReferrals: agitTotalReferrals,
      glennBeckReferrals: agitGlennBeckReferrals,
      usedAfcCount: agitUsedAfcCount,
      usedAfcRate: agitUsedAfcRate,
      lostReferrals: agitLostReferrals,
      closeRate: agitCloseRate,
      dealsClosed: agitDealsClosed
    }
  };

  return NextResponse.json(responsePayload);
}
