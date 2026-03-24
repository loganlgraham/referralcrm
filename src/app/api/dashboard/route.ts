import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  endOfMonth,
  startOfHour,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears
} from 'date-fns';
import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { zipToState, inferStateFromLocationText } from '@/utils/location';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { PreApprovalMetric } from '@/models/pre-approval-metric';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';
import { Activity } from '@/models/activity';

type TimeframeKey = 'day' | 'week' | 'month' | 'next_month' | 'year' | 'ytd' | 'all' | 'custom';
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
  commissionFlatFeeCents?: number | null;
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
  updatedAt?: Date;
  referralDate?: Date | null;
  statusLastUpdated?: Date;
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
  buySideAgent?: Types.ObjectId | null;
  sellSideAgent?: Types.ObjectId | null;
  lender?: Types.ObjectId | null;
  status?: string;
  preApprovalAmountCents?: number;
  loanFileNumber?: string;
  borrower?: {
    name?: string;
  };
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
  next_month: 'Next Month',
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

const CLOSED_DEAL_STATUSES = new Set<AggregatedPayment['status']>([
  'closed',
  'payment_sent',
  'paid'
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
    value === 'next_month' ||
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
    case 'next_month': {
      const nextMonth = addMonths(now, 1);
      return {
        key: 'next_month',
        label: TIMEFRAME_LABELS.next_month,
        start: startOfMonth(nextMonth),
        end: endOfMonth(nextMonth)
      };
    }
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
        end: endOfMonth(now)
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

function extractState(referral: AggregatedPayment['referral']): string;
function extractState(referral: { propertyState?: string; propertyAddress?: string; borrowerCurrentAddress?: string }): string;
function extractState(
  referral: { propertyState?: string; propertyAddress?: string; borrowerCurrentAddress?: string }
): string {
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

type ReferralForState = {
  lookingInZip?: string;
  lookingInZips?: string[] | null;
  propertyState?: string;
  propertyAddress?: string;
  borrowerCurrentAddress?: string;
};

async function extractStateAsync(referral: ReferralForState): Promise<string> {
  const zips = Array.isArray(referral.lookingInZips)
    ? referral.lookingInZips.filter((z) => typeof z === 'string' && /^\d{5}$/.test(z.trim()))
    : [];
  const primaryZip =
    zips[0] ??
    (referral.lookingInZip && /^\d{5}$/.test(referral.lookingInZip.trim()) ? referral.lookingInZip.trim() : null);
  if (primaryZip) {
    const state = zipToState(primaryZip);
    if (state) return state;
  }

  const normalizedState = referral.propertyState?.toString().trim().toUpperCase();
  if (normalizedState) return normalizedState;

  const candidates = [referral.propertyAddress, referral.borrowerCurrentAddress];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/,\s*([A-Za-z]{2})\s*\d{5}/);
    if (match?.[1]) return match[1].toUpperCase();
    const looseMatch = candidate.match(/,\s*([A-Za-z]{2})\b/);
    if (looseMatch?.[1]) return looseMatch[1].toUpperCase();
  }

  const fallbackTexts = [
    referral.propertyState,
    referral.propertyAddress,
    referral.borrowerCurrentAddress
  ].filter((t): t is string => Boolean(t?.toString().trim()));
  for (const text of fallbackTexts) {
    const state = await inferStateFromLocationText(text.toString().trim());
    if (state) return state;
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

/** Closing date for bucketing "generated" revenue (when the deal closed). */
function resolveClosingDate(payment: AggregatedPayment): Date | null {
  if (payment.closingDate) return payment.closingDate;
  const lastClosedAt = payment.referral?.sla?.lastClosedAt;
  if (lastClosedAt) return typeof lastClosedAt === 'string' ? new Date(lastClosedAt) : lastClosedAt;
  return resolveMetricDate(payment);
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
      case 'month':
      case 'next_month': {
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

interface TimeframeBucket {
  key: string;
  label: string;
  sort: number;
}

function buildTimeframeBuckets(timeframe: TimeframeInfo): TimeframeBucket[] {
  const now = new Date();
  let effectiveKey: TimeframeKey = timeframe.key;
  let rangeStart: Date;
  let rangeEnd: Date;

  if (timeframe.key === 'custom') {
    const start = timeframe.start ?? startOfMonth(now);
    const end = timeframe.end ?? endOfDay(now);
    const dayDiff = Math.max(differenceInCalendarDays(end, start), 0);
    effectiveKey = dayDiff <= 1 ? 'day' : dayDiff <= 7 ? 'week' : dayDiff <= 31 ? 'month' : dayDiff <= 180 ? 'month' : 'year';
    rangeStart = startOfDay(start);
    rangeEnd = endOfDay(end);
  } else if (timeframe.key === 'all') {
    rangeStart = subYears(timeframe.end ?? now, 2);
    rangeEnd = endOfDay(timeframe.end ?? now);
    effectiveKey = 'year';
  } else {
    rangeStart = timeframe.start ? startOfDay(timeframe.start) : startOfDay(now);
    rangeEnd = timeframe.end ? endOfDay(timeframe.end) : endOfDay(now);
  }

  const buckets: TimeframeBucket[] = [];
  let cursor: Date;

  switch (effectiveKey) {
    case 'day': {
      cursor = startOfHour(rangeStart);
      const endHour = endOfDay(rangeEnd);
      while (cursor <= endHour) {
        buckets.push({
          key: format(cursor, 'yyyy-MM-dd-HH'),
          label: format(cursor, 'ha'),
          sort: cursor.getTime()
        });
        cursor = addHours(cursor, 1);
      }
      break;
    }
    case 'week': {
      cursor = startOfDay(rangeStart);
      while (cursor <= rangeEnd) {
        buckets.push({
          key: format(cursor, 'yyyy-MM-dd'),
          label: format(cursor, 'EEE dd'),
          sort: cursor.getTime()
        });
        cursor = addDays(cursor, 1);
      }
      break;
    }
    case 'month':
    case 'next_month': {
      cursor = startOfWeek(rangeStart, { weekStartsOn: 1 });
      const endWeek = startOfWeek(rangeEnd, { weekStartsOn: 1 });
      while (cursor <= endWeek) {
        buckets.push({
          key: `${format(cursor, 'yyyy')}-W${format(cursor, 'II')}`,
          label: format(cursor, 'MMM d'),
          sort: cursor.getTime()
        });
        cursor = addWeeks(cursor, 1);
      }
      break;
    }
    case 'year':
    case 'ytd':
    default: {
      cursor = startOfMonth(rangeStart);
      const endMonth = startOfMonth(rangeEnd);
      while (cursor <= endMonth) {
        buckets.push({
          key: format(cursor, 'yyyy-MM'),
          label: format(cursor, 'MMM yy'),
          sort: cursor.getTime()
        });
        cursor = addMonths(cursor, 1);
      }
      break;
    }
  }

  return buckets;
}

function getTimeframeBucketKey(date: Date, timeframe: TimeframeInfo): string {
  const now = new Date();
  let effectiveKey: TimeframeKey = timeframe.key;

  if (timeframe.key === 'custom' && timeframe.start && timeframe.end) {
    const dayDiff = Math.max(differenceInCalendarDays(timeframe.end, timeframe.start), 0);
    effectiveKey = dayDiff <= 1 ? 'day' : dayDiff <= 7 ? 'week' : dayDiff <= 31 ? 'month' : dayDiff <= 180 ? 'month' : 'year';
  } else if (timeframe.key === 'all') {
    effectiveKey = 'year';
  }

  const d = new Date(date);
  switch (effectiveKey) {
    case 'day':
      return format(startOfHour(d), 'yyyy-MM-dd-HH');
    case 'week':
      return format(startOfDay(d), 'yyyy-MM-dd');
    case 'month':
    case 'next_month':
      return `${format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy')}-W${format(startOfWeek(d, { weekStartsOn: 1 }), 'II')}`;
    case 'year':
    case 'ytd':
    default:
      return format(startOfMonth(d), 'yyyy-MM');
  }
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

function getPreviousPeriodRange(timeframe: TimeframeInfo): { start: Date; end: Date } | null {
  const currentStart = timeframe.start;
  const currentEnd = timeframe.end;
  if (!currentStart || !currentEnd || currentStart.getTime() >= currentEnd.getTime()) {
    return null;
  }

  switch (timeframe.key) {
    case 'all':
      return null;
    case 'day': {
      const previousDay = addDays(startOfDay(currentStart), -1);
      return {
        start: startOfDay(previousDay),
        end: endOfDay(previousDay)
      };
    }
    case 'week': {
      const currentWeekStart = startOfWeek(currentStart, { weekStartsOn: 1 });
      const previousWeekStart = startOfWeek(subWeeks(currentWeekStart, 1), { weekStartsOn: 1 });
      return {
        start: startOfDay(previousWeekStart),
        end: endOfDay(addDays(previousWeekStart, 6))
      };
    }
    case 'month': {
      const currentMonthStart = startOfMonth(currentStart);
      const previousMonthStart = startOfMonth(subMonths(currentMonthStart, 1));
      return {
        start: previousMonthStart,
        end: endOfMonth(previousMonthStart)
      };
    }
    case 'next_month': {
      const currentMonthStart = startOfMonth(currentStart);
      const previousMonthStart = startOfMonth(subMonths(currentMonthStart, 1));
      return {
        start: previousMonthStart,
        end: endOfMonth(previousMonthStart)
      };
    }
    case 'custom': {
      const periodMs = currentEnd.getTime() - currentStart.getTime();
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - periodMs);
      return {
        start: previousStart,
        end: previousEnd
      };
    }
    case 'year':
    case 'ytd':
    default: {
      const periodMs = currentEnd.getTime() - currentStart.getTime();
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - periodMs);
      return {
        start: previousStart,
        end: previousEnd
      };
    }
  }
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

  const attachDebugEnabled =
    request.nextUrl.searchParams.get('attachDebug') === '1' && session.user?.role === 'admin';
  const attachDebugDealId = request.nextUrl.searchParams.get('attachDealId')?.trim() || null;

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
        funnel: { stages: [] },
        periodOverPeriod: null,
        summary: {
          totalReferrals: 0,
          dealsClosed: 0,
          dealsClosedInTimeframe: 0,
          dealsUnderContract: 0,
          pendingClosings: 0,
          pendingClosingsThisMonth: 0,
          pendingClosingsNextMonth: 0,
          closeRate: 0,
          afcDealsLost: 0,
          afcDealsLostList: [],
          afcAttachRate: 0,
          ahaDealsLost: 0,
          ahaAttachRate: 0,
          ahaOosDealsLost: 0,
          ahaOosDealsLostList: [],
          ahaOosAttachRate: 0,
          activePipeline: 0,
          expectedRevenueCents: 0,
          realizedRevenueCents: 0,
          generatedRevenueCents: 0,
          closedNotPaidCents: 0,
          averageDaysNewLeadToContract: 0,
          averageDaysClosedToPaid: 0,
          averageClosedDealAmountCents: 0,
          averageRevenuePerDealCents: 0,
          totalVolumeClosedCents: 0,
          averagePaAmountCents: 0,
          averageReferralFeePaidCents: 0,
          pipelineValueCents: 0,
          lostReferrals: 0
        },
        trends: {
          revenue: [],
          revenueGenerated: [],
          deals: [],
          closeRate: [],
          referrals: []
        },
        revenueBySource: [],
        revenueByEndorser: [],
        revenueByState: [],
        referralRequestsBySource: [],
        referralRequestsByEndorser: [],
        referralRequestsByState: [],
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
        firstContactSampleSize: 0,
        overdueTaskCount: 0,
        dueTodayTaskCount: 0,
        completedInTimeframeCount: 0,
        totalOpenTasks: 0,
        taskActivityTrend: {
          outstanding: [],
          completed: [],
          created: []
        },
        stalePipelineCount: 0,
        stalePipelineList: []
      },
      agit: {
        agitReferrals: 0,
        agitPercentage: 0,
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
      'createdAt updatedAt referralDate status statusLastUpdated referralFeeDueCents referralFeeBasisPoints commissionBasisPoints estPurchasePriceCents preApprovalAmountCents assignedAgent buySideAgent sellSideAgent lender org ahaBucket propertyAddress propertyCity propertyState propertyPostalCode borrowerCurrentAddress closedPriceCents source endorser origin sla lookingInZip lookingInZips loanFileNumber borrower.name'
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
        commissionFlatFeeCents: 1,
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
    if (referral.buySideAgent) agentIds.add(referral.buySideAgent.toString());
    if (referral.sellSideAgent) agentIds.add(referral.sellSideAgent.toString());
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
      ? LenderMC.find({ _id: { $in: Array.from(lenderIds, (id) => new Types.ObjectId(id)) } }).select('name email phone')
      : Promise.resolve([]),
    agentIds.size
      ? Agent.find({ _id: { $in: Array.from(agentIds, (id) => new Types.ObjectId(id)) } }).select('name email phone ahaDesignation npsScore')
      : Promise.resolve([])
  ]);

  const lenderNameMap = new Map<string, string>();
  const lenderEmailMap = new Map<string, string | null>();
  const lenderPhoneMap = new Map<string, string | null>();
  lenders.forEach((lender) => {
    const id = lender._id.toString();
    lenderNameMap.set(id, lender.name || 'Unnamed MC');
    lenderEmailMap.set(id, lender.email ?? null);
    lenderPhoneMap.set(id, lender.phone ?? null);
  });

  const agentNameMap = new Map<string, string>();
  const agentEmailMap = new Map<string, string | null>();
  const agentPhoneMap = new Map<string, string | null>();
  agents.forEach((agent) => {
    const id = agent._id.toString();
    agentNameMap.set(id, agent.name || 'Unnamed Agent');
    agentEmailMap.set(id, agent.email ?? null);
    agentPhoneMap.set(id, agent.phone ?? null);
  });

  const agentDesignationMap = new Map<string, 'AHA' | 'AHA_OOS' | 'AGIT' | null>();
  const agentNpsMap = new Map<string, number | null>();
  agents.forEach((agent) => {
    const id = agent._id.toString();
    agentDesignationMap.set(id, agent.ahaDesignation ?? null);
    agentNpsMap.set(id, (agent as { npsScore?: number | null }).npsScore ?? null);
  });

  const getAgentDesignation = (payment: AggregatedPayment): 'AHA' | 'AHA_OOS' | 'AGIT' | null => {
    const agentId = payment.agentId ?? payment.referral?.assignedAgent;
    if (!agentId) return null;
    return agentDesignationMap.get(agentId.toString()) ?? null;
  };

  const getReferralDesignation = (referral: DashboardReferral): 'AHA' | 'AHA_OOS' | 'AGIT' | null => {
    const slots = [referral.assignedAgent, referral.buySideAgent, referral.sellSideAgent];
    for (const id of slots) {
      if (!id) continue;
      const des = agentDesignationMap.get(id.toString());
      if (des) return des;
    }
    return null;
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
    if (!date) return false;
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
  const referralRequestsBySourceMap = new Map<string, number>();
  const referralRequestsByEndorserMap = new Map<string, number>();
  const referralRequestsByStateMap = new Map<string, number>();
  for (const referral of filteredReferrals) {
    const source = String(referral.source ?? 'Unknown');
    referralRequestsBySourceMap.set(source, (referralRequestsBySourceMap.get(source) ?? 0) + 1);
    const endorser = referral.endorser?.trim() || 'Unattributed';
    referralRequestsByEndorserMap.set(endorser, (referralRequestsByEndorserMap.get(endorser) ?? 0) + 1);
    const state = await extractStateAsync(referral);
    referralRequestsByStateMap.set(state, (referralRequestsByStateMap.get(state) ?? 0) + 1);
  }
  // Close rate calculation: For accurate close rate, we need to match deals to referrals
  // created in the timeframe, not just deals closed in the timeframe.
  // This ensures we're measuring "of referrals created this period, how many closed?"
  // Use paymentsByNetwork (all payments) to count deals from referrals created in timeframe,
  // regardless of when the deal closed (cohort-based calculation)
  const filteredReferralIds = new Set(filteredReferrals.map((r) => r._id.toString()));
  
  const dealsClosedForCloseRate = paymentsByNetwork.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent === true &&
      CLOSED_DEAL_STATUSES.has(payment.status) &&
      filteredReferralIds.has(payment.referral._id.toString())
  );

  // Deals closed in timeframe: matches "Deals closed" graph logic (closed | payment_sent | paid)
  // Use paymentsByNetwork (same as graph) and filter by metricDate being within timeframe
  const dealsClosedInTimeframe = paymentsByNetwork.filter((payment) => {
    const metricDate = payment.metricDate ?? resolveMetricDate(payment);
    if (!metricDate) return false;
    if (timeframeStart && metricDate < timeframeStart) return false;
    if (timeframeEnd && metricDate > timeframeEnd) return false;
    if (payment.agentAttribution === 'OUTSIDE_AGENT') return false;
    if (payment.usedAssignedAgent !== true) return false;
    if (!CLOSED_DEAL_STATUSES.has(payment.status)) return false;
    return true;
  });
  
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
  const nonTerminatedStatuses = new Set([
    'under_contract',
    'past_inspection',
    'past_appraisal',
    'clear_to_close',
    'closed',
    'payment_sent',
    'paid'
  ]);
  const pendingClosingsThisMonth = paymentsByNetwork.filter((payment) => {
    if (payment.status === 'terminated') return false;
    if (!nonTerminatedStatuses.has(payment.status)) return false;
    if (payment.usedAssignedAgent !== true) return false;
    const closingDate = payment.closingDate ? new Date(payment.closingDate) : null;
    return (
      closingDate &&
      closingDate >= startOfCurrentMonth &&
      closingDate <= endOfCurrentMonth
    );
  });
  const pendingClosingsNextMonth = paymentsByNetwork.filter((payment) => {
    if (payment.status === 'terminated') return false;
    if (!nonTerminatedStatuses.has(payment.status)) return false;
    if (payment.usedAssignedAgent !== true) return false;
    const closingDate = payment.closingDate ? new Date(payment.closingDate) : null;
    return (
      closingDate &&
      closingDate >= startOfNextMonth &&
      closingDate <= endOfNextMonth
    );
  });
  const closeRate = totalReferrals === 0 ? 0 : (dealsClosedForCloseRate.length / totalReferrals) * 100;

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
  const isRevenueEligiblePayment = (payment: AggregatedPayment) =>
    payment.agentAttribution !== 'OUTSIDE_AGENT' &&
    !glennBeckReferralIdsSet.has(payment.referral._id.toString());

  const revenueEligiblePayments = filteredPaymentsByNetwork.filter((payment) =>
    isRevenueEligiblePayment(payment)
  );

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
    (payment) => CLOSED_DEAL_STATUSES.has(payment.status)
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
  const totalVolumeClosedCents = dealsClosedInTimeframe.reduce((sum, payment) => {
    const price =
      payment.contractPriceCents ??
      payment.referral?.closedPriceCents ??
      payment.referral?.estPurchasePriceCents ??
      0;
    return price > 0 ? sum + price : sum;
  }, 0);
  const averageClosedDealAmountCents = computeAverage(closedDealPrices);

  const revenueBySourceMap = new Map<string, number>();
  const revenueByEndorserMap = new Map<string, number>();
  const revenueByStateMap = new Map<string, number>();

  for (const payment of revenueEligiblePayments) {
    const revenue = payment.receivedAmountCents ?? 0;
    if (revenue <= 0) continue;

    const source = payment.referral?.source ?? 'Unknown';
    revenueBySourceMap.set(source, (revenueBySourceMap.get(source) ?? 0) + revenue);

    const endorser = payment.referral?.endorser?.trim() || 'Unattributed';
    revenueByEndorserMap.set(endorser, (revenueByEndorserMap.get(endorser) ?? 0) + revenue);

    const state = await extractStateAsync(payment.referral);
    revenueByStateMap.set(state, (revenueByStateMap.get(state) ?? 0) + revenue);
  }

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

  // Conversion funnel: stages in pipeline order; "Showing Homes" normalized to "Active Lead"
  const FUNNEL_ORDER = [
    'New Lead',
    'Paired',
    'In Communication',
    'Active Lead',
    'Under Contract',
    'Closed',
    'Lost',
    'Terminated'
  ] as const;
  const normalizeFunnelStatus = (status: string | undefined): string => {
    if (!status) return 'New Lead';
    return status === 'Showing Homes' ? 'Active Lead' : status;
  };
  const funnelCountByStatus = new Map<string, number>();
  FUNNEL_ORDER.forEach((s) => funnelCountByStatus.set(s, 0));
  const funnelDaysInStageByStatus = new Map<string, number[]>();
  filteredReferrals.forEach((referral) => {
    const status = normalizeFunnelStatus(referral.status);
    funnelCountByStatus.set(status, (funnelCountByStatus.get(status) ?? 0) + 1);
    const statusLastUpdated = referral.statusLastUpdated ?? referral.createdAt;
    if (statusLastUpdated) {
      const d = new Date(statusLastUpdated);
      if (!Number.isNaN(d.getTime())) {
        const days = differenceInCalendarDays(new Date(), d);
        const arr = funnelDaysInStageByStatus.get(status) ?? [];
        arr.push(days);
        funnelDaysInStageByStatus.set(status, arr);
      }
    }
  });
  const funnelStages = FUNNEL_ORDER.map((status, index) => {
    const count = funnelCountByStatus.get(status) ?? 0;
    const prevCount = index === 0 ? count : (funnelCountByStatus.get(FUNNEL_ORDER[index - 1]) ?? 0);
    const conversionFromPrevious = prevCount === 0 ? null : (count / prevCount) * 100;
    const dropOffPercent = prevCount === 0 ? null : 100 - (conversionFromPrevious ?? 0);
    const daysArr = funnelDaysInStageByStatus.get(status) ?? [];
    const avgDaysInStage = daysArr.length === 0 ? null : daysArr.reduce((a, b) => a + b, 0) / daysArr.length;
    return {
      status,
      label: status,
      count,
      conversionFromPrevious: conversionFromPrevious != null ? Number(conversionFromPrevious.toFixed(1)) : null,
      dropOffPercent: dropOffPercent != null ? Number(dropOffPercent.toFixed(1)) : null,
      avgDaysInStage: avgDaysInStage != null ? Number(avgDaysInStage.toFixed(1)) : null
    };
  });

  const revenueBySource = Array.from(revenueBySourceMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const revenueByEndorser = Array.from(revenueByEndorserMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const revenueByState = Array.from(revenueByStateMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const referralRequestsBySource = Array.from(referralRequestsBySourceMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const referralRequestsByEndorser = Array.from(referralRequestsByEndorserMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const referralRequestsByState = Array.from(referralRequestsByStateMap.entries())
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
  const referralIdsByMonth = new Map<string, Set<string>>();
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
    const ids = referralIdsByMonth.get(key) ?? new Set<string>();
    ids.add(referral._id.toString());
    referralIdsByMonth.set(key, ids);
  });

  // Generated revenue: bucket by closing date (when deal actually closed). Expected fee from closed deals.
  const dealsByClosingDate = new Map<string, { dealsClosed: number; revenueGeneratedCents: number }>();
  // Received revenue: bucket by metric date (when payment received/invoiced).
  const revenueReceivedByMonth = new Map<string, number>();
  paymentsByNetwork.forEach((payment) => {
    const metricDate = payment.metricDate ?? resolveMetricDate(payment);
    const closingDate = resolveClosingDate(payment);
    if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
    if (payment.usedAssignedAgent !== true) return;
    if (!CLOSED_DEAL_STATUSES.has(payment.status)) return;

    const expectedCents = Math.max(payment.expectedAmountCents ?? 0, 0);
    const receivedCents = payment.receivedAmountCents ?? 0;

    if (closingDate) {
      const closeKey = `${closingDate.getFullYear()}-${String(closingDate.getMonth() + 1).padStart(2, '0')}`;
      const current = dealsByClosingDate.get(closeKey) ?? { dealsClosed: 0, revenueGeneratedCents: 0 };
      current.dealsClosed += 1;
      current.revenueGeneratedCents += expectedCents;
      dealsByClosingDate.set(closeKey, current);
    }
    if (metricDate) {
      const receivedKey = `${metricDate.getFullYear()}-${String(metricDate.getMonth() + 1).padStart(2, '0')}`;
      revenueReceivedByMonth.set(receivedKey, (revenueReceivedByMonth.get(receivedKey) ?? 0) + receivedCents);
    }
  });

  // Close Rate: cohort-based (deals from referrals created in month X / referrals in month X)
  // Count closed, payment sent, and paid deals for a consistent closed-deal definition.
  const dealsFromCohort = new Map<string, number>();
  paymentsByNetwork.forEach((payment) => {
    if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
    if (payment.usedAssignedAgent !== true) return;
    if (!CLOSED_DEAL_STATUSES.has(payment.status)) return;

    const referralCreatedAt = payment.referral?.createdAt ? new Date(payment.referral.createdAt) : null;
    if (!referralCreatedAt) return;

    const key = `${referralCreatedAt.getFullYear()}-${String(referralCreatedAt.getMonth() + 1).padStart(2, '0')}`;
    const referralIds = referralIdsByMonth.get(key);
    if (!referralIds?.has(payment.referral._id.toString())) return;

    dealsFromCohort.set(key, (dealsFromCohort.get(key) ?? 0) + 1);
  });

  const timeframeBuckets = buildTimeframeBuckets(context.timeframe);
  const referralTimeframeMap = new Map<
    string,
    { total: number; transfers: number }
  >();
  filteredReferrals.forEach((referral) => {
    if (!referral.createdAt) return;
    const key = getTimeframeBucketKey(new Date(referral.createdAt), context.timeframe);
    const current = referralTimeframeMap.get(key) ?? { total: 0, transfers: 0 };
    current.total += 1;
    if (referral.origin === 'admin' && referral.lender) {
      current.transfers += 1;
    }
    referralTimeframeMap.set(key, current);
  });

  const dealTimeframeMap = new Map<string, { dealsClosed: number; revenueReceivedCents: number }>();
  const generatedByTimeframe = new Map<string, { dealsClosed: number; revenueGeneratedCents: number }>();
  filteredPaymentsByNetwork.forEach((payment) => {
    const metricDate = payment.metricDate ?? resolveMetricDate(payment);
    const closingDate = resolveClosingDate(payment);
    if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
    if (payment.usedAssignedAgent !== true) return;
    if (!CLOSED_DEAL_STATUSES.has(payment.status)) return;

    const expectedCents = Math.max(payment.expectedAmountCents ?? 0, 0);
    const receivedCents = payment.receivedAmountCents ?? 0;

    if (metricDate) {
      const key = getTimeframeBucketKey(new Date(metricDate), context.timeframe);
      const current = dealTimeframeMap.get(key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
      current.dealsClosed += 1;
      current.revenueReceivedCents += receivedCents;
      dealTimeframeMap.set(key, current);
    }
    if (closingDate) {
      const key = getTimeframeBucketKey(closingDate, context.timeframe);
      const current = generatedByTimeframe.get(key) ?? { dealsClosed: 0, revenueGeneratedCents: 0 };
      current.dealsClosed += 1;
      current.revenueGeneratedCents += expectedCents;
      generatedByTimeframe.set(key, current);
    }
  });

  // Close rate per bucket: deals whose referral was created in that bucket.
  // Use paymentsByNetwork (all payments) to count deals from referrals created in each bucket,
  // regardless of when the deal closed (cohort-based calculation)
  const dealsClosedByReferralBucket = new Map<string, number>();
  paymentsByNetwork.forEach((payment) => {
    if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
    if (payment.usedAssignedAgent !== true) return;
    if (!CLOSED_DEAL_STATUSES.has(payment.status)) return;
    const createdAt = payment.referral?.createdAt;
    if (!createdAt) return;
    const key = getTimeframeBucketKey(new Date(createdAt), context.timeframe);
    dealsClosedByReferralBucket.set(key, (dealsClosedByReferralBucket.get(key) ?? 0) + 1);
  });

  const mainTrends = timeframeBuckets.map((bucket) => {
    const referralStats = referralTimeframeMap.get(bucket.key) ?? { total: 0, transfers: 0 };
    const dealStats = dealTimeframeMap.get(bucket.key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
    const generatedStats = generatedByTimeframe.get(bucket.key) ?? { dealsClosed: 0, revenueGeneratedCents: 0 };
    const dealsClosedForCloseRate = dealsClosedByReferralBucket.get(bucket.key) ?? 0;
    const closeRate =
      referralStats.total === 0
        ? 0
        : (dealsClosedForCloseRate / Math.max(referralStats.total, 1)) * 100;
    return {
      key: bucket.key,
      label: bucket.label,
      totalReferrals: referralStats.total,
      mcTransfers: referralStats.transfers,
      dealsClosed: dealStats.dealsClosed,
      revenueReceivedCents: dealStats.revenueReceivedCents,
      revenueGeneratedCents: generatedStats.revenueGeneratedCents,
      closeRate: Number(closeRate.toFixed(1))
    };
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
    const closingStats = dealsByClosingDate.get(bucket.key) ?? { dealsClosed: 0, revenueGeneratedCents: 0 };
    const revenueReceivedCents = revenueReceivedByMonth.get(bucket.key) ?? 0;
    const cohortDeals = dealsFromCohort.get(bucket.key) ?? 0;
    const preApprovalStats =
      preApprovalMap.get(bucket.key) ?? { preApprovals: 0, ahaPreApprovals: 0, ahaOosPreApprovals: 0, updatedAt: undefined };
    const monthlyCloseRate = referralStats.total === 0
      ? 0
      : (cohortDeals / referralStats.total) * 100;
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
      dealsClosed: closingStats.dealsClosed,
      revenueGeneratedCents: closingStats.revenueGeneratedCents,
      revenueReceivedCents,
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

  // Derive card deals closed from same source as graph (dealsByClosingDate)
  const dealsClosedForSummary = (() => {
    let sum = 0;
    for (const [key, stats] of dealsByClosingDate) {
      const [y, m] = key.split('-').map(Number);
      const bucketStart = startOfMonth(new Date(y, m - 1, 1));
      if (timeframeEnd && bucketStart > timeframeEnd) continue;
      if (timeframeStart && bucketStart < timeframeStart) continue;
      sum += stats.dealsClosed;
    }
    return sum;
  })();

  // Generated revenue in timeframe (by closing date)
  const generatedRevenueCentsForSummary = (() => {
    let sum = 0;
    for (const bucket of timeframeBuckets) {
      const stats = generatedByTimeframe.get(bucket.key);
      if (stats) sum += stats.revenueGeneratedCents;
    }
    return sum;
  })();

  // Derive card close rate from same source as graph (monthlyReferrals)
  const closeRateForSummary = (() => {
    let sumDeals = 0;
    let sumReferrals = 0;
    for (const entry of monthlyReferrals) {
      const [y, m] = entry.monthKey.split('-').map(Number);
      const bucketStart = startOfMonth(new Date(y, m - 1, 1));
      if (timeframeEnd && bucketStart > timeframeEnd) continue;
      if (timeframeStart && bucketStart < timeframeStart) continue;
      sumDeals += entry.totalReferrals === 0 ? 0 : (entry.closeRate / 100) * entry.totalReferrals;
      sumReferrals += entry.totalReferrals;
    }
    return sumReferrals === 0 ? 0 : (sumDeals / sumReferrals) * 100;
  })();

  const closedInTimeframe = (payment: AggregatedPayment) => {
    const closingDate = resolveClosingDate(payment);
    if (!closingDate) return false;
    if (timeframeStart && closingDate < timeframeStart) return false;
    if (timeframeEnd && closingDate > timeframeEnd) return false;
    return true;
  };

  const attachClosedDeals = paymentsWithMetric.filter((payment) => CLOSED_DEAL_STATUSES.has(payment.status));
  const attachClosedDealsInTimeframe = attachClosedDeals.filter((payment) => closedInTimeframe(payment));

  const afcRelevant = attachClosedDealsInTimeframe.filter(
    (payment) =>
      payment.referral?.org === 'AFC'
  );
  const afcDealsLost = afcRelevant.filter((payment) => !payment.usedAfc).length;
  const afcAttachRate = afcRelevant.length
    ? (afcRelevant.filter((payment) => Boolean(payment.usedAfc)).length / afcRelevant.length) * 100
    : 0;

  const ahaRelevant = attachClosedDealsInTimeframe.filter((payment) => {
    const designation = getAgentDesignation(payment);
    return designation === 'AHA';
  });
  const ahaAttached = ahaRelevant.filter((payment) => Boolean(payment.usedAssignedAgent));
  const ahaDealsLost = ahaRelevant.length - ahaAttached.length;
  const ahaAttachRate = ahaRelevant.length ? (ahaAttached.length / ahaRelevant.length) * 100 : 0;

  const ahaOosRelevant = attachClosedDealsInTimeframe.filter((payment) => {
    const designation = getAgentDesignation(payment);
    return designation === 'AHA_OOS';
  });
  const ahaOosAttached = ahaOosRelevant.filter((payment) => Boolean(payment.usedAssignedAgent));
  const ahaOosDealsLost = ahaOosRelevant.length - ahaOosAttached.length;
  const ahaOosAttachRate = ahaOosRelevant.length
    ? (ahaOosAttached.length / ahaOosRelevant.length) * 100
    : 0;

  // Build referral-to-borrower map for lost deal lists
  const referralBorrowerMap = new Map<string, string>();
  referrals.forEach((referral) => {
    referralBorrowerMap.set(referral._id.toString(), referral.borrower?.name ?? 'Unknown');
  });

  const serializeLostDeal = (payment: AggregatedPayment) => {
    const refId = payment.referral._id.toString();
    const agentId = (payment.agentId ?? payment.referral?.assignedAgent)?.toString() ?? null;
    const mcId = payment.referral?.lender?.toString() ?? null;
    return {
      id: payment._id.toString(),
      referralId: refId,
      borrowerName: referralBorrowerMap.get(refId) ?? 'Unknown',
      agentName: agentId ? (agentNameMap.get(agentId) ?? 'Unknown') : null,
      mcName: mcId ? (lenderNameMap.get(mcId) ?? 'Unknown') : null,
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
    };
  };

  const afcDealsLostList = afcRelevant
    .filter((payment) => !payment.usedAfc)
    .map(serializeLostDeal);

  const ahaOosDealsLostList = ahaOosRelevant
    .filter((payment) => !payment.usedAssignedAgent)
    .map(serializeLostDeal);

  const attachRateDebug = (() => {
    if (!attachDebugEnabled) return undefined;

    const designationCounts = attachClosedDealsInTimeframe.reduce(
      (acc, payment) => {
        const designation = getAgentDesignation(payment);
        if (designation === 'AHA') acc.aha += 1;
        else if (designation === 'AHA_OOS') acc.ahaOos += 1;
        else if (designation === 'AGIT') acc.agit += 1;
        else acc.unmapped += 1;
        return acc;
      },
      { aha: 0, ahaOos: 0, agit: 0, unmapped: 0 }
    );

    const inspectedDeal =
      attachDebugDealId != null
        ? paymentsWithMetric.find((payment) => payment._id.toString() === attachDebugDealId)
        : null;

    const inspectedDealDebug = inspectedDeal
      ? (() => {
          const designation = getAgentDesignation(inspectedDeal);
          const closingDate = resolveClosingDate(inspectedDeal);
          const inTimeframe = closedInTimeframe(inspectedDeal);
          const isClosedDealStatus = CLOSED_DEAL_STATUSES.has(inspectedDeal.status);
          const isAfcEligible =
            isClosedDealStatus &&
            inTimeframe &&
            inspectedDeal.referral?.org === 'AFC';
          const isAhaEligible =
            isClosedDealStatus &&
            inTimeframe &&
            designation === 'AHA';
          const isAhaOosEligible =
            isClosedDealStatus &&
            inTimeframe &&
            designation === 'AHA_OOS';
          return {
            id: inspectedDeal._id.toString(),
            status: inspectedDeal.status,
            referralOrg: inspectedDeal.referral?.org ?? null,
            usedAfc: Boolean(inspectedDeal.usedAfc),
            usedAssignedAgent: Boolean(inspectedDeal.usedAssignedAgent),
            agentAttribution: inspectedDeal.agentAttribution ?? null,
            designation,
            closingDate: closingDate?.toISOString() ?? null,
            metricDate: (inspectedDeal.metricDate ?? resolveMetricDate(inspectedDeal)).toISOString(),
            inTimeframe,
            isClosedDealStatus,
            isAfcEligible,
            isAhaEligible,
            isAhaOosEligible
          };
        })()
      : null;

    return {
      networkFilter: context.networkFilter,
      timeframe: {
        start: timeframeStart?.toISOString() ?? null,
        end: timeframeEnd?.toISOString() ?? null
      },
      sourceCounts: {
        paymentsWithMetric: paymentsWithMetric.length,
        closedDealStatuses: attachClosedDeals.length,
        closedDealStatusesInTimeframe: attachClosedDealsInTimeframe.length
      },
      designationCounts,
      afc: {
        eligible: afcRelevant.length,
        attached: afcRelevant.filter((payment) => Boolean(payment.usedAfc)).length,
        lost: afcDealsLost
      },
      aha: {
        eligible: ahaRelevant.length,
        attached: ahaAttached.length,
        lost: ahaDealsLost
      },
      ahaOos: {
        eligible: ahaOosRelevant.length,
        attached: ahaOosAttached.length,
        lost: ahaOosDealsLost
      },
      inspectedDeal: inspectedDealDebug
    };
  })();

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

  const referralsTrend = groupTrendByTimeframe(allReferralDates, timeframe);

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
    if (!isOutsideAgentDeal && CLOSED_DEAL_STATUSES.has(payment.status)) {
      current.closed += 1;
    }
    current.totalReferrals = referralByMcMap.get(key) ?? current.totalReferrals;
    mcRevenueMap.set(key, current);

    const closeStats = mcCloseRateMap.get(key) ?? { closed: 0, total: referralByMcMap.get(key) ?? 0 };
    if (!isOutsideAgentDeal && CLOSED_DEAL_STATUSES.has(payment.status)) {
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
  // Track lost referrals per agent (referrals with status 'Lost')
  const agentLostDealsMap = new Map<string, number>();
  filteredReferrals.forEach((referral) => {
    if (referral.status === 'Lost') {
      const key = referral.assignedAgent ? referral.assignedAgent.toString() : 'unassigned';
      agentLostDealsMap.set(key, (agentLostDealsMap.get(key) ?? 0) + 1);
    }
  });

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
    
    if (CLOSED_DEAL_STATUSES.has(payment.status)) {
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
        const flatFeeCents = payment.commissionFlatFeeCents ?? 0;
        const commissionPercent = commissionBasisPoints / 100;
        const commissionCents = flatFeeCents > 0
          ? flatFeeCents
          : (contractPriceCents * commissionBasisPoints) / 10000;

        if (commissionPercent > 0) {
          current.commissionPercentages.push(commissionPercent);
        }
        if (commissionCents > 0) {
          current.commissionCents.push(commissionCents);
        }
        if (referralFeePercent && referralFeePercent > 0) {
          current.referralFeePercentages.push(referralFeePercent);
        }

        // Net commission = commission earned - referral fee paid (only for paid deals)
        if (payment.status === 'paid' && commissionCents > 0) {
          const paidReferralFeeCents = payment.receivedAmountCents ?? referralFeeCents;
          current.netCommissionCents += commissionCents - paidReferralFeeCents;
        }
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

  // AHA / AHA OOS agent leaderboards — composite score (0–100) per agent
  type AhaRankedAgent = {
    id: string;
    name: string;
    score: number;
    rank: number;
    kpis: {
      label: string;
      key: string;
      rawValue: number;
      displayValue: string;
      normalizedScore: number;
      weight: 'high' | 'medium' | 'low';
    }[];
  };
  type AhaLeaderboardsResult = { rankedAgents: AhaRankedAgent[] };

  const AHA_KPI_WEIGHTS: Record<string, number> = {
    closeRate: 5,
    underContractRate: 3, afcAttachRate: 3, npsScore: 3, lostDeals: 3, avgDaysToContract: 3,
    revenuePaid: 2, avgTimeToFirstContact: 2,
    avgDealSize: 1, netCommission: 1, referralCount: 1,
  };
  const AHA_KPI_TIERS: Record<string, 'high' | 'medium' | 'low'> = {
    closeRate: 'high', underContractRate: 'high', afcAttachRate: 'high', npsScore: 'high',
    lostDeals: 'high', avgDaysToContract: 'high',
    revenuePaid: 'medium', avgTimeToFirstContact: 'medium',
    avgDealSize: 'low', netCommission: 'low', referralCount: 'low',
  };
  const AHA_KPI_LABELS: Record<string, string> = {
    closeRate: 'Close Rate', underContractRate: 'Under Contract Rate',
    afcAttachRate: 'AFC Attach Rate', npsScore: 'NPS Score',
    lostDeals: 'Lost Deals', avgDaysToContract: 'Avg. Days to Contract',
    revenuePaid: 'Revenue Paid', avgTimeToFirstContact: 'Avg. Time to First Contact',
    avgDealSize: 'Avg. Deal Size', netCommission: 'Net Commission',
    referralCount: 'Referral Count',
  };
  const AHA_KPI_ORDER = [
    'closeRate', 'underContractRate', 'afcAttachRate', 'lostDeals',
    'avgDaysToContract', 'npsScore', 'revenuePaid', 'avgTimeToFirstContact',
    'avgDealSize', 'netCommission', 'referralCount',
  ];

  const formatAhaKpiDisplay = (key: string, raw: number): string => {
    switch (key) {
      case 'closeRate':
      case 'afcAttachRate':
      case 'underContractRate':
        return `${raw.toFixed(1)}%`;
      case 'revenuePaid':
      case 'avgDealSize':
      case 'netCommission': {
        const dollars = raw / 100;
        if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
        if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
        return `$${Math.round(dollars)}`;
      }
      case 'avgDaysToContract':
        return `${Math.round(raw)} days`;
      case 'avgTimeToFirstContact':
        return `${raw.toFixed(1)} hrs`;
      default:
        return String(Math.round(raw));
    }
  };

  const buildAhaAgentLeaderboards = (
    bucketReferrals: DashboardReferral[],
    bucketPayments: AggregatedPayment[]
  ): AhaLeaderboardsResult => {
    const getName = (key: string) =>
      key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent';

    const referralCountMap = new Map<string, number>();
    const lostDealsMap = new Map<string, number>();
    const underContractCountMap = new Map<string, number>();
    const slaContractDaysMap = new Map<string, number[]>();
    const slaFirstContactMap = new Map<string, number[]>();

    bucketReferrals.forEach((r) => {
      const key = r.assignedAgent?.toString() ?? 'unassigned';
      referralCountMap.set(key, (referralCountMap.get(key) ?? 0) + 1);
      if (r.status === 'Lost') {
        lostDealsMap.set(key, (lostDealsMap.get(key) ?? 0) + 1);
      }
      if ((r.status ?? '').trim() === 'Under Contract') {
        underContractCountMap.set(key, (underContractCountMap.get(key) ?? 0) + 1);
      }
      if (r.sla) {
        const stored = r.sla.daysToContract;
        let daysToContract: number | null = null;
        if (stored != null && stored >= 0) {
          daysToContract = stored;
        } else {
          const referralDate = r.referralDate ? new Date(r.referralDate) : null;
          const lastUC = r.sla.lastUnderContractAt ? new Date(r.sla.lastUnderContractAt) : null;
          if (referralDate && lastUC && lastUC >= referralDate) {
            daysToContract = differenceInCalendarDays(lastUC, referralDate);
          }
        }
        if (daysToContract != null && daysToContract >= 0) {
          const arr = slaContractDaysMap.get(key) ?? [];
          arr.push(daysToContract);
          slaContractDaysMap.set(key, arr);
        }
        const firstContact = r.sla.timeToFirstAgentContactHours;
        if (firstContact != null) {
          const arr = slaFirstContactMap.get(key) ?? [];
          arr.push(firstContact);
          slaFirstContactMap.set(key, arr);
        }
      }
    });

    const agentPerfMap = new Map<
      string,
      {
        revenue: number;
        closed: number;
        afcAttachedDeals: number;
        afcEligibleDeals: number;
        closedVolumeCents: number;
        netCommissionCents: number;
      }
    >();

    bucketPayments.forEach((payment) => {
      if (payment.status === 'terminated') return;
      const key = payment.referral?.assignedAgent?.toString() ?? 'unassigned';
      const current = agentPerfMap.get(key) ?? {
        revenue: 0,
        closed: 0,
        afcAttachedDeals: 0,
        afcEligibleDeals: 0,
        closedVolumeCents: 0,
        netCommissionCents: 0
      };
      const isOutside = payment.agentAttribution === 'OUTSIDE_AGENT';
      if (!isOutside) {
        current.revenue += payment.receivedAmountCents ?? 0;
        if (CLOSED_DEAL_STATUSES.has(payment.status)) {
          current.closed += 1;
          const contractPriceCents =
            payment.contractPriceCents ?? payment.referral?.closedPriceCents ?? payment.referral?.estPurchasePriceCents ?? 0;
          if (contractPriceCents > 0) current.closedVolumeCents += contractPriceCents;
          current.afcEligibleDeals += 1;
          if (payment.usedAfc) current.afcAttachedDeals += 1;
          if (payment.status === 'paid') {
            const commissionBps = payment.referral?.commissionBasisPoints ?? 0;
            const flatFee = payment.commissionFlatFeeCents ?? 0;
            const commissionCents = flatFee > 0
              ? flatFee
              : contractPriceCents > 0 ? (contractPriceCents * commissionBps) / 10000 : 0;
            if (commissionCents > 0) {
              const referralFeePaid = payment.receivedAmountCents ?? payment.referral?.referralFeeDueCents ?? 0;
              current.netCommissionCents += commissionCents - referralFeePaid;
            }
          }
        }
      }
      agentPerfMap.set(key, current);
    });

    // Build per-KPI raw value maps (exclude 'unassigned')
    const kpiRaw: Record<string, Map<string, number>> = {
      referralCount: new Map(), closeRate: new Map(), underContractRate: new Map(),
      afcAttachRate: new Map(), revenuePaid: new Map(), avgDealSize: new Map(),
      netCommission: new Map(), lostDeals: new Map(), avgDaysToContract: new Map(),
      avgTimeToFirstContact: new Map(), npsScore: new Map(),
    };

    for (const [id, count] of referralCountMap) {
      if (id === 'unassigned') continue;
      const perf = agentPerfMap.get(id);
      kpiRaw.referralCount.set(id, count);
      kpiRaw.closeRate.set(id, count > 0 ? ((perf?.closed ?? 0) / count) * 100 : 0);
      kpiRaw.underContractRate.set(id, count > 0 ? ((underContractCountMap.get(id) ?? 0) / count) * 100 : 0);
      kpiRaw.revenuePaid.set(id, perf?.revenue ?? 0);
      kpiRaw.netCommission.set(id, perf?.netCommissionCents ?? 0);
      kpiRaw.lostDeals.set(id, lostDealsMap.get(id) ?? 0);
      if (perf && perf.afcEligibleDeals > 0) {
        kpiRaw.afcAttachRate.set(id, (perf.afcAttachedDeals / perf.afcEligibleDeals) * 100);
      }
      if (perf && perf.closed > 0) {
        kpiRaw.avgDealSize.set(id, perf.closedVolumeCents / perf.closed);
      }
      const contractDays = slaContractDaysMap.get(id);
      if (contractDays && contractDays.length > 0) {
        kpiRaw.avgDaysToContract.set(id, computeAverage(contractDays));
      }
      const firstContactHours = slaFirstContactMap.get(id);
      if (firstContactHours && firstContactHours.length > 0) {
        kpiRaw.avgTimeToFirstContact.set(id, computeAverage(firstContactHours));
      }
      const nps = agentNpsMap.get(id);
      if (nps != null) kpiRaw.npsScore.set(id, nps);
    }

    // Min-max normalize each KPI map
    const normalizeMap = (rawMap: Map<string, number>, lowerIsBetter: boolean): Map<string, number> => {
      if (rawMap.size === 0) return new Map();
      const vals = Array.from(rawMap.values());
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const result = new Map<string, number>();
      for (const [id, val] of rawMap) {
        if (max === min) {
          result.set(id, 100);
        } else if (lowerIsBetter) {
          result.set(id, ((max - val) / (max - min)) * 100);
        } else {
          result.set(id, ((val - min) / (max - min)) * 100);
        }
      }
      return result;
    };

    const kpiNorm: Record<string, Map<string, number>> = {
      referralCount:         normalizeMap(kpiRaw.referralCount, false),
      closeRate:             normalizeMap(kpiRaw.closeRate, false),
      underContractRate:     normalizeMap(kpiRaw.underContractRate, false),
      afcAttachRate:         normalizeMap(kpiRaw.afcAttachRate, false),
      revenuePaid:           normalizeMap(kpiRaw.revenuePaid, false),
      avgDealSize:           normalizeMap(kpiRaw.avgDealSize, false),
      netCommission:         normalizeMap(kpiRaw.netCommission, false),
      lostDeals:             normalizeMap(kpiRaw.lostDeals, true),
      avgDaysToContract:     normalizeMap(kpiRaw.avgDaysToContract, true),
      avgTimeToFirstContact: normalizeMap(kpiRaw.avgTimeToFirstContact, true),
      npsScore:              normalizeMap(kpiRaw.npsScore, false),
    };

    // Compute composite score per agent
    const rankedAgents: AhaRankedAgent[] = Array.from(kpiRaw.referralCount.keys()).map((id) => {
      let weightedSum = 0;
      let totalWeight = 0;
      const kpis: AhaRankedAgent['kpis'] = [];

      for (const key of AHA_KPI_ORDER) {
        const rawVal = kpiRaw[key].get(id);
        if (rawVal == null) continue;
        const normalizedScore = kpiNorm[key].get(id) ?? 0;
        const w = AHA_KPI_WEIGHTS[key];
        weightedSum += normalizedScore * w;
        totalWeight += w;
        kpis.push({
          label: AHA_KPI_LABELS[key],
          key,
          rawValue: rawVal,
          displayValue: formatAhaKpiDisplay(key, rawVal),
          normalizedScore: Math.round(normalizedScore * 10) / 10,
          weight: AHA_KPI_TIERS[key],
        });
      }

      const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;
      return { id, name: getName(id), score, rank: 0, kpis };
    });

    rankedAgents.sort((a, b) => b.score - a.score);
    rankedAgents.forEach((a, i) => { a.rank = i + 1; });

    return { rankedAgents };
  };

  const ahaFilteredReferrals = filteredReferrals.filter((r) => getReferralDesignation(r) === 'AHA');
  const ahaOosFilteredReferrals = filteredReferrals.filter((r) => getReferralDesignation(r) === 'AHA_OOS');
  const ahaFilteredPayments = filteredPaymentsByNetwork.filter((p) => getAgentDesignation(p) === 'AHA');
  const ahaOosFilteredPayments = filteredPaymentsByNetwork.filter((p) => getAgentDesignation(p) === 'AHA_OOS');

  const ahaLeaderboards = buildAhaAgentLeaderboards(ahaFilteredReferrals, ahaFilteredPayments);
  const ahaOosLeaderboards = buildAhaAgentLeaderboards(ahaOosFilteredReferrals, ahaOosFilteredPayments);

  // Admin metrics: referrals created within timeframe and network only.
  // "Unassigned" = still in "New Lead" (not paired). "Assigned" = moved to Paired or beyond.
  const adminEligibleReferrals = filteredReferrals;

  const unassignedReferrals = adminEligibleReferrals.filter(
    (referral) => (referral.status ?? '').trim() === 'New Lead'
  ).length;
  const assignedReferrals = adminEligibleReferrals.length - unassignedReferrals;
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

  // Admin task metrics: overdue, due today, completed today, 30-day trend
  const adminTasks = await AdminTask.find({}).lean<AdminTaskLean[]>();
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  function getTaskDueBucket(effectiveDue: Date | null, status: string): 'overdue' | 'today' | 'upcoming' | null {
    if (status !== 'open') return null;
    if (!effectiveDue) return 'upcoming';
    const dueDate = new Date(effectiveDue.getFullYear(), effectiveDue.getMonth(), effectiveDue.getDate());
    const diffMs = dueDate.getTime() - todayStart.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return 'overdue';
    if (diffDays === 0) return 'today';
    return 'upcoming';
  }

  let overdueTaskCount = 0;
  let dueTodayTaskCount = 0;
  const totalOpenTasks = adminTasks.filter((t) => t.status === 'open').length;
  adminTasks.forEach((task) => {
    const effectiveDue = getEffectiveDueDate(task);
    const bucket = getTaskDueBucket(effectiveDue, task.status);
    if (bucket === 'overdue') overdueTaskCount += 1;
    if (bucket === 'today') dueTodayTaskCount += 1;
  });

  const completedInTimeframeCount = adminTasks.filter((task) => {
    const at = task.completedAt ?? task.dismissedAt;
    if (!at) return false;
    const d = new Date(at);
    if (timeframeStart && d < timeframeStart) return false;
    if (timeframeEnd && d > timeframeEnd) return false;
    return true;
  }).length;

  // 30-day task activity trend: one point per day
  const taskTrendDays = 30;
  const trendStart = startOfDay(addDays(now, -taskTrendDays + 1));
  const dayBuckets: { key: string; label: string; date: Date }[] = [];
  for (let i = 0; i < taskTrendDays; i++) {
    const d = addDays(trendStart, i);
    dayBuckets.push({
      key: format(d, 'yyyy-MM-dd'),
      label: format(d, 'MMM d'),
      date: d
    });
  }

  const createdByDay = new Map<string, number>();
  const completedByDay = new Map<string, number>();
  dayBuckets.forEach((b) => {
    createdByDay.set(b.key, 0);
    completedByDay.set(b.key, 0);
  });
  adminTasks.forEach((task) => {
    if (task.createdAt) {
      const key = format(startOfDay(new Date(task.createdAt)), 'yyyy-MM-dd');
      if (createdByDay.has(key)) createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
    }
    if (task.completedAt) {
      const key = format(startOfDay(new Date(task.completedAt)), 'yyyy-MM-dd');
      if (completedByDay.has(key)) completedByDay.set(key, (completedByDay.get(key) ?? 0) + 1);
    }
    if (task.dismissedAt) {
      const key = format(startOfDay(new Date(task.dismissedAt)), 'yyyy-MM-dd');
      if (completedByDay.has(key)) completedByDay.set(key, (completedByDay.get(key) ?? 0) + 1);
    }
  });

  // Outstanding at end of each day: tasks created on or before that day and not completed/dismissed on or before that day
  const outstandingByDay = new Map<string, number>();
  for (const b of dayBuckets) {
    const endOfBucket = endOfDay(b.date);
    const count = adminTasks.filter((task) => {
      const created = task.createdAt ? new Date(task.createdAt) : null;
      if (!created || created > endOfBucket) return false;
      const completed = task.completedAt ? new Date(task.completedAt) : null;
      if (completed && completed <= endOfBucket) return false;
      const dismissed = task.dismissedAt ? new Date(task.dismissedAt) : null;
      if (dismissed && dismissed <= endOfBucket) return false;
      return true;
    }).length;
    outstandingByDay.set(b.key, count);
  }

  const taskActivityTrend = {
    outstanding: dayBuckets.map((b) => ({
      key: b.key,
      label: b.label,
      value: outstandingByDay.get(b.key) ?? 0
    })),
    completed: dayBuckets.map((b) => ({
      key: b.key,
      label: b.label,
      value: completedByDay.get(b.key) ?? 0
    })),
    created: dayBuckets.map((b) => ({
      key: b.key,
      label: b.label,
      value: createdByDay.get(b.key) ?? 0
    }))
  };

  // Stale active pipeline: AHA_OOS referrals not in terminal status with no activity in 14 days
  const STALE_EXCLUDED_STATUSES = new Set<string>(['Lost', 'Closed', 'Terminated', 'Under Contract']);
  const staleCutoff = addDays(now, -14);
  const activeReferrals = referralsByNetwork.filter(
    (r) =>
      !STALE_EXCLUDED_STATUSES.has((r.status as string) ?? '') &&
      getReferralDesignation(r) === 'AHA_OOS'
  );
  const activeReferralIds = activeReferrals.map((r) => r._id);
  const lastActivities =
    activeReferralIds.length > 0
      ? await Activity.aggregate<{ _id: Types.ObjectId; lastActivityAt: Date }>([
          { $match: { referralId: { $in: activeReferralIds } } },
          { $group: { _id: '$referralId', lastActivityAt: { $max: '$createdAt' } } }
        ])
      : [];
  const lastActivityMap = new Map(
    lastActivities.map((a) => [a._id.toString(), a.lastActivityAt])
  );
  const staleReferrals = activeReferrals.filter((r) => {
    const lastActivity = lastActivityMap.get(r._id.toString());
    const effectiveDate = lastActivity ?? r.updatedAt ?? r.createdAt;
    return new Date(effectiveDate) < staleCutoff;
  });
  const stalePipelineList = staleReferrals
    .map((r) => {
      const lastActivity = lastActivityMap.get(r._id.toString());
      const effectiveDate = lastActivity ?? r.updatedAt ?? r.createdAt;
      const effectiveDateObj = effectiveDate ? new Date(effectiveDate) : null;
      const daysSinceActivity = effectiveDateObj
        ? differenceInCalendarDays(now, effectiveDateObj)
        : 0;
      const agentId = r.assignedAgent?.toString() ?? null;
      const mcId = r.lender?.toString() ?? null;
      return {
        id: r._id.toString(),
        borrowerName: r.borrower?.name ?? 'Unknown',
        status: (r.status as string) ?? 'New Lead',
        agentName: agentId ? (agentNameMap.get(agentId) ?? null) : null,
        mcName: mcId ? (lenderNameMap.get(mcId) ?? null) : null,
        lastActivityAt: effectiveDateObj ? effectiveDateObj.toISOString() : null,
        daysSinceActivity
      };
    })
    .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);

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
    deals: terminatedDeals.sort((a, b) => b.lostReferralFeeCents - a.lostReferralFeeCents)
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

  // AGIT Dashboard Metrics: Filter referrals by agent designation === 'AGIT'
  const agitReferrals = filteredReferrals.filter(
    (referral) => getReferralDesignation(referral) === 'AGIT'
  );
  const agitReferralIds = new Set(agitReferrals.map((r) => r._id.toString()));
  const agitPercentage =
    filteredReferrals.length === 0
      ? 0
      : (agitReferrals.length / filteredReferrals.length) * 100;

  const agitFilteredPayments = filteredPaymentsByNetwork.filter((payment) =>
    agitReferralIds.has(payment.referral._id.toString())
  );

  // Lost referrals (status === 'Lost')
  const agitLostReferrals = agitReferrals.filter(
    (referral) => referral.status === 'Lost'
  ).length;

  // Closed/paid deals
  const agitDealsClosed = agitFilteredPayments.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      CLOSED_DEAL_STATUSES.has(payment.status)
  ).length;

  // Close rate
  const agitCloseRate =
    agitReferrals.length === 0 ? 0 : (agitDealsClosed / agitReferrals.length) * 100;

  // Used AFC / AFC Attach Rate
  const agitClosedOrPaidPayments = agitFilteredPayments.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      CLOSED_DEAL_STATUSES.has(payment.status)
  );

  const agitUsedAfcCount = agitClosedOrPaidPayments.filter((payment) => payment.usedAfc).length;
  const agitUsedAfcRate =
    agitClosedOrPaidPayments.length === 0
      ? 0
      : (agitUsedAfcCount / agitClosedOrPaidPayments.length) * 100;

  // Build AGIT referral rows for table display
  const agitReferralRows = agitReferrals.map((referral) => {
    const agentId = referral.assignedAgent?.toString() ?? null;
    const mcId = referral.lender?.toString() ?? null;
    return {
      id: referral._id.toString(),
      borrowerName: referral.borrower?.name ?? 'Unknown',
      loanFileNumber: referral.loanFileNumber ?? null,
      status: referral.status ?? 'New Lead',
      agentId,
      agentName: agentId ? agentNameMap.get(agentId) ?? null : null,
      agentEmail: agentId ? agentEmailMap.get(agentId) ?? null : null,
      agentPhone: agentId ? agentPhoneMap.get(agentId) ?? null : null,
      mcId,
      mcName: mcId ? lenderNameMap.get(mcId) ?? null : null,
      mcEmail: mcId ? lenderEmailMap.get(mcId) ?? null : null,
      mcPhone: mcId ? lenderPhoneMap.get(mcId) ?? null : null,
      createdAt: referral.createdAt.toISOString(),
      updatedAt: referral.updatedAt?.toISOString() ?? referral.createdAt.toISOString()
    };
  });

  // Create a map of referral IDs to borrower names for deal rows
  const agitReferralBorrowerMap = new Map<string, string>();
  agitReferrals.forEach((referral) => {
    agitReferralBorrowerMap.set(referral._id.toString(), referral.borrower?.name ?? 'Unknown');
  });

  // Build AGIT deal rows for table display
  const agitDealRows = agitFilteredPayments.map((payment) => {
    const agentId = payment.agentId?.toString() ?? payment.referral?.assignedAgent?.toString() ?? null;
    const mcId = payment.referral?.lender?.toString() ?? null;
    return {
      id: payment._id.toString(),
      referralId: payment.referral._id.toString(),
      borrowerName: agitReferralBorrowerMap.get(payment.referral._id.toString()) ?? 'Unknown',
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      agentId,
      agentName: agentId ? agentNameMap.get(agentId) ?? null : null,
      mcId,
      mcName: mcId ? lenderNameMap.get(mcId) ?? null : null,
      mcEmail: mcId ? lenderEmailMap.get(mcId) ?? null : null,
      mcPhone: mcId ? lenderPhoneMap.get(mcId) ?? null : null,
      closingDate: payment.closingDate?.toISOString() ?? null,
      usedAfc: payment.usedAfc ?? null
    };
  });

  // Period-over-period: compare against prior matching period per timeframe.
  let periodOverPeriod: {
    previous: { totalReferrals: number; dealsClosed: number; realizedRevenueCents: number; closeRate: number };
    current: { totalReferrals: number; dealsClosed: number; realizedRevenueCents: number; closeRate: number };
  } | null = null;
  const previousPeriodRange = getPreviousPeriodRange(timeframe);
  if (previousPeriodRange) {
    const { start: previousStart, end: previousEnd } = previousPeriodRange;
    const prevReferrals = referralsByNetwork.filter((r) => {
      const created = r.createdAt ? new Date(r.createdAt) : null;
      if (!created) return false;
      return created >= previousStart && created <= previousEnd;
    });
    const prevDealsClosed = paymentsByNetwork.filter((payment) => {
      const metricDate = payment.metricDate ?? resolveMetricDate(payment);
      if (metricDate < previousStart || metricDate > previousEnd) return false;
      if (payment.agentAttribution === 'OUTSIDE_AGENT') return false;
      if (payment.usedAssignedAgent !== true) return false;
      if (!CLOSED_DEAL_STATUSES.has(payment.status)) return false;
      return true;
    });
    const prevRealized = paymentsByNetwork.reduce((sum, payment) => {
      const metricDate = payment.metricDate ?? resolveMetricDate(payment);
      if (metricDate < previousStart || metricDate > previousEnd) return sum;
      if (!isRevenueEligiblePayment(payment)) return sum;
      return sum + (payment.receivedAmountCents ?? 0);
    }, 0);
    periodOverPeriod = {
      previous: {
        totalReferrals: prevReferrals.length,
        dealsClosed: prevDealsClosed.length,
        realizedRevenueCents: prevRealized,
        closeRate: prevReferrals.length === 0 ? 0 : (prevDealsClosed.length / prevReferrals.length) * 100
      },
      current: {
        totalReferrals,
        dealsClosed: dealsClosedForSummary,
        realizedRevenueCents,
        closeRate: closeRateForSummary
      }
    };
  }

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
      funnel: { stages: funnelStages },
      periodOverPeriod,
      ...(attachRateDebug ? { attachRateDebug } : {}),
      summary: {
        totalReferrals,
        dealsClosed: dealsClosedForSummary,
        dealsClosedInTimeframe: dealsClosedInTimeframe.length,
        dealsUnderContract: dealsUnderContract.length,
        pendingClosings: pendingClosings.length,
        pendingClosingsThisMonth: pendingClosingsThisMonth.length,
        pendingClosingsNextMonth: pendingClosingsNextMonth.length,
        closeRate: closeRateForSummary,
        afcDealsLost,
        afcDealsLostList,
        afcAttachRate,
        ahaDealsLost,
        ahaAttachRate,
        ahaOosDealsLost,
        ahaOosDealsLostList,
        ahaOosAttachRate,
    activePipeline,
    expectedRevenueCents,
    realizedRevenueCents,
    generatedRevenueCents: generatedRevenueCentsForSummary,
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
        revenue: mainTrends.map((entry) => ({ key: entry.key, label: entry.label, value: entry.revenueReceivedCents })),
        revenueGenerated: mainTrends.map((entry) => ({ key: entry.key, label: entry.label, value: entry.revenueGeneratedCents })),
        deals: mainTrends.map((entry) => ({ key: entry.key, label: entry.label, value: entry.dealsClosed })),
        closeRate: mainTrends.map((entry) => ({ key: entry.key, label: entry.label, value: entry.closeRate })),
        referrals: referralsTrend
      },
      revenueBySource,
      revenueByEndorser,
      revenueByState,
      referralRequestsBySource,
      referralRequestsByEndorser,
      referralRequestsByState,
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
      agentCreatedMcAssignments: agentCreatedMcLeaderboard,
      ahaLeaderboards,
      ahaOosLeaderboards
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
      firstContactSampleSize: firstContactRecords.length,
      overdueTaskCount,
      dueTodayTaskCount,
      completedInTimeframeCount,
      totalOpenTasks,
      taskActivityTrend,
      stalePipelineCount: staleReferrals.length,
      stalePipelineList
    },
    agit: {
      agitReferrals: agitReferrals.length,
      agitPercentage,
      usedAfcCount: agitUsedAfcCount,
      usedAfcRate: agitUsedAfcRate,
      lostReferrals: agitLostReferrals,
      closeRate: agitCloseRate,
      dealsClosed: agitDealsClosed,
      referralRows: agitReferralRows,
      dealRows: agitDealRows
    }
  };

  return NextResponse.json(responsePayload);
}
