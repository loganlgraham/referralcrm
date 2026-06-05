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
  subYears
} from 'date-fns';
import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { zipToState, inferStateFromLocationText } from '@/utils/location';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { PreApprovalMetric } from '@/models/pre-approval-metric';
import {
  AdminTask,
  getEffectiveDueDate,
  getTaskResolvedAt,
  wasTaskResolvedOnOrBeforeDueDate,
  type AdminTaskLean
} from '@/models/admin-task';
import { Activity } from '@/models/activity';
import {
  isAfcEligibleDeal,
  resolveDealSideForMetrics,
} from '@/lib/server/referral-sides';
import {
  AHA_NEUTRAL_SCORE,
  compareAhaRankedAgents,
  computeAhaReliabilityFactor,
  computeCappedActivityUsageScore,
  normalizeAhaKpiMap
} from '@/lib/server/aha-leaderboard-scoring';
import { resolvePushbackMetricsInTimeframe } from '@/lib/server/pushback-metrics';
import { buildConversionFunnel, type FunnelReferralInput } from '@/lib/server/conversion-funnel';
import {
  computeCohortCloseRate,
  isClosingInNonTerminatedMonth,
  isTotalFutureClosingStatus,
  safePercent
} from '@/lib/server/dashboard-math';
import { SLA_THRESHOLDS } from '@/utils/sla-insights';
import {
  getPaymentAgentDesignation as sharedGetPaymentAgentDesignation,
  getReferralDesignation as sharedGetReferralDesignation,
  type NetworkDesignation
} from '@/lib/server/referral-designation';
import {
  buildTimeframeBuckets,
  getPreviousPeriodRange,
  getReferralTimeframeAnchor,
  getTimeframeBucketKey,
  groupTrendByTimeframe,
  isWithinTimeframe as isDateWithinDashboardTimeframe,
  parseTimeframe,
  type TimeframeInfo,
  type TrendPoint
} from '@/lib/server/dashboard/timeframe';

type NetworkFilter = 'ALL' | 'AHA' | 'AHA_OOS';

interface DashboardRequestContext {
  referralMatch: Record<string, unknown>;
  paymentMatch: Record<string, unknown>;
  timeframe: TimeframeInfo;
  networkFilter: NetworkFilter;
}

interface AggregatedPayment {
  _id: Types.ObjectId;
  agentId?: Types.ObjectId | null;
  side?: 'buy' | 'sell' | null;
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
  commissionBasisPoints?: number | null;
  closingDate?: Date | null;
  closingDatePushbackCount?: number | null;
  closingDatePushbacks?: Array<{
    previousClosingDate?: Date | null;
    nextClosingDate?: Date | null;
    pushedBackDays?: number | null;
    actorRole?: string | null;
    actorId?: Types.ObjectId | null;
    timestamp?: Date | null;
  }> | null;
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
    clientType?: 'Seller' | 'Buyer' | 'Both' | null;
    dealSide?: 'buy' | 'sell' | null;
    buyStatus?: string | null;
    sellStatus?: string | null;
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
  dealSide?: 'buy' | 'sell' | null;
  clientType?: 'Seller' | 'Buyer' | 'Both' | null;
  buyStatus?: string | null;
  sellStatus?: string | null;
  lender?: Types.ObjectId | null;
  status?: string;
  preApprovalAmountCents?: number;
  stageOnTransfer?: string | null;
  initialNotes?: string;
  notes?: {
    content?: string;
    createdAt?: Date;
  }[];
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
  audit?: Array<{
    field?: string;
    previousValue?: unknown;
    newValue?: unknown;
    timestamp?: Date | string | null;
  }> | null;
}

const ACTIVE_PIPELINE_STATUSES = new Set<string>([
  'Paired',
  'In Communication',
  'Active Lead',
  'Showing Homes',
  'Under Contract',
]);
const ACTIVE_PIPELINE_STATUS_KEYS = new Set(
  Array.from(ACTIVE_PIPELINE_STATUSES, (status) => normalizeStatusKey(status))
);
// C-14: Referral-model terminals only. Payment-style values (payment_sent,
// payment_received, paid) belong to TERMINAL_PAYMENT_STATUS_KEYS below and
// never match against `referral.status` because `normalizeReferralStatus`
// rejects them.
const TERMINAL_REFERRAL_STATUS_KEYS = new Set<string>([
  'closed',
  'lost',
  'terminated'
]);
const TERMINAL_PAYMENT_STATUS_KEYS = new Set<string>(['closed', 'payment_sent', 'payment_received', 'paid']);
const AFC_RISK_AT_RISK_SCORE_THRESHOLD = 40;
const AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD = 0.3;
const AFC_RISK_MC_LOSS_REASON_PREFIX = 'MC historical outside-lender loss';
const AFC_RISK_OUTSIDE_NOTE_REASON_PREFIX = 'Notes mention outside/local lender intent';
// M-16: soft-match phrasing for lender-shopping hints; treated as a weaker
// outside-lender note signal so the `hasOutsideLenderNoteSignal` check still
// trips when only soft matches are present.
const AFC_RISK_OUTSIDE_NOTE_SOFT_REASON_PREFIX = 'Notes suggest lender-shopping';
const AFC_RISK_COUNTER_SIGNAL_REASON_PREFIX = 'Counter-signal in notes';
const NOTE_SIGNAL_STRONG_PHRASES = [
  'outside lender',
  'other lender',
  'another lender',
  'local lender',
  'credit union',
  'using own lender',
  'already with',
  'moving to',
  'switched lender',
  'switching lender'
];
const NOTE_SIGNAL_SOFT_PHRASES = [
  'shopping rates',
  'rate quote elsewhere',
  'asked about another lender',
  'considering another lender',
  'mentioned local lender',
  'comparing lenders'
];
const NOTE_SIGNAL_SUPPRESSOR_PHRASES = [
  'staying with afc',
  'confirmed afc',
  'kept afc',
  'using afc',
  'sticking with afc'
];

const TERMINATED_REASON_LABELS: Record<string, string> = {
  inspection: 'Inspection',
  appraisal: 'Appraisal',
  financing: 'Financing',
  changed_mind: 'Changed Mind',
  unknown: 'Unknown'
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

const NON_TERMINATED_DEAL_STATUSES = new Set<AggregatedPayment['status']>([
  ...UNDER_CONTRACT_STATUSES,
  ...CLOSED_DEAL_STATUSES
]);

type StageOnTransferCategory = 'Pre-approved' | 'Pre-approval TBD';
const STAGE_ON_TRANSFER_CATEGORIES: readonly StageOnTransferCategory[] = ['Pre-approved', 'Pre-approval TBD'];
interface StageOnTransferDrilldownEntry {
  referralId: string;
  borrowerName: string;
  referralStatus: string;
  mcName: string;
  agentName: string;
  stageOnTransfer: StageOnTransferCategory;
  hasClosedDeal: boolean;
}

const isClosedDealEligible = (payment: AggregatedPayment): boolean =>
  CLOSED_DEAL_STATUSES.has(payment.status) &&
  payment.agentAttribution !== 'OUTSIDE_AGENT' &&
  payment.usedAssignedAgent !== false;

function normalizeStatusKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function isTerminalReferralStatus(status: unknown): boolean {
  return TERMINAL_REFERRAL_STATUS_KEYS.has(normalizeStatusKey(status));
}

function isTerminalPaymentStatus(status: unknown): boolean {
  return TERMINAL_PAYMENT_STATUS_KEYS.has(normalizeStatusKey(status));
}

function normalizeStageOnTransfer(value: unknown): StageOnTransferCategory {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');

  if (normalized === 'preapproved' || normalized === 'pncpreapproved') {
    return 'Pre-approved';
  }

  if (normalized === 'preapprovaltbd') {
    return 'Pre-approval TBD';
  }

  return 'Pre-approval TBD';
}

function getOutcomeTuningMultiplier(
  sampleSize: number,
  fullConfidenceAt: number,
  minMultiplier: number,
  maxMultiplier: number
): number {
  const normalized = Math.min(1, Math.max(0, sampleSize) / Math.max(fullConfidenceAt, 1));
  return minMultiplier + (maxMultiplier - minMultiplier) * normalized;
}

function computeHistoricalRiskBoost(outsideLossRate: number, sampleSize: number): number {
  const baseBoost = Math.min(15, outsideLossRate * 100 * 0.15);
  const tuningMultiplier = getOutcomeTuningMultiplier(sampleSize, 10, 0.7, 1.1);
  const tunedBoost = Math.min(15, baseBoost * tuningMultiplier);
  return Math.round(tunedBoost * 10) / 10;
}

function computeSourceFragilityBoost(sourceCloseRate: number, sampleSize: number): number {
  const baseBoost = Math.min(10, ((100 - sourceCloseRate) / 100) * 10);
  const tuningMultiplier = getOutcomeTuningMultiplier(sampleSize, 15, 0.75, 1.1);
  const tunedBoost = Math.min(10, baseBoost * tuningMultiplier);
  return Math.round(tunedBoost * 10) / 10;
}

function prioritizeAfcRiskReasons(
  reasons: { label: string; score: number }[],
  outsideLossRate: number
): string[] {
  const isHighOutsideLoss = outsideLossRate >= AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD;
  return reasons
    .filter((reason) => !reason.label.startsWith(AFC_RISK_COUNTER_SIGNAL_REASON_PREFIX))
    .sort((a, b) => {
      const aPriority =
        (isHighOutsideLoss && a.label.startsWith(AFC_RISK_MC_LOSS_REASON_PREFIX) ? 2 : 0) +
        (a.label.startsWith(AFC_RISK_OUTSIDE_NOTE_REASON_PREFIX) ? 1 : 0);
      const bPriority =
        (isHighOutsideLoss && b.label.startsWith(AFC_RISK_MC_LOSS_REASON_PREFIX) ? 2 : 0) +
        (b.label.startsWith(AFC_RISK_OUTSIDE_NOTE_REASON_PREFIX) ? 1 : 0);
      if (bPriority !== aPriority) return bPriority - aPriority;
      return b.score - a.score;
    })
    .slice(0, 2)
    .map((reason) => reason.label);
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

function resolvePaymentReceivedDate(payment: AggregatedPayment): Date | null {
  if (payment.status !== 'paid') {
    return null;
  }

  if (payment.paidDate) {
    return payment.paidDate;
  }

  return payment.updatedAt ?? null;
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

function computeAverage(values: number[]): number {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function computeMedian(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function scoreOutsideLenderNoteSignals(
  textEntries: string[]
): { score: number; reasons: { label: string; score: number }[]; confidence: 'high' | 'medium' | 'low' | null } {
  if (!textEntries.length) {
    return { score: 0, reasons: [], confidence: null };
  }
  const normalizedText = textEntries
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedText) {
    return { score: 0, reasons: [], confidence: null };
  }

  const strongMatches = NOTE_SIGNAL_STRONG_PHRASES.filter((phrase) => normalizedText.includes(phrase));
  const softMatches = NOTE_SIGNAL_SOFT_PHRASES.filter((phrase) => normalizedText.includes(phrase));
  const suppressorMatches = NOTE_SIGNAL_SUPPRESSOR_PHRASES.filter((phrase) => normalizedText.includes(phrase));

  let score = 0;
  const reasons: { label: string; score: number }[] = [];
  let confidence: 'high' | 'medium' | 'low' | null = null;

  if (strongMatches.length > 0) {
    const strongScore = Math.min(35, 25 + (strongMatches.length - 1) * 5);
    score += strongScore;
    reasons.push({ label: `${AFC_RISK_OUTSIDE_NOTE_REASON_PREFIX} (${strongMatches[0]})`, score: strongScore });
    confidence = 'high';
  } else if (softMatches.length > 0) {
    const softScore = Math.min(18, 10 + (softMatches.length - 1) * 4);
    score += softScore;
    reasons.push({ label: `${AFC_RISK_OUTSIDE_NOTE_SOFT_REASON_PREFIX} (${softMatches[0]})`, score: softScore });
    confidence = 'medium';
  }

  if (suppressorMatches.length > 0) {
    const reduction = Math.min(20, 12 + (suppressorMatches.length - 1) * 4);
    score = Math.max(0, score - reduction);
    reasons.push({ label: `Counter-signal in notes (${suppressorMatches[0]})`, score: -reduction });
    if (score === 0) {
      confidence = 'low';
    }
  }

  return { score: Math.round(score * 10) / 10, reasons, confidence };
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
  // Response-time instrumentation: log total wall-clock time for GET /api/dashboard
  // so we can catch regressions without a heavy APM integration.
  const requestStartedAt = Date.now();
  await connectMongo();
  const session = await getCurrentSession();

  // Allow CRON_SECRET bearer to call this endpoint as an admin (used by scheduled report jobs).
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCronAdmin = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!session && !isCronAdmin) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const attachDebugEnabled =
    request.nextUrl.searchParams.get('attachDebug') === '1' && session?.user?.role === 'admin';
  const attachDebugDealId = request.nextUrl.searchParams.get('attachDealId')?.trim() || null;

  const context = createDashboardContext(request);
  const { referralMatch, timeframe } = context;

  const role = session?.user?.role ?? (isCronAdmin ? 'admin' : null);
  const userId = session?.user?.id;

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
    const missingProfileDurationMs = Date.now() - requestStartedAt;
    const missingProfileResponse = NextResponse.json({
      timeframe,
      permissions: {
        canViewGlobal: role === 'admin',
        role: role ?? null
      },
      main: {
        funnel: { stages: [], terminal: { lostTotal: 0, terminatedTotal: 0 } },
        periodOverPeriod: null,
        summary: {
          totalReferrals: 0,
          dealsClosed: 0,
          dealsClosedInTimeframe: 0,
          dealsUnderContract: 0,
          pendingClosings: 0,
          pendingClosingsThisMonth: 0,
          pendingClosingsNextMonth: 0,
          pendingClosingsList: [],
          pendingClosingsThisMonthList: [],
          pendingClosingsNextMonthList: [],
          expectedRevenueFromPendingClosingsCents: 0,
          generatedRevenueList: [],
          closedNotPaidList: [],
          dealsClosedList: [],
          averageDaysClosedToPaidList: [],
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
          revenueRealizationRatePercent: null,
          closedNotPaidPercentOfExpected: null,
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
        outsideLenderLossLeaderboard: [],
        requestLeaderboard: { all: [], aha: [], ahaOos: [] },
        kpiLeaderboard: { rankedMcs: [] },
        afcRiskCallList: [],
        stageOnTransferSummary: STAGE_ON_TRANSFER_CATEGORIES.map((category) => ({
          category,
          totalReferrals: 0,
          closedReferrals: 0,
          closeRate: 0
        })),
        stageOnTransferDrilldown: STAGE_ON_TRANSFER_CATEGORIES.map((category) => ({
          category,
          rows: []
        })),
        pushbackSummary: {
          distinctDealsPushedBack: 0,
          totalPushbackEvents: 0,
          averageDaysPushedBackPerEvent: 0,
          pushbackRatePercent: 0,
          byMc: []
        }
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
        onTimeTaskCompletionCount: 0,
        onTimeTaskCompletionSampleSize: 0,
        totalOpenTasks: 0,
        taskActivityTrend: {
          outstanding: [],
          completed: [],
          created: []
        },
        stalePipelineCount: 0,
        stalePipelineList: [],
        noOpenTaskReferrals: []
      },
      agit: {
        agitReferrals: 0,
        agitPercentage: 0,
        usedAfcCount: 0,
        usedAfcRate: 0,
        lostReferrals: 0,
        closeRate: 0,
        dealsClosed: 0,
        referralRows: [],
        dealRows: []
      }
    });
    missingProfileResponse.headers.set('server-timing', `dashboard;dur=${missingProfileDurationMs}`);
    return missingProfileResponse;
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
      'createdAt updatedAt referralDate status statusLastUpdated referralFeeDueCents referralFeeBasisPoints commissionBasisPoints estPurchasePriceCents preApprovalAmountCents stageOnTransfer initialNotes notes.content notes.createdAt assignedAgent buySideAgent sellSideAgent lender org ahaBucket propertyAddress propertyCity propertyState propertyPostalCode borrowerCurrentAddress closedPriceCents source endorser origin dealSide clientType sla lookingInZip lookingInZips loanFileNumber borrower.name audit.field audit.previousValue audit.newValue audit.timestamp'
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
        side: 1,
        status: 1,
        expectedAmountCents: 1,
        receivedAmountCents: 1,
        contractPriceCents: 1,
        commissionFlatFeeCents: 1,
        commissionBasisPoints: 1,
        closingDate: 1,
        closingDatePushbackCount: 1,
        closingDatePushbacks: 1,
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
          clientType: '$referral.clientType',
          dealSide: '$referral.dealSide',
          buyStatus: '$referral.buyStatus',
          sellStatus: '$referral.sellStatus',
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
      ? LenderMC.find({ _id: { $in: Array.from(lenderIds, (id) => new Types.ObjectId(id)) } }).select('name email phone npsScore includeInMetrics')
      : Promise.resolve([]),
    agentIds.size
      ? Agent.find({ _id: { $in: Array.from(agentIds, (id) => new Types.ObjectId(id)) } }).select('name email phone ahaDesignation npsScore userId includeInMetrics')
      : Promise.resolve([])
  ]);

  // People explicitly excluded from dashboard leaderboards (still counted in
  // aggregate totals/funnel/revenue). Drives per-person leaderboard filtering only.
  const excludedMcIds = new Set<string>();
  lenders.forEach((lender) => {
    if ((lender as { includeInMetrics?: boolean }).includeInMetrics === false) {
      excludedMcIds.add(lender._id.toString());
    }
  });
  const excludedAgentIds = new Set<string>();
  agents.forEach((agent) => {
    if ((agent as { includeInMetrics?: boolean }).includeInMetrics === false) {
      excludedAgentIds.add(agent._id.toString());
    }
  });
  const isMcIncludedInLeaderboards = (id: string) => !excludedMcIds.has(id);
  const isAgentIncludedInLeaderboards = (id: string) => !excludedAgentIds.has(id);

  const lenderNameMap = new Map<string, string>();
  const lenderEmailMap = new Map<string, string | null>();
  const lenderPhoneMap = new Map<string, string | null>();
  const lenderNpsMap = new Map<string, number | null>();
  lenders.forEach((lender) => {
    const id = lender._id.toString();
    lenderNameMap.set(id, lender.name || 'Unnamed MC');
    lenderEmailMap.set(id, lender.email ?? null);
    lenderPhoneMap.set(id, lender.phone ?? null);
    lenderNpsMap.set(id, (lender as { npsScore?: number | null }).npsScore ?? null);
  });

  const agentNameMap = new Map<string, string>();
  const agentEmailMap = new Map<string, string | null>();
  const agentPhoneMap = new Map<string, string | null>();
  const agentUserIdToAgentIdMap = new Map<string, string>();
  agents.forEach((agent) => {
    const id = agent._id.toString();
    agentNameMap.set(id, agent.name || 'Unnamed Agent');
    agentEmailMap.set(id, agent.email ?? null);
    agentPhoneMap.set(id, agent.phone ?? null);
    const userId = (agent as { userId?: Types.ObjectId | null }).userId;
    if (userId) {
      agentUserIdToAgentIdMap.set(userId.toString(), id);
    }
  });

  const agentDesignationMap = new Map<string, 'AHA' | 'AHA_OOS' | 'AGIT' | null>();
  const agentNpsMap = new Map<string, number | null>();
  agents.forEach((agent) => {
    const id = agent._id.toString();
    agentDesignationMap.set(id, agent.ahaDesignation ?? null);
    agentNpsMap.set(id, (agent as { npsScore?: number | null }).npsScore ?? null);
  });

  const getAgentDesignation = (payment: AggregatedPayment): NetworkDesignation | null =>
    sharedGetPaymentAgentDesignation(payment, agentDesignationMap);

  const getReferralDesignation = (referral: DashboardReferral): NetworkDesignation | null =>
    sharedGetReferralDesignation(referral, agentDesignationMap);

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

  // M-37: delegate to the module-level helper; the local name is preserved.
  const moduleIsWithinTimeframe = isDateWithinDashboardTimeframe;
  const isWithinTimeframe = (date: Date | string | null | undefined) =>
    moduleIsWithinTimeframe(date instanceof Date ? date : date ? new Date(date) : null, timeframe);
  const isPaymentReceivedInTimeframe = (payment: AggregatedPayment): boolean =>
    isWithinTimeframe(resolvePaymentReceivedDate(payment));

  const referralsByNetwork =
    context.networkFilter === 'ALL'
      ? referrals
      : referrals.filter((referral) => matchesNetwork(getReferralDesignation(referral)));

  // M-1: anchor the referral-in-timeframe check on min(referralDate, createdAt)
  // so a back-dated referralDate counts in the correct period per AGENTS.md.
  const filteredReferrals = referralsByNetwork.filter((referral) => {
    const anchor = getReferralTimeframeAnchor(referral);
    return anchor ? isWithinTimeframe(anchor) : false;
  });

  const terminatedWithinNetwork =
    context.networkFilter === 'ALL'
      ? terminatedWithinTimeframe
      : terminatedWithinTimeframe.filter((payment) => matchesNetwork(getAgentDesignation(payment)));

  const totalReferrals = filteredReferrals.length;
  const referralRequestsBySourceMap = new Map<string, number>();
  const referralRequestsByEndorserMap = new Map<string, number>();
  const referralRequestsByStateMap = new Map<string, number>();
  // C-16: precompute state once per referral id and reuse across both the
  // referral-requests pass and the revenue-by-state pass below.
  const referralStateCache = new Map<string, string>();
  const resolveReferralState = async (referral: ReferralForState | undefined | null): Promise<string> => {
    if (!referral) return 'Unknown';
    const cacheKey = (referral as { _id?: { toString(): string } })._id?.toString();
    if (cacheKey && referralStateCache.has(cacheKey)) {
      return referralStateCache.get(cacheKey) as string;
    }
    const state = await extractStateAsync(referral);
    if (cacheKey) referralStateCache.set(cacheKey, state);
    return state;
  };
  for (const referral of filteredReferrals) {
    const source = String(referral.source ?? 'Unknown');
    referralRequestsBySourceMap.set(source, (referralRequestsBySourceMap.get(source) ?? 0) + 1);
    const endorser = referral.endorser?.trim() || 'Unattributed';
    referralRequestsByEndorserMap.set(endorser, (referralRequestsByEndorserMap.get(endorser) ?? 0) + 1);
    const state = await resolveReferralState(referral as ReferralForState);
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
      isClosedDealEligible(payment) &&
      filteredReferralIds.has(payment.referral._id.toString())
  );

  // Deals closed in timeframe: matches "Deals closed" graph logic (closed | payment_sent | paid)
  // Use paymentsByNetwork (same as graph) and filter by metricDate being within timeframe
  const dealsClosedInTimeframe = paymentsByNetwork.filter((payment) => {
    const metricDate = payment.metricDate ?? resolveMetricDate(payment);
    if (!metricDate) return false;
    if (timeframeStart && metricDate < timeframeStart) return false;
    if (timeframeEnd && metricDate > timeframeEnd) return false;
    if (!isClosedDealEligible(payment)) return false;
    return true;
  });
  const allClosedDealsInNetwork = paymentsByNetwork.filter((payment) => CLOSED_DEAL_STATUSES.has(payment.status));
  const allClosedDealsInTimeframe = allClosedDealsInNetwork.filter((payment) => {
    const metricDate = payment.metricDate ?? resolveMetricDate(payment);
    if (!metricDate) return false;
    if (timeframeStart && metricDate < timeframeStart) return false;
    if (timeframeEnd && metricDate > timeframeEnd) return false;
    return true;
  });
  const allClosedDealsInPushbackWindow = allClosedDealsInNetwork.filter((payment) => {
    // Pushback metrics should react to recent activity, not only close/invoice/paid dates.
    return isWithinTimeframe(payment.updatedAt);
  });
  // Pushback metrics must count any non-terminated deal whose closing date was moved,
  // not just already-closed deals. Include events where the pushback timestamp falls in
  // the timeframe even if the payment itself hasn't been updated since.
  const pushbackEventInTimeframe = (payment: AggregatedPayment): boolean => {
    if (!Array.isArray(payment.closingDatePushbacks)) return false;
    return payment.closingDatePushbacks.some((entry) =>
      entry?.timestamp ? isWithinTimeframe(entry.timestamp) : false
    );
  };
  const allDealsInPushbackWindow = paymentsByNetwork.filter((payment) => {
    if (!NON_TERMINATED_DEAL_STATUSES.has(payment.status)) return false;
    return isWithinTimeframe(payment.updatedAt) || pushbackEventInTimeframe(payment);
  });

  const closedDealReferralIds = new Set(
    dealsClosedForCloseRate.map((payment) => payment.referral._id.toString())
  );

  const stageOnTransferSummaryMap = new Map<
    StageOnTransferCategory,
    { category: StageOnTransferCategory; totalReferrals: number; closedReferrals: number }
  >();
  const stageOnTransferDrilldownMap = new Map<
    StageOnTransferCategory,
    StageOnTransferDrilldownEntry[]
  >();
  STAGE_ON_TRANSFER_CATEGORIES.forEach((category) => {
    stageOnTransferSummaryMap.set(category, { category, totalReferrals: 0, closedReferrals: 0 });
    stageOnTransferDrilldownMap.set(category, []);
  });
  filteredReferrals.forEach((referral) => {
    const category = normalizeStageOnTransfer(referral.stageOnTransfer);
    const categorySummary = stageOnTransferSummaryMap.get(category);
    const categoryDrilldown = stageOnTransferDrilldownMap.get(category);
    if (!categorySummary) {
      return;
    }
    if (!categoryDrilldown) {
      return;
    }
    const referralId = referral._id.toString();
    const hasClosedDeal = closedDealReferralIds.has(referralId);
    categorySummary.totalReferrals += 1;
    if (hasClosedDeal) {
      categorySummary.closedReferrals += 1;
    }
    const lenderId = referral.lender?.toString() ?? null;
    const agentId = referral.assignedAgent?.toString() ?? null;
    categoryDrilldown.push({
      referralId,
      borrowerName: referral.borrower?.name?.trim() || 'Unknown',
      referralStatus: referral.status ?? 'Unknown',
      mcName: lenderId ? (lenderNameMap.get(lenderId) ?? 'Unassigned MC') : 'Unassigned MC',
      agentName: agentId ? (agentNameMap.get(agentId) ?? 'Unassigned Agent') : 'Unassigned Agent',
      stageOnTransfer: category,
      hasClosedDeal
    });
  });
  const stageOnTransferSummary = STAGE_ON_TRANSFER_CATEGORIES.map((category) => {
    const categorySummary = stageOnTransferSummaryMap.get(category);
    if (!categorySummary) {
      return { category, totalReferrals: 0, closedReferrals: 0, closeRate: 0 };
    }
    return {
      category,
      totalReferrals: categorySummary.totalReferrals,
      closedReferrals: categorySummary.closedReferrals,
      closeRate: safePercent(categorySummary.closedReferrals, categorySummary.totalReferrals)
    };
  });
  const stageOnTransferDrilldown = STAGE_ON_TRANSFER_CATEGORIES.map((category) => {
    const rows = stageOnTransferDrilldownMap.get(category) ?? [];
    return {
      category,
      rows: rows.sort(
        (a, b) =>
          Number(b.hasClosedDeal) - Number(a.hasClosedDeal) ||
          a.borrowerName.localeCompare(b.borrowerName) ||
          a.referralId.localeCompare(b.referralId)
      )
    };
  });
  
  const lostReferrals = referralsByNetwork.filter((referral) => {
    if (referral.status !== 'Lost') {
      return false;
    }
    return isWithinTimeframe(referral.statusLastUpdated ?? referral.updatedAt ?? referral.createdAt);
  });
  const now = new Date();
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
  // Main "Total Future Closings" count: open pipeline (not closed / payment_sent / paid
  // / terminated), used assigned agent only; not scoped to dashboard timeframe.
  const pendingClosings = paymentsByNetwork.filter((payment) => {
    if (payment.usedAssignedAgent !== true) return false;
    return isTotalFutureClosingStatus(payment.status);
  });
  // This/next month: same month/status rules, used assigned agent only (include closed /
  // payment_sent / paid when their closing falls in the month).
  const pendingClosingsThisMonth = paymentsByNetwork.filter((payment) => {
    if (payment.usedAssignedAgent !== true) return false;
    return isClosingInNonTerminatedMonth(
      payment.status,
      payment.closingDate,
      startOfCurrentMonth,
      endOfCurrentMonth
    );
  });
  const pendingClosingsNextMonth = paymentsByNetwork.filter((payment) => {
    if (payment.usedAssignedAgent !== true) return false;
    return isClosingInNonTerminatedMonth(
      payment.status,
      payment.closingDate,
      startOfNextMonth,
      endOfNextMonth
    );
  });
  const cohortCloseRateSummary = computeCohortCloseRate(
    dealsClosedForCloseRate.length,
    totalReferrals
  );

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
  const paidRevenueEligiblePaymentsInTimeframe = paymentsByNetwork.filter((payment) => {
    if (!isRevenueEligiblePayment(payment)) {
      return false;
    }
    if (payment.status !== 'paid') {
      return false;
    }
    return isPaymentReceivedInTimeframe(payment);
  });

  const expectedRevenueCents = revenueEligiblePayments.reduce(
    (sum, payment) => sum + calculateOutstandingExpected(payment),
    0
  );
  const realizedRevenueCents = paidRevenueEligiblePaymentsInTimeframe.reduce(
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

  const computeDaysClosedToPaid = (payment: AggregatedPayment): number | null => {
    const end = payment.paidDate ? new Date(payment.paidDate) : null;
    if (!end) {
      return null;
    }

    const closingDate = payment.closingDate
      ? new Date(payment.closingDate)
      : payment.referral?.sla?.lastClosedAt
      ? new Date(payment.referral.sla.lastClosedAt)
      : null;

    if (end && closingDate) {
      const days = differenceInCalendarDays(end, closingDate);
      return days >= 0 ? days : null;
    }

    const storedMinutes =
      payment.referral?.sla?.closedToPaidMinutes ?? payment.referral?.sla?.previousClosedToPaidMinutes ?? null;
    if (storedMinutes != null && storedMinutes >= 0) {
      return storedMinutes / (60 * 24);
    }

    if (end) {
      const fallbackStart = closingDate ?? (payment.invoiceDate ? new Date(payment.invoiceDate) : new Date(payment.updatedAt));
      const days = differenceInCalendarDays(end, fallbackStart);
      return days >= 0 ? days : null;
    }

    return null;
  };

  const paidPaymentsWithDays = paidPayments.flatMap((payment) => {
    const days = computeDaysClosedToPaid(payment);
    if (days == null || Number.isNaN(days)) return [];
    return [{ payment, days }];
  });

  const averageDaysClosedToPaid = computeAverage(paidPaymentsWithDays.map((entry) => entry.days));

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

        // M-26: anchor on the earliest of referralDate / createdAt so a
        // referralDate backfilled later than createdAt doesn't shrink the
        // days-to-contract window.
        const referralDateValue = payment.referral?.referralDate
          ? new Date(payment.referral.referralDate)
          : null;
        const createdAtValue = payment.referral?.createdAt
          ? new Date(payment.referral.createdAt)
          : null;
        const leadStart = referralDateValue && createdAtValue
          ? (referralDateValue.getTime() < createdAtValue.getTime() ? referralDateValue : createdAtValue)
          : (referralDateValue ?? createdAtValue);
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
    (payment) => isClosedDealEligible(payment)
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

    const state = await resolveReferralState(payment.referral as ReferralForState);
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

  // Cohort conversion funnel: stage N's count = referrals whose max stage ever reached >= N.
  // Derived from referral.audit status-transition entries, with SLA timestamps and the
  // closed-deal override as fallbacks. "Showing Homes" normalizes to "Active Lead".
  // Lost / Terminated are reported as branch totals, not funnel rows.
  const funnelInputs: FunnelReferralInput[] = filteredReferrals.map((referral) => ({
    _id: referral._id,
    status: referral.status as string | undefined,
    statusLastUpdated: referral.statusLastUpdated ?? null,
    createdAt: referral.createdAt ?? null,
    referralDate: referral.referralDate ?? null,
    audit: referral.audit ?? null,
    sla: referral.sla ?? null
  }));
  const conversionFunnel = buildConversionFunnel(funnelInputs, {
    closedDealReferralIds
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
  // Received revenue: bucket by payment-received date (paidDate, fallback updatedAt).
  const revenueReceivedByMonth = new Map<string, number>();
  paymentsByNetwork.forEach((payment) => {
    const closingDate = resolveClosingDate(payment);
    if (!isClosedDealEligible(payment)) return;

    const expectedCents = Math.max(payment.expectedAmountCents ?? 0, 0);
    const receivedCents = payment.receivedAmountCents ?? 0;

    if (closingDate) {
      const closeKey = `${closingDate.getFullYear()}-${String(closingDate.getMonth() + 1).padStart(2, '0')}`;
      const current = dealsByClosingDate.get(closeKey) ?? { dealsClosed: 0, revenueGeneratedCents: 0 };
      current.dealsClosed += 1;
      current.revenueGeneratedCents += expectedCents;
      dealsByClosingDate.set(closeKey, current);
    }
  });
  paymentsByNetwork.forEach((payment) => {
    if (!isRevenueEligiblePayment(payment) || payment.status !== 'paid') return;
    const receivedDate = resolvePaymentReceivedDate(payment);
    if (!receivedDate) return;
    const receivedCents = payment.receivedAmountCents ?? 0;
    const receivedKey = `${receivedDate.getFullYear()}-${String(receivedDate.getMonth() + 1).padStart(2, '0')}`;
    revenueReceivedByMonth.set(receivedKey, (revenueReceivedByMonth.get(receivedKey) ?? 0) + receivedCents);
  });

  // Close Rate: cohort-based (deals from referrals created in month X / referrals in month X)
  // Count closed, payment sent, and paid deals for a consistent closed-deal definition.
  const dealsFromCohort = new Map<string, number>();
  paymentsByNetwork.forEach((payment) => {
    if (!isClosedDealEligible(payment)) return;

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
    if (!isClosedDealEligible(payment)) return;

    const expectedCents = Math.max(payment.expectedAmountCents ?? 0, 0);

    if (metricDate) {
      const key = getTimeframeBucketKey(new Date(metricDate), context.timeframe);
      const current = dealTimeframeMap.get(key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
      current.dealsClosed += 1;
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
  paidRevenueEligiblePaymentsInTimeframe.forEach((payment) => {
    const receivedDate = resolvePaymentReceivedDate(payment);
    if (!receivedDate) return;
    const receivedCents = payment.receivedAmountCents ?? 0;
    const key = getTimeframeBucketKey(new Date(receivedDate), context.timeframe);
    const current = dealTimeframeMap.get(key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
    current.revenueReceivedCents += receivedCents;
    dealTimeframeMap.set(key, current);
  });

  // Close rate per bucket: deals whose referral was created in that bucket.
  // Use paymentsByNetwork (all payments) to count deals from referrals created in each bucket,
  // regardless of when the deal closed (cohort-based calculation)
  const dealsClosedByReferralBucket = new Map<string, number>();
  paymentsByNetwork.forEach((payment) => {
    if (!isClosedDealEligible(payment)) return;
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
    const closeRate = computeCohortCloseRate(dealsClosedForCloseRate, referralStats.total);
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
    const monthlyCloseRate = computeCohortCloseRate(cohortDeals, referralStats.total);
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
    (payment) => {
      const dealSide = resolveDealSideForMetrics(
        payment.side,
        payment.referral?.dealSide,
        payment.referral?.clientType ?? null
      );
      return isAfcEligibleDeal(payment.referral?.org ?? null, dealSide);
    }
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

  const serializePendingClosing = (payment: AggregatedPayment) => {
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
      closingDate: payment.closingDate ? new Date(payment.closingDate).toISOString() : null,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
    };
  };

  const sortByClosingDateAsc = <T extends { closingDate: string | null }>(list: T[]): T[] =>
    [...list].sort((a, b) => {
      if (!a.closingDate && !b.closingDate) return 0;
      if (!a.closingDate) return 1;
      if (!b.closingDate) return -1;
      return a.closingDate.localeCompare(b.closingDate);
    });

  const pendingClosingsList = sortByClosingDateAsc(
    pendingClosings.map(serializePendingClosing)
  );
  const pendingClosingsThisMonthList = sortByClosingDateAsc(
    pendingClosingsThisMonth.map(serializePendingClosing)
  );
  const pendingClosingsNextMonthList = sortByClosingDateAsc(
    pendingClosingsNextMonth.map(serializePendingClosing)
  );

  const expectedRevenueFromPendingClosingsCents = pendingClosings.reduce(
    (sum, payment) => sum + (payment.expectedAmountCents ?? 0),
    0
  );

  const serializeClosedDeal = (
    payment: AggregatedPayment,
    extras?: { daysClosedToPaid?: number | null }
  ) => {
    const refId = payment.referral._id.toString();
    const agentId = (payment.agentId ?? payment.referral?.assignedAgent)?.toString() ?? null;
    const mcId = payment.referral?.lender?.toString() ?? null;
    const expectedAmountCents = payment.expectedAmountCents ?? 0;
    const receivedAmountCents = payment.receivedAmountCents ?? 0;
    return {
      id: payment._id.toString(),
      referralId: refId,
      borrowerName: referralBorrowerMap.get(refId) ?? 'Unknown',
      agentName: agentId ? (agentNameMap.get(agentId) ?? 'Unknown') : null,
      mcName: mcId ? (lenderNameMap.get(mcId) ?? 'Unknown') : null,
      status: payment.status,
      closingDate: payment.closingDate ? new Date(payment.closingDate).toISOString() : null,
      paidDate: payment.paidDate ? new Date(payment.paidDate).toISOString() : null,
      expectedAmountCents,
      receivedAmountCents,
      outstandingAmountCents: Math.max(expectedAmountCents - receivedAmountCents, 0),
      daysClosedToPaid: extras?.daysClosedToPaid ?? null,
    };
  };

  const sortByClosingDateDesc = <T extends { closingDate: string | null }>(list: T[]): T[] =>
    [...list].sort((a, b) => {
      if (!a.closingDate && !b.closingDate) return 0;
      if (!a.closingDate) return 1;
      if (!b.closingDate) return -1;
      return b.closingDate.localeCompare(a.closingDate);
    });

  const sortByPaidDateDesc = <T extends { paidDate: string | null }>(list: T[]): T[] =>
    [...list].sort((a, b) => {
      if (!a.paidDate && !b.paidDate) return 0;
      if (!a.paidDate) return 1;
      if (!b.paidDate) return -1;
      return b.paidDate.localeCompare(a.paidDate);
    });

  // C-5: generatedRevenueList must mirror the KPI (payments bucketed by
  // resolveClosingDate), not the dealsClosedInTimeframe (metricDate) list.
  const dealsGeneratedInTimeframe = paymentsByNetwork.filter((payment) => {
    if (!isClosedDealEligible(payment)) return false;
    const closingDate = resolveClosingDate(payment);
    if (!closingDate) return false;
    if (timeframeStart && closingDate < timeframeStart) return false;
    if (timeframeEnd && closingDate > timeframeEnd) return false;
    return true;
  });
  const generatedRevenueList = sortByClosingDateDesc(
    dealsGeneratedInTimeframe.map((payment) => serializeClosedDeal(payment))
  );

  const dealsClosedList = sortByClosingDateDesc(
    dealsClosedInTimeframe.map((payment) => serializeClosedDeal(payment))
  );

  const closedNotPaidPayments = revenueEligiblePayments.filter((payment) => {
    if (payment.status === 'closed') {
      const outstanding = (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0);
      return outstanding > 0;
    }
    if (
      payment.status === 'paid' &&
      (payment.receivedAmountCents ?? 0) < (payment.expectedAmountCents ?? 0)
    ) {
      return true;
    }
    return false;
  });
  const closedNotPaidList = sortByClosingDateDesc(
    closedNotPaidPayments.map((payment) => serializeClosedDeal(payment))
  );

  const averageDaysClosedToPaidList = sortByPaidDateDesc(
    paidPaymentsWithDays.map((entry) =>
      serializeClosedDeal(entry.payment, { daysClosedToPaid: entry.days })
    )
  );

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
            isAfcEligibleDeal(
              inspectedDeal.referral?.org ?? null,
              resolveDealSideForMetrics(
                inspectedDeal.side,
                inspectedDeal.referral?.dealSide,
                inspectedDeal.referral?.clientType ?? null
              )
            );
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
      .filter((entry) => isMcIncludedInLeaderboards(entry.id))
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, 10);

  // MC Revenue tracking
  // Revenue map tracks: realized revenue, expected revenue, closed deals, and total referrals per MC
  const mcRevenueMap = new Map<string, { revenue: number; expected: number; closed: number; totalReferrals: number }>();

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
  // Excludes deals attributed to outside agents from revenue calculations.
  // Close-rate leaderboards are computed below from cohort-matched deals.
  filteredPaymentsByNetwork.forEach((payment) => {
    const key = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    const current = mcRevenueMap.get(key) ?? { revenue: 0, expected: 0, closed: 0, totalReferrals: referralByMcMap.get(key) ?? 0 };
    // C-9/C-20: MC revenue must use the same eligibility filter as Main
    // (excludes outside-agent attributions AND Glenn Beck referrals).
    const revenueEligible = isRevenueEligiblePayment(payment);
    if (revenueEligible) {
      current.revenue += payment.receivedAmountCents ?? 0;
      current.expected += calculateOutstandingExpected(payment);
    }
    if (revenueEligible && CLOSED_DEAL_STATUSES.has(payment.status)) {
      current.closed += 1;
    }
    current.totalReferrals = referralByMcMap.get(key) ?? current.totalReferrals;
    mcRevenueMap.set(key, current);
  });

  // Close-rate leaderboards must use the same cohort semantics as Main close rate:
  // referrals created in timeframe (denominator) and those same referrals that reached closed-like statuses (numerator).
  const cohortClosedByMcMap = new Map<string, number>();
  const cohortClosedByAgentMap = new Map<string, number>();
  // M-17: cohort-aligned revenue per MC — revenue from payments whose referral
  // was created in the current timeframe, so revenuePerReferral's numerator
  // and denominator share the same cohort.
  const cohortRevenueByMcMap = new Map<string, number>();
  dealsClosedForCloseRate.forEach((payment) => {
    const mcKey = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    cohortClosedByMcMap.set(mcKey, (cohortClosedByMcMap.get(mcKey) ?? 0) + 1);

    const agentKey = payment.referral?.assignedAgent ? payment.referral.assignedAgent.toString() : 'unassigned';
    cohortClosedByAgentMap.set(agentKey, (cohortClosedByAgentMap.get(agentKey) ?? 0) + 1);

    if (isRevenueEligiblePayment(payment)) {
      const revenue = payment.receivedAmountCents ?? 0;
      if (revenue > 0) {
        cohortRevenueByMcMap.set(mcKey, (cohortRevenueByMcMap.get(mcKey) ?? 0) + revenue);
      }
    }
  });

  const mcTotalClosedDealsMap = new Map<string, number>();
  const mcAssignedAgentClosesMap = new Map<string, number>();
  const mcOutsideLenderLossMap = new Map<string, number>();
  const mcNoAfcClosesMap = new Map<string, number>();
  const mcNoAssignedAgentClosesMap = new Map<string, number>();
  // C-10: MC close-rate leaderboards must use `isClosedDealEligible` so that
  // outside-agent / usedAssignedAgent=false payments don't inflate denominators.
  const eligibleClosedDealsInTimeframe = allClosedDealsInTimeframe.filter((payment) =>
    isClosedDealEligible(payment)
  );
  eligibleClosedDealsInTimeframe.forEach((payment) => {
    const mcKey = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    mcTotalClosedDealsMap.set(mcKey, (mcTotalClosedDealsMap.get(mcKey) ?? 0) + 1);
    if (payment.usedAfc !== true) {
      mcNoAfcClosesMap.set(mcKey, (mcNoAfcClosesMap.get(mcKey) ?? 0) + 1);
    }
    if (payment.usedAssignedAgent !== true) {
      mcNoAssignedAgentClosesMap.set(mcKey, (mcNoAssignedAgentClosesMap.get(mcKey) ?? 0) + 1);
    }
    if (payment.usedAssignedAgent === true) {
      mcAssignedAgentClosesMap.set(mcKey, (mcAssignedAgentClosesMap.get(mcKey) ?? 0) + 1);
    }
    if (payment.usedAssignedAgent === true && payment.usedAfc === false) {
      mcOutsideLenderLossMap.set(mcKey, (mcOutsideLenderLossMap.get(mcKey) ?? 0) + 1);
    }
  });
  const allClosedDealsForAfcRisk = paymentsByNetwork.filter((payment) =>
    CLOSED_DEAL_STATUSES.has(payment.status)
  );
  const mcTotalClosedDealsForAfcRiskMap = new Map<string, number>();
  const mcOutsideLenderLossForAfcRiskMap = new Map<string, number>();
  allClosedDealsForAfcRisk.forEach((payment) => {
    const mcKey = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    mcTotalClosedDealsForAfcRiskMap.set(mcKey, (mcTotalClosedDealsForAfcRiskMap.get(mcKey) ?? 0) + 1);
    if (payment.usedAssignedAgent === true && payment.usedAfc === false) {
      mcOutsideLenderLossForAfcRiskMap.set(mcKey, (mcOutsideLenderLossForAfcRiskMap.get(mcKey) ?? 0) + 1);
    }
  });

  // Per-MC AHA / AHA OOS attach rate: mirrors the top-level attach logic but
  // grouped by the referral's lender (MC). Of closed-in-timeframe deals on
  // AHA / AHA_OOS designated agents, the share that used the assigned agent.
  const mcAhaAttachMap = new Map<string, { relevant: number; attached: number }>();
  const mcAhaOosAttachMap = new Map<string, { relevant: number; attached: number }>();
  attachClosedDealsInTimeframe.forEach((payment) => {
    const mcKey = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    const designation = getAgentDesignation(payment);
    if (designation === 'AHA') {
      const current = mcAhaAttachMap.get(mcKey) ?? { relevant: 0, attached: 0 };
      current.relevant += 1;
      if (payment.usedAssignedAgent === true) {
        current.attached += 1;
      }
      mcAhaAttachMap.set(mcKey, current);
    } else if (designation === 'AHA_OOS') {
      const current = mcAhaOosAttachMap.get(mcKey) ?? { relevant: 0, attached: 0 };
      current.relevant += 1;
      if (payment.usedAssignedAgent === true) {
        current.attached += 1;
      }
      mcAhaOosAttachMap.set(mcKey, current);
    }
  });

  const mcRevenueLeaderboard = Array.from(mcRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
      revenueCents: value.revenue,
      expectedRevenueCents: value.expected
    }))
    .filter((entry) => isMcIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const mcLeaderboardKeys = new Set<string>([...referralByMcMap.keys(), ...mcTotalClosedDealsMap.keys()]);
  const mcCloseRateLeaderboard = Array.from(mcLeaderboardKeys)
    .map((key) => {
      const totalReferrals = referralByMcMap.get(key) ?? 0;
      const dealsClosed = cohortClosedByMcMap.get(key) ?? 0;
      const totalClosedDeals = mcTotalClosedDealsMap.get(key) ?? 0;
      const assignedAgentCloses = mcAssignedAgentClosesMap.get(key) ?? 0;
      const outsideLenderLossCount = mcOutsideLenderLossMap.get(key) ?? 0;
      const assignedAgentCloseRate = safePercent(assignedAgentCloses, totalClosedDeals);
      const outsideLenderLossRate = safePercent(outsideLenderLossCount, totalClosedDeals);
      return {
        id: key,
        name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
        closeRate: computeCohortCloseRate(dealsClosed, totalReferrals),
        dealsClosed,
        totalReferrals,
        assignedAgentCloses,
        totalClosedDeals,
        assignedAgentCloseRate,
        outsideLenderLossCount,
        outsideLenderLossRate
      };
    })
    .filter((entry) => isMcIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.closeRate - a.closeRate || b.totalReferrals - a.totalReferrals)
    .slice(0, 10);

  const mcOutsideLenderLossLeaderboard = Array.from(mcLeaderboardKeys)
    .map((key) => {
      const totalClosedDeals = mcTotalClosedDealsMap.get(key) ?? 0;
      const outsideLenderLossCount = mcOutsideLenderLossMap.get(key) ?? 0;
      return {
        id: key,
        name: key === 'unassigned' ? 'Unassigned MC' : lenderNameMap.get(key) ?? 'Unknown MC',
        outsideLenderLossCount,
        totalClosedDeals,
        outsideLenderLossRate: safePercent(outsideLenderLossCount, totalClosedDeals)
      };
    })
    .filter((entry) => isMcIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.outsideLenderLossRate - a.outsideLenderLossRate || b.outsideLenderLossCount - a.outsideLenderLossCount)
    .slice(0, 10);

  const mcRequestLeaderboard = {
    all: buildMcRequestLeaderboard(referralByMcMap),
    aha: buildMcRequestLeaderboard(referralByMcAhaMap),
    ahaOos: buildMcRequestLeaderboard(referralByMcAhaOosMap)
  };

  type McKpiKey =
    | 'closedDealsWithAfc'
    | 'closedDealsWithoutAfc'
    | 'totalRevenueGenerated'
    | 'revenuePerReferral'
    | 'pipelineCashConversion'
    | 'closeVelocityMedianDays'
    | 'referralCount'
    | 'dealPushbackRate'
    | 'noAfcCloseRate'
    | 'noAssignedAgentCloseRate'
    | 'financingTerminationRate'
    | 'agingPipelineRisk'
    | 'sourceQualityIndex'
    | 'afcCaptureRate'
    | 'ahaAttachRate'
    | 'ahaOosAttachRate'
    | 'forecastAccuracy'
    | 'npsScore';

  type McRankedEntry = {
    id: string;
    name: string;
    score: number;
    baseScore: number;
    reliabilityFactor: number;
    rank: number;
    qualified: boolean;
    referralCount: number;
    revenueCents: number;
    kpis: {
      label: string;
      key: McKpiKey;
      rawValue: number;
      displayValue: string;
      normalizedScore: number;
      weight: 'critical' | 'high' | 'medium' | 'low';
      neutralFilled: boolean;
    }[];
  };
  type McAfcRiskCallListEntry = {
    rowId: string;
    referralId: string;
    borrowerName: string;
    mcId: string | null;
    mcName: string | null;
    agentId: string | null;
    agentName: string | null;
    status: string;
    source: string;
    closingDate: string | null;
    daysToClose: number | null;
    daysSinceActivity: number;
    usedAfc: boolean | null;
    riskScore: number;
    riskTier: 'high' | 'medium' | 'low';
    reasons: string[];
  };

  type TerminatedReasonKey = NonNullable<AggregatedPayment['terminatedReason']> | 'unknown';

  const MC_MIN_REFERRALS_FOR_RANK = 3;
  const MC_KPI_WEIGHTS: Record<McKpiKey, number> = {
    closedDealsWithAfc: 8,
    closedDealsWithoutAfc: 7,
    totalRevenueGenerated: 6,
    referralCount: 5,
    revenuePerReferral: 2,
    pipelineCashConversion: 2,
    closeVelocityMedianDays: 2,
    dealPushbackRate: 2,
    noAfcCloseRate: 2,
    noAssignedAgentCloseRate: 2,
    financingTerminationRate: 2,
    afcCaptureRate: 2,
    ahaAttachRate: 2,
    ahaOosAttachRate: 2,
    npsScore: 2,
    agingPipelineRisk: 1,
    sourceQualityIndex: 1,
    forecastAccuracy: 1
  };
  const MC_KPI_TIERS: Record<McKpiKey, 'critical' | 'high' | 'medium' | 'low'> = {
    closedDealsWithAfc: 'critical',
    closedDealsWithoutAfc: 'critical',
    totalRevenueGenerated: 'critical',
    referralCount: 'critical',
    revenuePerReferral: 'medium',
    pipelineCashConversion: 'medium',
    closeVelocityMedianDays: 'medium',
    dealPushbackRate: 'medium',
    noAfcCloseRate: 'medium',
    noAssignedAgentCloseRate: 'medium',
    financingTerminationRate: 'medium',
    afcCaptureRate: 'medium',
    ahaAttachRate: 'medium',
    ahaOosAttachRate: 'medium',
    npsScore: 'medium',
    agingPipelineRisk: 'low',
    sourceQualityIndex: 'low',
    forecastAccuracy: 'low'
  };
  const MC_KPI_LABELS: Record<McKpiKey, string> = {
    closedDealsWithAfc: 'Closed Deals (AFC)',
    closedDealsWithoutAfc: 'Closed Deals (No AFC)',
    totalRevenueGenerated: 'Total Revenue Generated',
    referralCount: 'Referral Count',
    revenuePerReferral: 'Revenue per Referral',
    pipelineCashConversion: 'Pipeline to Cash',
    closeVelocityMedianDays: 'Median Days Pair -> Close',
    dealPushbackRate: 'Deals Pushed Back Rate',
    noAfcCloseRate: 'Closes Without AFC',
    noAssignedAgentCloseRate: 'Closes Without Assigned Agent',
    financingTerminationRate: 'Financing Terminations',
    afcCaptureRate: 'AFC Capture Rate',
    ahaAttachRate: 'AHA Attach Rate',
    ahaOosAttachRate: 'AHA OOS Attach Rate',
    agingPipelineRisk: 'Aging Pipeline Risk',
    sourceQualityIndex: 'Source Quality Index',
    forecastAccuracy: 'Forecast Accuracy',
    npsScore: 'NPS Score'
  };
  const MC_KPI_ORDER: McKpiKey[] = [
    'closedDealsWithAfc',
    'closedDealsWithoutAfc',
    'totalRevenueGenerated',
    'referralCount',
    'revenuePerReferral',
    'pipelineCashConversion',
    'closeVelocityMedianDays',
    'dealPushbackRate',
    'noAfcCloseRate',
    'noAssignedAgentCloseRate',
    'financingTerminationRate',
    'afcCaptureRate',
    'ahaAttachRate',
    'ahaOosAttachRate',
    'npsScore',
    'agingPipelineRisk',
    'sourceQualityIndex',
    'forecastAccuracy',
  ];

  const mcVelocityDaysMap = new Map<string, number[]>();
  const mcAfcCaptureMap = new Map<string, { eligible: number; captured: number }>();
  const mcForecastMap = new Map<string, { expected: number; realized: number }>();
  const mcPushbackStatsMap = new Map<
    string,
    { dealsWithPushback: number; totalPushbackEvents: number; totalPushedBackDays: number }
  >();
  const mcEligibleDealsForPushbackRateMap = new Map<string, number>();
  let mcDistinctDealsPushedBack = 0;
  let mcTotalPushbackEvents = 0;
  let mcTotalPushbackDays = 0;
  // M-15: track events that actually contributed measured days so the
  // avg-days-per-event denominator excludes legacy count-only events that
  // have no pushedBackDays.
  let mcTotalPushbackEventsWithDays = 0;
  let mcEligibleDealsForPushbackInScope = 0;

  // Closed-only pass: AFC capture, close velocity, and forecast accuracy only make
  // sense once a deal has actually closed, so leave them scoped to CLOSED_DEAL_STATUSES.
  allClosedDealsInPushbackWindow.forEach((payment) => {
    const key = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    const pairedAtRaw = payment.referral?.sla?.lastPairedAt;
    const closingDate = resolveClosingDate(payment);
    const pairedAt = pairedAtRaw ? new Date(pairedAtRaw) : null;
    // M-13: close-velocity must only include deals that actually used the
    // assigned agent (matches isClosedDealEligible). Outside-agent closings
    // don't represent the MC's velocity and were skewing the median.
    if (
      isClosedDealEligible(payment) &&
      closingDate &&
      pairedAt &&
      !Number.isNaN(closingDate.getTime()) &&
      !Number.isNaN(pairedAt.getTime()) &&
      closingDate >= pairedAt
    ) {
      const days = differenceInCalendarDays(closingDate, pairedAt);
      const values = mcVelocityDaysMap.get(key) ?? [];
      values.push(days);
      mcVelocityDaysMap.set(key, values);
    }

    const side = resolveDealSideForMetrics(
      payment.side,
      payment.referral?.dealSide,
      payment.referral?.clientType ?? null
    );
    if (
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent === true &&
      isAfcEligibleDeal(payment.referral?.org ?? null, side)
    ) {
      const current = mcAfcCaptureMap.get(key) ?? { eligible: 0, captured: 0 };
      current.eligible += 1;
      if (payment.usedAfc === true) {
        current.captured += 1;
      }
      mcAfcCaptureMap.set(key, current);
    }

    // M-14: forecast accuracy should align with the revenue-eligible deal
    // set so outside-agent deals aren't counted against MC forecast.
    if (isRevenueEligiblePayment(payment)) {
      const forecastCurrent = mcForecastMap.get(key) ?? { expected: 0, realized: 0 };
      forecastCurrent.expected += Math.max(payment.expectedAmountCents ?? 0, 0);
      forecastCurrent.realized += Math.max(payment.receivedAmountCents ?? 0, 0);
      mcForecastMap.set(key, forecastCurrent);
    }
  });

  // Pushback pass: any non-terminated deal whose closing date was moved later counts,
  // whether the deal is still under contract or already closed.
  allDealsInPushbackWindow.forEach((payment) => {
    mcEligibleDealsForPushbackInScope += 1;
    const key = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    mcEligibleDealsForPushbackRateMap.set(
      key,
      (mcEligibleDealsForPushbackRateMap.get(key) ?? 0) + 1
    );

    const { events: pushbackEvents, pushedBackDays, eventsWithDays } = resolvePushbackMetricsInTimeframe(
      payment,
      timeframe
    );
    if (pushbackEvents > 0) {
      const current = mcPushbackStatsMap.get(key) ?? {
        dealsWithPushback: 0,
        totalPushbackEvents: 0,
        totalPushedBackDays: 0
      };
      current.dealsWithPushback += 1;
      current.totalPushbackEvents += pushbackEvents;
      current.totalPushedBackDays += pushedBackDays;
      mcPushbackStatsMap.set(key, current);

      mcDistinctDealsPushedBack += 1;
      mcTotalPushbackEvents += pushbackEvents;
      mcTotalPushbackDays += pushedBackDays;
      mcTotalPushbackEventsWithDays += eventsWithDays;
    }
  });

  const mcAgingRiskMap = new Map<
    string,
    { bucket0To30: number; bucket31To60: number; bucket61Plus: number; total: number }
  >();
  // C-18: use `normalizeStatusKey` (same helper used elsewhere) and include
  // 'terminated' in addition to 'closed' / 'lost' so terminal referrals don't
  // appear as aging pipeline risk.
  const inactiveReferralStatuses = new Set(['closed', 'lost', 'terminated']);
  const agingAnchorDate = timeframeEnd ?? new Date();
  filteredReferrals.forEach((referral) => {
    const key = referral.lender ? referral.lender.toString() : 'unassigned';
    const normalizedStatus = normalizeStatusKey(referral.status ?? '');
    if (inactiveReferralStatuses.has(normalizedStatus)) {
      return;
    }
    const activityDate = referral.statusLastUpdated ?? referral.updatedAt ?? referral.createdAt;
    const days = Math.max(0, differenceInCalendarDays(agingAnchorDate, activityDate));
    const current = mcAgingRiskMap.get(key) ?? {
      bucket0To30: 0,
      bucket31To60: 0,
      bucket61Plus: 0,
      total: 0
    };
    current.total += 1;
    if (days <= 30) {
      current.bucket0To30 += 1;
    } else if (days <= 60) {
      current.bucket31To60 += 1;
    } else {
      current.bucket61Plus += 1;
    }
    mcAgingRiskMap.set(key, current);
  });

  const mcTerminatedMap = new Map<
    string,
    {
      total: number;
      reasons: Record<TerminatedReasonKey, number>;
    }
  >();
  terminatedWithinNetwork.forEach((payment) => {
    const key = payment.referral?.lender ? payment.referral.lender.toString() : 'unassigned';
    const reason = payment.terminatedReason ?? 'unknown';
    const current = mcTerminatedMap.get(key) ?? {
      total: 0,
      reasons: { financing: 0, appraisal: 0, inspection: 0, changed_mind: 0, unknown: 0 }
    };
    current.total += 1;
    current.reasons[reason] += 1;
    mcTerminatedMap.set(key, current);
  });

  const sourceTotals = new Map<string, number>();
  const sourceClosedTotals = new Map<string, number>();
  const sourceBreakdownByMc = new Map<string, Map<string, number>>();
  filteredReferrals.forEach((referral) => {
    const source = String(referral.source ?? 'Unknown');
    sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + 1);
    if (closedDealReferralIds.has(referral._id.toString())) {
      sourceClosedTotals.set(source, (sourceClosedTotals.get(source) ?? 0) + 1);
    }

    const mcKey = referral.lender ? referral.lender.toString() : 'unassigned';
    const sourceMap = sourceBreakdownByMc.get(mcKey) ?? new Map<string, number>();
    sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
    sourceBreakdownByMc.set(mcKey, sourceMap);
  });

  const sourceCloseRateMap = new Map<string, number>();
  for (const [source, total] of sourceTotals) {
    sourceCloseRateMap.set(source, total > 0 ? ((sourceClosedTotals.get(source) ?? 0) / total) * 100 : 0);
  }
  const sourceTotalsForAfcRisk = new Map<string, number>();
  const sourceClosedTotalsForAfcRisk = new Map<string, number>();
  const closedReferralIdsForAfcRisk = new Set(
    allClosedDealsForAfcRisk.map((payment) => payment.referral._id.toString())
  );
  referralsByNetwork.forEach((referral) => {
    const source = String(referral.source ?? 'Unknown');
    sourceTotalsForAfcRisk.set(source, (sourceTotalsForAfcRisk.get(source) ?? 0) + 1);
    if (closedReferralIdsForAfcRisk.has(referral._id.toString())) {
      sourceClosedTotalsForAfcRisk.set(source, (sourceClosedTotalsForAfcRisk.get(source) ?? 0) + 1);
    }
  });
  const sourceCloseRateForAfcRiskMap = new Map<string, number>();
  for (const [source, total] of sourceTotalsForAfcRisk) {
    sourceCloseRateForAfcRiskMap.set(
      source,
      total > 0 ? ((sourceClosedTotalsForAfcRisk.get(source) ?? 0) / total) * 100 : 0
    );
  }

  const mcKpiRaw: Record<McKpiKey, Map<string, number>> = {
    closedDealsWithAfc: new Map(),
    closedDealsWithoutAfc: new Map(),
    totalRevenueGenerated: new Map(),
    revenuePerReferral: new Map(),
    pipelineCashConversion: new Map(),
    closeVelocityMedianDays: new Map(),
    referralCount: new Map(),
    dealPushbackRate: new Map(),
    noAfcCloseRate: new Map(),
    noAssignedAgentCloseRate: new Map(),
    financingTerminationRate: new Map(),
    agingPipelineRisk: new Map(),
    sourceQualityIndex: new Map(),
    afcCaptureRate: new Map(),
    ahaAttachRate: new Map(),
    ahaOosAttachRate: new Map(),
    forecastAccuracy: new Map(),
    npsScore: new Map()
  };
  const mcKpiDisplayMap: Record<McKpiKey, Map<string, string>> = {
    closedDealsWithAfc: new Map(),
    closedDealsWithoutAfc: new Map(),
    totalRevenueGenerated: new Map(),
    revenuePerReferral: new Map(),
    pipelineCashConversion: new Map(),
    closeVelocityMedianDays: new Map(),
    referralCount: new Map(),
    dealPushbackRate: new Map(),
    noAfcCloseRate: new Map(),
    noAssignedAgentCloseRate: new Map(),
    financingTerminationRate: new Map(),
    agingPipelineRisk: new Map(),
    sourceQualityIndex: new Map(),
    afcCaptureRate: new Map(),
    ahaAttachRate: new Map(),
    ahaOosAttachRate: new Map(),
    forecastAccuracy: new Map(),
    npsScore: new Map()
  };

  const mcIdsForRanking = new Set<string>([
    ...referralByMcMap.keys(),
    ...mcRevenueMap.keys(),
    ...mcTotalClosedDealsMap.keys(),
    ...mcPushbackStatsMap.keys(),
    ...mcTerminatedMap.keys(),
    ...sourceBreakdownByMc.keys(),
    ...mcAgingRiskMap.keys()
  ]);
  mcIdsForRanking.delete('unassigned');
  for (const id of excludedMcIds) {
    mcIdsForRanking.delete(id);
  }

  for (const id of mcIdsForRanking) {
    const referralsForMc = referralByMcMap.get(id) ?? 0;
    const mcRevenue = mcRevenueMap.get(id) ?? { revenue: 0, expected: 0, closed: 0, totalReferrals: 0 };
    const realizedRevenue = mcRevenue.revenue;
    const totalClosedDeals = mcTotalClosedDealsMap.get(id) ?? 0;

    // Closed-deal volume split by AFC usage. Set explicitly for every ranked MC
    // (including 0) so non-closers normalize to 0 on these drivers rather than
    // receiving a neutral 50.
    const closedDealsWithoutAfc = mcNoAfcClosesMap.get(id) ?? 0;
    const closedDealsWithAfc = Math.max(0, totalClosedDeals - closedDealsWithoutAfc);
    mcKpiRaw.closedDealsWithAfc.set(id, closedDealsWithAfc);
    mcKpiDisplayMap.closedDealsWithAfc.set(id, closedDealsWithAfc.toLocaleString());
    mcKpiRaw.closedDealsWithoutAfc.set(id, closedDealsWithoutAfc);
    mcKpiDisplayMap.closedDealsWithoutAfc.set(id, closedDealsWithoutAfc.toLocaleString());

    const ahaAttach = mcAhaAttachMap.get(id);
    if (ahaAttach && ahaAttach.relevant > 0) {
      const ahaAttachRate = (ahaAttach.attached / ahaAttach.relevant) * 100;
      mcKpiRaw.ahaAttachRate.set(id, ahaAttachRate);
      mcKpiDisplayMap.ahaAttachRate.set(
        id,
        `${ahaAttachRate.toFixed(1)}% (${ahaAttach.attached}/${ahaAttach.relevant})`
      );
    }

    const ahaOosAttach = mcAhaOosAttachMap.get(id);
    if (ahaOosAttach && ahaOosAttach.relevant > 0) {
      const ahaOosAttachRate = (ahaOosAttach.attached / ahaOosAttach.relevant) * 100;
      mcKpiRaw.ahaOosAttachRate.set(id, ahaOosAttachRate);
      mcKpiDisplayMap.ahaOosAttachRate.set(
        id,
        `${ahaOosAttachRate.toFixed(1)}% (${ahaOosAttach.attached}/${ahaOosAttach.relevant})`
      );
    }

    mcKpiRaw.totalRevenueGenerated.set(id, realizedRevenue);
    mcKpiDisplayMap.totalRevenueGenerated.set(
      id,
      `$${Math.round(realizedRevenue / 100).toLocaleString()}`
    );

    mcKpiRaw.referralCount.set(id, referralsForMc);
    mcKpiDisplayMap.referralCount.set(id, referralsForMc.toLocaleString());

    if (referralsForMc > 0) {
      // M-17: use cohort-aligned revenue (revenue from referrals created in
      // this timeframe) so the numerator matches the denominator cohort.
      const cohortRevenue = cohortRevenueByMcMap.get(id) ?? 0;
      const revenuePerReferral = cohortRevenue / referralsForMc;
      mcKpiRaw.revenuePerReferral.set(id, revenuePerReferral);
      mcKpiDisplayMap.revenuePerReferral.set(id, `$${Math.round(revenuePerReferral / 100).toLocaleString()}`);
    }

    if (realizedRevenue + mcRevenue.expected > 0) {
      const conversion = (realizedRevenue / (realizedRevenue + mcRevenue.expected)) * 100;
      mcKpiRaw.pipelineCashConversion.set(id, conversion);
      mcKpiDisplayMap.pipelineCashConversion.set(id, `${conversion.toFixed(1)}%`);
    }

    const velocityValues = mcVelocityDaysMap.get(id) ?? [];
    if (velocityValues.length > 0) {
      const medianDays = computeMedian(velocityValues);
      mcKpiRaw.closeVelocityMedianDays.set(id, medianDays);
      mcKpiDisplayMap.closeVelocityMedianDays.set(id, `${medianDays.toFixed(1)} days`);
    }

    const aging = mcAgingRiskMap.get(id);
    if (aging && aging.total > 0) {
      const riskIndex = ((aging.bucket31To60 + aging.bucket61Plus * 2) / aging.total) * 50;
      mcKpiRaw.agingPipelineRisk.set(id, riskIndex);
      mcKpiDisplayMap.agingPipelineRisk.set(
        id,
        `${aging.bucket0To30}/${aging.bucket31To60}/${aging.bucket61Plus} (0-30/31-60/61+)`
      );
    }

    const terminated = mcTerminatedMap.get(id);
    const closedDeals = mcTotalClosedDealsMap.get(id) ?? 0;
    const outcomeCount = (terminated?.total ?? 0) + closedDeals;
    if (outcomeCount > 0) {
      const financingTerminationCount = terminated?.reasons.financing ?? 0;
      const financingTerminationRate = (financingTerminationCount / outcomeCount) * 100;
      mcKpiRaw.financingTerminationRate.set(id, financingTerminationRate);
      mcKpiDisplayMap.financingTerminationRate.set(
        id,
        `${financingTerminationRate.toFixed(1)}% (${financingTerminationCount})`
      );
    }
    const sourceCounts = sourceBreakdownByMc.get(id);
    if (sourceCounts && referralsForMc > 0) {
      let weightedSourceScore = 0;
      for (const [source, count] of sourceCounts) {
        weightedSourceScore += count * (sourceCloseRateMap.get(source) ?? 0);
      }
      const sourceQuality = weightedSourceScore / referralsForMc;
      mcKpiRaw.sourceQualityIndex.set(id, sourceQuality);
      mcKpiDisplayMap.sourceQualityIndex.set(id, `${sourceQuality.toFixed(1)} pts`);
    }

    const afcCapture = mcAfcCaptureMap.get(id);
    if (afcCapture && afcCapture.eligible > 0) {
      const afcRate = (afcCapture.captured / afcCapture.eligible) * 100;
      mcKpiRaw.afcCaptureRate.set(id, afcRate);
      mcKpiDisplayMap.afcCaptureRate.set(id, `${afcRate.toFixed(1)}%`);
    }

    const totalEligibleDealsForPushbackRate = mcEligibleDealsForPushbackRateMap.get(id) ?? 0;
    if (totalEligibleDealsForPushbackRate > 0) {
      const pushbackStats = mcPushbackStatsMap.get(id);
      const dealsWithPushback = pushbackStats?.dealsWithPushback ?? 0;
      const dealPushbackRate = (dealsWithPushback / totalEligibleDealsForPushbackRate) * 100;
      mcKpiRaw.dealPushbackRate.set(id, dealPushbackRate);
      mcKpiDisplayMap.dealPushbackRate.set(
        id,
        `${dealPushbackRate.toFixed(1)}% (${dealsWithPushback}/${totalEligibleDealsForPushbackRate})`
      );
    }

    if (totalClosedDeals > 0) {
      const noAfcCloseRate = safePercent(mcNoAfcClosesMap.get(id) ?? 0, totalClosedDeals);
      mcKpiRaw.noAfcCloseRate.set(id, noAfcCloseRate);
      mcKpiDisplayMap.noAfcCloseRate.set(id, `${noAfcCloseRate.toFixed(1)}%`);

      const noAssignedAgentCloseRate = safePercent(
        mcNoAssignedAgentClosesMap.get(id) ?? 0,
        totalClosedDeals
      );
      mcKpiRaw.noAssignedAgentCloseRate.set(id, noAssignedAgentCloseRate);
      mcKpiDisplayMap.noAssignedAgentCloseRate.set(id, `${noAssignedAgentCloseRate.toFixed(1)}%`);
    }

    const forecast = mcForecastMap.get(id);
    if (forecast && forecast.expected > 0) {
      const variancePct = Math.abs(forecast.expected - forecast.realized) / forecast.expected;
      const accuracy = Math.max(0, 100 - variancePct * 100);
      mcKpiRaw.forecastAccuracy.set(id, accuracy);
      mcKpiDisplayMap.forecastAccuracy.set(id, `${accuracy.toFixed(1)}%`);
    }

    const npsScore = lenderNpsMap.get(id);
    if (npsScore != null) {
      mcKpiRaw.npsScore.set(id, npsScore);
      mcKpiDisplayMap.npsScore.set(id, npsScore.toFixed(1));
    }
  }

  const mcKpiNormalized: Record<McKpiKey, Map<string, number>> = {
    closedDealsWithAfc: normalizeAhaKpiMap(mcKpiRaw.closedDealsWithAfc, false),
    closedDealsWithoutAfc: normalizeAhaKpiMap(mcKpiRaw.closedDealsWithoutAfc, false),
    ahaAttachRate: normalizeAhaKpiMap(mcKpiRaw.ahaAttachRate, false),
    ahaOosAttachRate: normalizeAhaKpiMap(mcKpiRaw.ahaOosAttachRate, false),
    totalRevenueGenerated: normalizeAhaKpiMap(mcKpiRaw.totalRevenueGenerated, false),
    revenuePerReferral: normalizeAhaKpiMap(mcKpiRaw.revenuePerReferral, false),
    pipelineCashConversion: normalizeAhaKpiMap(mcKpiRaw.pipelineCashConversion, false),
    closeVelocityMedianDays: normalizeAhaKpiMap(mcKpiRaw.closeVelocityMedianDays, true),
    referralCount: normalizeAhaKpiMap(mcKpiRaw.referralCount, false),
    dealPushbackRate: normalizeAhaKpiMap(mcKpiRaw.dealPushbackRate, true),
    noAfcCloseRate: normalizeAhaKpiMap(mcKpiRaw.noAfcCloseRate, true),
    noAssignedAgentCloseRate: normalizeAhaKpiMap(mcKpiRaw.noAssignedAgentCloseRate, true),
    financingTerminationRate: normalizeAhaKpiMap(mcKpiRaw.financingTerminationRate, true),
    agingPipelineRisk: normalizeAhaKpiMap(mcKpiRaw.agingPipelineRisk, true),
    sourceQualityIndex: normalizeAhaKpiMap(mcKpiRaw.sourceQualityIndex, false),
    afcCaptureRate: normalizeAhaKpiMap(mcKpiRaw.afcCaptureRate, false),
    forecastAccuracy: normalizeAhaKpiMap(mcKpiRaw.forecastAccuracy, false),
    npsScore: normalizeAhaKpiMap(mcKpiRaw.npsScore, false)
  };

  const mcKpiLeaderboard: McRankedEntry[] = Array.from(mcIdsForRanking).map((id) => {
    let weightedSum = 0;
    let totalWeight = 0;
    const referralCount = referralByMcMap.get(id) ?? 0;
    const revenueCents = mcRevenueMap.get(id)?.revenue ?? 0;
    const kpis: McRankedEntry['kpis'] = [];

    for (const key of MC_KPI_ORDER) {
      const rawValue = mcKpiRaw[key].get(id);
      const neutralFilled = rawValue == null;
      const normalizedScore = neutralFilled
        ? AHA_NEUTRAL_SCORE
        : mcKpiNormalized[key].get(id) ?? AHA_NEUTRAL_SCORE;
      const weight = MC_KPI_WEIGHTS[key];
      // M-11 / U-5: exclude neutral-filled KPIs from the composite denominator
      // so the score reflects measured performance only.
      if (!neutralFilled) {
        weightedSum += normalizedScore * weight;
        totalWeight += weight;
      }
      kpis.push({
        label: MC_KPI_LABELS[key],
        key,
        rawValue: rawValue ?? 0,
        displayValue: neutralFilled
          ? 'No data (neutral)'
          : mcKpiDisplayMap[key].get(id) ?? String(Math.round(rawValue)),
        normalizedScore: Math.round(normalizedScore * 10) / 10,
        weight: MC_KPI_TIERS[key],
        neutralFilled
      });
    }

    const baseScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : AHA_NEUTRAL_SCORE;
    const reliabilityFactor = computeAhaReliabilityFactor(referralCount, MC_MIN_REFERRALS_FOR_RANK);
    const score = Math.round(baseScore * reliabilityFactor * 10) / 10;

    return {
      id,
      name: lenderNameMap.get(id) ?? 'Unknown MC',
      score,
      baseScore,
      reliabilityFactor: Math.round(reliabilityFactor * 1000) / 1000,
      rank: 0,
      qualified: referralCount >= MC_MIN_REFERRALS_FOR_RANK,
      referralCount,
      revenueCents,
      kpis
    };
  });
  mcKpiLeaderboard.sort((a, b) =>
    compareAhaRankedAgents(
      { id: a.id, score: a.score, referralCount: a.referralCount, netCommissionCents: a.revenueCents },
      { id: b.id, score: b.score, referralCount: b.referralCount, netCommissionCents: b.revenueCents }
    )
  );
  mcKpiLeaderboard.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const latestPaymentByReferralId = new Map<string, AggregatedPayment>();
  paymentsByNetwork.forEach((payment) => {
    const referralId = payment.referral?._id?.toString();
    if (!referralId) return;
    const current = latestPaymentByReferralId.get(referralId);
    if (!current) {
      latestPaymentByReferralId.set(referralId, payment);
      return;
    }
    if (new Date(payment.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
      latestPaymentByReferralId.set(referralId, payment);
    }
  });

  const mcCandidateReferrals = referralsByNetwork.filter((referral) => {
    if (!referral.lender) return false;
    const normalizedStatus = normalizeStatusKey(referral.status);
    const referralId = referral._id.toString();
    const linkedPayment = latestPaymentByReferralId.get(referralId);
    if (isTerminalReferralStatus(referral.status)) return false;
    if (linkedPayment && isTerminalPaymentStatus(linkedPayment.status)) return false;
    if (!ACTIVE_PIPELINE_STATUS_KEYS.has(normalizedStatus)) return false;
    const inferredDealSide = resolveDealSideForMetrics(
      null,
      referral.dealSide ?? null,
      referral.clientType ?? null
    );
    if ((referral.org ?? null) !== 'AFC') return false;
    if (inferredDealSide === 'sell') return false;
    return true;
  });
  const mcRiskReferralIds = new Set(mcCandidateReferrals.map((referral) => referral._id.toString()));

  const mcRiskActivities =
    mcRiskReferralIds.size > 0
      ? await Activity.aggregate<{ _id: Types.ObjectId; lastActivityAt: Date }>([
          {
            $match: {
              referralId: { $in: Array.from(mcRiskReferralIds, (id) => new Types.ObjectId(id)) }
            }
          },
          { $group: { _id: '$referralId', lastActivityAt: { $max: '$createdAt' } } }
        ])
      : [];
  const mcRiskLastActivityMap = new Map(
    mcRiskActivities.map((item) => [item._id.toString(), item.lastActivityAt])
  );
  const mcRiskActivityTextRows =
    mcRiskReferralIds.size > 0
      ? await Activity.find({
          referralId: { $in: Array.from(mcRiskReferralIds, (id) => new Types.ObjectId(id)) },
          content: { $exists: true, $ne: '' },
          channel: { $in: ['note', 'status', 'update', 'call', 'sms', 'email'] }
        })
          .select('referralId content createdAt')
          .lean<{ referralId: Types.ObjectId; content?: string | null; createdAt?: Date }[]>()
          .exec()
      : [];
  const mcRiskTextByReferralId = new Map<string, string[]>();
  const appendRiskText = (referralId: string, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (!text) return;
    const current = mcRiskTextByReferralId.get(referralId) ?? [];
    if (!current.includes(text)) {
      current.push(text);
    }
    mcRiskTextByReferralId.set(referralId, current);
  };
  mcCandidateReferrals.forEach((referral) => {
    const referralId = referral._id.toString();
    appendRiskText(referralId, referral.initialNotes);
    (referral.notes ?? []).forEach((note) => appendRiskText(referralId, note.content));
  });
  mcRiskActivityTextRows.forEach((activity) => {
    appendRiskText(activity.referralId.toString(), activity.content);
  });

  const mcAfcRiskCallList: McAfcRiskCallListEntry[] = mcCandidateReferrals
    .map((referral) => {
      const referralId = referral._id.toString();
      const linkedPayment = latestPaymentByReferralId.get(referralId);
      const mcId = referral.lender?.toString() ?? null;
      const agentId = referral.assignedAgent?.toString() ?? null;
      const closingDate = linkedPayment?.closingDate ? new Date(linkedPayment.closingDate) : null;
      const daysToClose = closingDate ? differenceInCalendarDays(closingDate, now) : null;
      const lastActivity =
        mcRiskLastActivityMap.get(referralId) ??
        referral.statusLastUpdated ??
        referral.updatedAt ??
        referral.createdAt;
      const lastActivityDate = new Date(lastActivity);
      const daysSinceActivity = Number.isNaN(lastActivityDate.getTime())
        ? 0
        : Math.max(0, differenceInCalendarDays(now, lastActivityDate));

      let riskScore = 0;
      const reasons: { label: string; score: number }[] = [];

      if (linkedPayment && linkedPayment.usedAfc !== true) {
        riskScore += 35;
        reasons.push({ label: 'AFC not attached on deal record', score: 35 });
      }

      if (!agentId) {
        riskScore += 12;
        reasons.push({ label: 'No assigned agent', score: 12 });
      }

      if (daysSinceActivity >= 30) {
        riskScore += 25;
        reasons.push({ label: `${daysSinceActivity} days since last activity`, score: 25 });
      } else if (daysSinceActivity >= 14) {
        riskScore += 15;
        reasons.push({ label: `${daysSinceActivity} days since last activity`, score: 15 });
      } else if (daysSinceActivity >= 7) {
        riskScore += 8;
        reasons.push({ label: `${daysSinceActivity} days since last activity`, score: 8 });
      }

      const noteSignal = scoreOutsideLenderNoteSignals(mcRiskTextByReferralId.get(referralId) ?? []);
      if (noteSignal.score > 0) {
        riskScore += noteSignal.score;
      }
      if (noteSignal.reasons.length > 0) {
        noteSignal.reasons.forEach((reason) => {
          reasons.push(reason);
        });
      }

      if (daysToClose != null) {
        if (daysToClose <= 7) {
          riskScore += 20;
          reasons.push({ label: `${daysToClose} days to close`, score: 20 });
        } else if (daysToClose <= 14) {
          riskScore += 14;
          reasons.push({ label: `${daysToClose} days to close`, score: 14 });
        } else if (daysToClose <= 30) {
          riskScore += 8;
          reasons.push({ label: `${daysToClose} days to close`, score: 8 });
        }
      }

      const outsideLossRate = mcId
        ? (mcOutsideLenderLossForAfcRiskMap.get(mcId) ?? 0) /
          Math.max(mcTotalClosedDealsForAfcRiskMap.get(mcId) ?? 1, 1)
        : 0;
      const mcClosedSampleSize = mcId ? mcTotalClosedDealsForAfcRiskMap.get(mcId) ?? 0 : 0;
      const historicalRiskBoost = computeHistoricalRiskBoost(outsideLossRate, mcClosedSampleSize);
      if (historicalRiskBoost > 0) {
        riskScore += historicalRiskBoost;
        reasons.push({
          label: `${AFC_RISK_MC_LOSS_REASON_PREFIX} ${(outsideLossRate * 100).toFixed(1)}% (${mcClosedSampleSize} closed)`,
          score: historicalRiskBoost
        });
      }

      const source = String(referral.source ?? 'Unknown');
      const sourceCloseRate = sourceCloseRateForAfcRiskMap.get(source) ?? 0;
      const sourceSampleSize = sourceTotalsForAfcRisk.get(source) ?? 0;
      const sourceFragilityBoost = computeSourceFragilityBoost(sourceCloseRate, sourceSampleSize);
      if (sourceFragilityBoost >= 4) {
        riskScore += sourceFragilityBoost;
        reasons.push({
          label: `Source close-rate baseline ${sourceCloseRate.toFixed(1)}% (${sourceSampleSize} referrals)`,
          score: sourceFragilityBoost
        });
      }

      const normalizedRiskScore = Math.min(100, Math.round(riskScore * 10) / 10);
      const riskTier: McAfcRiskCallListEntry['riskTier'] =
        normalizedRiskScore >= 70 ? 'high' : normalizedRiskScore >= 40 ? 'medium' : 'low';

      const topReasons = prioritizeAfcRiskReasons(reasons, outsideLossRate);
      const hasOutsideLenderNoteSignal = noteSignal.reasons.some(
        (reason) =>
          reason.label.startsWith(AFC_RISK_OUTSIDE_NOTE_REASON_PREFIX) ||
          reason.label.startsWith(AFC_RISK_OUTSIDE_NOTE_SOFT_REASON_PREFIX)
      );
      const hasHighOutsideLenderLoss = outsideLossRate >= AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD;

      return {
        entry: {
          rowId: linkedPayment?._id?.toString() ?? referralId,
          referralId,
          borrowerName: referral.borrower?.name ?? 'Unknown',
          mcId,
          mcName: mcId ? (lenderNameMap.get(mcId) ?? null) : null,
          agentId,
          agentName: agentId ? (agentNameMap.get(agentId) ?? null) : null,
          status: (referral.status ?? 'New Lead').replace(/_/g, ' '),
          source,
          closingDate: closingDate ? closingDate.toISOString() : null,
          daysToClose,
          daysSinceActivity,
          usedAfc: linkedPayment?.usedAfc ?? null,
          riskScore: normalizedRiskScore,
          riskTier,
          reasons: topReasons
        },
        hasHighOutsideLenderLoss,
        hasOutsideLenderNoteSignal
      };
    })
    .filter((item) => item.entry.riskScore >= AFC_RISK_AT_RISK_SCORE_THRESHOLD)
    .sort(
      (a, b) =>
        Number(b.hasHighOutsideLenderLoss) - Number(a.hasHighOutsideLenderLoss) ||
        Number(b.hasOutsideLenderNoteSignal) - Number(a.hasOutsideLenderNoteSignal) ||
        b.entry.riskScore - a.entry.riskScore ||
        (a.entry.daysToClose ?? Number.POSITIVE_INFINITY) -
          (b.entry.daysToClose ?? Number.POSITIVE_INFINITY)
    )
    .map((item) => item.entry);

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
  // M-23: count referrals that entered the Lost status within this timeframe
  // (same semantics as the AHA/AGIT lostDeals series) rather than referrals
  // created in this timeframe that happen to be Lost today. This keeps the
  // "Lost referrals by agent" table in-sync with a changing timeframe.
  const agentLostDealsMap = new Map<string, number>();
  referralsByNetwork.forEach((referral) => {
    if (referral.status !== 'Lost') return;
    const lostAt = referral.statusLastUpdated ?? referral.updatedAt ?? referral.createdAt;
    if (!isWithinTimeframe(lostAt)) return;
    const key = referral.assignedAgent ? referral.assignedAgent.toString() : 'unassigned';
    agentLostDealsMap.set(key, (agentLostDealsMap.get(key) ?? 0) + 1);
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

    // M-20: Agent "Revenue Paid" leaderboard must only sum actually-paid payments.
    // Any non-'paid' status with a receivedAmount value should not contribute.
    if (!isOutsideAgentDeal && payment.status === 'paid') {
      current.revenue += payment.receivedAmountCents ?? 0;
    }
    if (!isOutsideAgentDeal) {
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
        // Resolve each closed deal's agent commission as a percentage so flat-fee
        // (dollar) deals are converted to a percent and averaged in alongside
        // percent-based deals. Flat fee wins because deals entered in "$" mode
        // store the dollar amount and clear the basis points, while the referral
        // still carries the default 3% — so checking basis points first would
        // wrongly treat dollar deals as the default percentage.
        const flatFeeCents = payment.commissionFlatFeeCents ?? 0;
        let commissionPercent: number;
        let commissionCents: number;
        if (flatFeeCents > 0) {
          commissionCents = flatFeeCents;
          commissionPercent = contractPriceCents > 0 ? (flatFeeCents / contractPriceCents) * 100 : 0;
        } else {
          const resolvedCommissionBasisPoints =
            (payment.commissionBasisPoints ?? 0) > 0
              ? payment.commissionBasisPoints!
              : (payment.referral?.commissionBasisPoints ?? 0) > 0
                ? payment.referral!.commissionBasisPoints!
                : DEFAULT_AGENT_COMMISSION_BPS;
          commissionPercent = resolvedCommissionBasisPoints / 100;
          commissionCents = (contractPriceCents * resolvedCommissionBasisPoints) / 10000;
        }

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
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.referrals - a.referrals)
    .slice(0, 10);

  const agentCloseRateLeaderboard = Array.from(agentReferralCount.entries())
    .map(([key, totalReferrals]) => {
      const dealsClosed = cohortClosedByAgentMap.get(key) ?? 0;
      return {
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      closeRate: computeCohortCloseRate(dealsClosed, totalReferrals),
      dealsClosed,
      totalReferrals
      };
    })
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.closeRate - a.closeRate)
    .slice(0, 10);

  const agentRevenuePaid = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.revenue
    }))
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const agentRevenueExpected = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.expected
    }))
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const agentAverageClosedDeal = Array.from(agentRevenueMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      revenueCents: value.closed > 0 ? value.closedVolumeCents / value.closed : 0,
    }))
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
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
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  const agentLostDeals = Array.from(agentLostDealsMap.entries())
    .map(([key, value]) => ({
      id: key,
      name: key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent',
      referrals: value
    }))
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
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
    .filter((entry) => isAgentIncludedInLeaderboards(entry.id))
    .sort((a, b) => b.referrals - a.referrals)
    .slice(0, 10);

  // AHA / AHA OOS agent leaderboards — composite score (0–100) per agent
  type AhaRankedAgent = {
    id: string;
    name: string;
    score: number;
    baseScore: number;
    reliabilityFactor: number;
    rank: number;
    qualified: boolean;
    referralCount: number;
    netCommissionCents: number;
    kpis: {
      label: string;
      key: string;
      rawValue: number;
      displayValue: string;
      normalizedScore: number;
      weight: 'high' | 'medium' | 'low';
      neutralFilled: boolean;
    }[];
  };
  type AhaLeaderboardsResult = { rankedAgents: AhaRankedAgent[] };
  const AHA_MIN_REFERRALS_FOR_RANK = 3;
  const AHA_MIN_CLOSED_DEALS_FOR_DEAL_SIZE = 3;

  const AHA_KPI_WEIGHTS: Record<string, number> = {
    closeRate: 5,
    underContractRate: 3, afcAttachRate: 3, npsScore: 3, lostDeals: 3, avgDaysToContract: 3,
    revenuePaid: 2, avgTimeToFirstContact: 2,
    avgDealSize: 1, netCommission: 1, referralCount: 1, crmUsage: 1,
  };
  const AHA_KPI_TIERS: Record<string, 'high' | 'medium' | 'low'> = {
    closeRate: 'high', underContractRate: 'high', afcAttachRate: 'high', npsScore: 'high',
    lostDeals: 'high', avgDaysToContract: 'high',
    revenuePaid: 'medium', avgTimeToFirstContact: 'medium',
    avgDealSize: 'low', netCommission: 'low', referralCount: 'low', crmUsage: 'low',
  };
  const AHA_KPI_LABELS: Record<string, string> = {
    closeRate: 'Close Rate', underContractRate: 'Under Contract Rate',
    afcAttachRate: 'AFC Attach Rate', npsScore: 'NPS Score',
    lostDeals: 'Lost Deals', avgDaysToContract: 'Avg. Days to Contract',
    revenuePaid: 'Revenue Paid', avgTimeToFirstContact: 'Avg. Time to First Contact',
    avgDealSize: 'Avg. Deal Size', netCommission: 'Net Commission',
    referralCount: 'Referral Count', crmUsage: 'CRM Usage',
  };
  const AHA_KPI_ORDER = [
    'closeRate', 'underContractRate', 'afcAttachRate', 'lostDeals',
    'avgDaysToContract', 'npsScore', 'revenuePaid', 'avgTimeToFirstContact',
    'avgDealSize', 'netCommission', 'referralCount', 'crmUsage',
  ];
  const CRM_USAGE_CHANNELS: Array<'note' | 'status' | 'update' | 'call' | 'sms' | 'email'> = [
    'note',
    'status',
    'update',
    'call',
    'sms',
    'email'
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
      case 'crmUsage':
        return `${Math.round(raw)} pts`;
      default:
        return String(Math.round(raw));
    }
  };

  const buildAhaAgentLeaderboards = async (
    bucketReferrals: DashboardReferral[],
    bucketPayments: AggregatedPayment[],
    bucketAllNetworkPayments: AggregatedPayment[]
  ): Promise<AhaLeaderboardsResult> => {
    const getName = (key: string) =>
      key === 'unassigned' ? 'Unassigned Agent' : agentNameMap.get(key) ?? 'Unknown Agent';

    const referralCountMap = new Map<string, number>();
    const lostDealsMap = new Map<string, number>();
    const underContractCountMap = new Map<string, number>();
    const slaContractDaysMap = new Map<string, number[]>();
    const slaFirstContactMap = new Map<string, number[]>();
    const bucketReferralIds = new Set(bucketReferrals.map((r) => r._id.toString()));
    const cohortClosedCountMap = new Map<string, number>();

    bucketReferrals.forEach((r) => {
      const key = r.assignedAgent?.toString() ?? 'unassigned';
      referralCountMap.set(key, (referralCountMap.get(key) ?? 0) + 1);
      const lostAt = r.statusLastUpdated ?? r.updatedAt ?? r.createdAt;
      if (r.status === 'Lost' && isWithinTimeframe(lostAt)) {
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

    bucketAllNetworkPayments.forEach((payment) => {
      const referralId = payment.referral?._id?.toString();
      if (!referralId || !bucketReferralIds.has(referralId) || !isClosedDealEligible(payment)) {
        return;
      }
      const key = payment.referral?.assignedAgent?.toString() ?? 'unassigned';
      cohortClosedCountMap.set(key, (cohortClosedCountMap.get(key) ?? 0) + 1);
    });

    const bucketReferralObjectIds = Array.from(bucketReferralIds, (id) => new Types.ObjectId(id));
    const activityMatch: {
      referralId: { $in: Types.ObjectId[] };
      actor: 'Agent';
      actorId: { $exists: true; $ne: null };
      channel: { $in: Array<'note' | 'status' | 'update' | 'call' | 'sms' | 'email'> };
      createdAt?: { $gte?: Date; $lte?: Date };
    } = {
      referralId: { $in: bucketReferralObjectIds },
      actor: 'Agent',
      actorId: { $exists: true, $ne: null },
      channel: { $in: CRM_USAGE_CHANNELS }
    };
    if (timeframeStart || timeframeEnd) {
      activityMatch.createdAt = {};
      if (timeframeStart) {
        activityMatch.createdAt.$gte = timeframeStart;
      }
      if (timeframeEnd) {
        activityMatch.createdAt.$lte = timeframeEnd;
      }
    }
    const activityByAgentUser = bucketReferralObjectIds.length
      ? await Activity.aggregate<{ _id: Types.ObjectId; totalEvents: number; activeDaysCount: number }>([
          { $match: activityMatch },
          {
            $group: {
              _id: '$actorId',
              totalEvents: { $sum: 1 },
              activeDays: {
                $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
              }
            }
          },
          {
            $project: {
              totalEvents: 1,
              activeDaysCount: { $size: '$activeDays' }
            }
          }
        ])
      : [];

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
          const dealSide = resolveDealSideForMetrics(
            payment.side,
            payment.referral?.dealSide,
            payment.referral?.clientType ?? null
          );
          if (dealSide === 'buy') {
            current.afcEligibleDeals += 1;
            if (payment.usedAfc) current.afcAttachedDeals += 1;
          }
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
      avgTimeToFirstContact: new Map(), npsScore: new Map(), crmUsage: new Map(),
    };
    const crmUsageByAgentId = new Map<string, number>();
    activityByAgentUser.forEach((row) => {
      const agentId = agentUserIdToAgentIdMap.get(row._id.toString());
      if (!agentId) {
        return;
      }
      const usage = computeCappedActivityUsageScore(row.totalEvents, row.activeDaysCount);
      crmUsageByAgentId.set(agentId, (crmUsageByAgentId.get(agentId) ?? 0) + usage);
    });

    for (const [id, count] of referralCountMap) {
      if (id === 'unassigned') continue;
      const perf = agentPerfMap.get(id);
      kpiRaw.referralCount.set(id, count);
      kpiRaw.closeRate.set(id, count > 0 ? ((cohortClosedCountMap.get(id) ?? 0) / count) * 100 : 0);
      kpiRaw.underContractRate.set(id, count > 0 ? ((underContractCountMap.get(id) ?? 0) / count) * 100 : 0);
      kpiRaw.revenuePaid.set(id, perf?.revenue ?? 0);
      kpiRaw.netCommission.set(id, perf?.netCommissionCents ?? 0);
      kpiRaw.lostDeals.set(id, lostDealsMap.get(id) ?? 0);
      if (perf && perf.afcEligibleDeals > 0) {
        kpiRaw.afcAttachRate.set(id, (perf.afcAttachedDeals / perf.afcEligibleDeals) * 100);
      }
      if (perf && perf.closed >= AHA_MIN_CLOSED_DEALS_FOR_DEAL_SIZE) {
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
      const crmUsage = crmUsageByAgentId.get(id);
      if (crmUsage != null && crmUsage > 0) {
        kpiRaw.crmUsage.set(id, crmUsage);
      }
    }

    // Min-max normalize each KPI map
    const kpiNorm: Record<string, Map<string, number>> = {
      referralCount:         normalizeAhaKpiMap(kpiRaw.referralCount, false),
      closeRate:             normalizeAhaKpiMap(kpiRaw.closeRate, false),
      underContractRate:     normalizeAhaKpiMap(kpiRaw.underContractRate, false),
      afcAttachRate:         normalizeAhaKpiMap(kpiRaw.afcAttachRate, false),
      revenuePaid:           normalizeAhaKpiMap(kpiRaw.revenuePaid, false),
      avgDealSize:           normalizeAhaKpiMap(kpiRaw.avgDealSize, false),
      netCommission:         normalizeAhaKpiMap(kpiRaw.netCommission, false),
      lostDeals:             normalizeAhaKpiMap(kpiRaw.lostDeals, true),
      avgDaysToContract:     normalizeAhaKpiMap(kpiRaw.avgDaysToContract, true),
      avgTimeToFirstContact: normalizeAhaKpiMap(kpiRaw.avgTimeToFirstContact, true),
      npsScore:              normalizeAhaKpiMap(kpiRaw.npsScore, false),
      crmUsage:              normalizeAhaKpiMap(kpiRaw.crmUsage, false),
    };

    // Compute composite score per agent
    const rankedAgents: AhaRankedAgent[] = Array.from(kpiRaw.referralCount.keys())
      .filter((id) => id === 'unassigned' || isAgentIncludedInLeaderboards(id))
      .map((id) => {
      let weightedSum = 0;
      let totalWeight = 0;
      const kpis: AhaRankedAgent['kpis'] = [];
      const referralCount = kpiRaw.referralCount.get(id) ?? 0;
      const netCommissionCents = kpiRaw.netCommission.get(id) ?? 0;

      for (const key of AHA_KPI_ORDER) {
        const rawVal = kpiRaw[key].get(id);
        const neutralFilled = rawVal == null;
        const normalizedScore = neutralFilled
          ? AHA_NEUTRAL_SCORE
          : kpiNorm[key].get(id) ?? AHA_NEUTRAL_SCORE;
        const w = AHA_KPI_WEIGHTS[key];
        if (!neutralFilled) {
          weightedSum += normalizedScore * w;
          totalWeight += w;
        }
        kpis.push({
          label: AHA_KPI_LABELS[key],
          key,
          rawValue: rawVal ?? 0,
          displayValue: neutralFilled ? 'No data (neutral)' : formatAhaKpiDisplay(key, rawVal),
          normalizedScore: Math.round(normalizedScore * 10) / 10,
          weight: AHA_KPI_TIERS[key],
          neutralFilled,
        });
      }

      const baseScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : AHA_NEUTRAL_SCORE;
      const reliabilityFactor = computeAhaReliabilityFactor(referralCount, AHA_MIN_REFERRALS_FOR_RANK);
      const score = Math.round(baseScore * reliabilityFactor * 10) / 10;
      const qualified = referralCount >= AHA_MIN_REFERRALS_FOR_RANK;

      return {
        id,
        name: getName(id),
        score,
        baseScore,
        reliabilityFactor: Math.round(reliabilityFactor * 1000) / 1000,
        rank: 0,
        qualified,
        referralCount,
        netCommissionCents,
        kpis
      };
    });

    rankedAgents.sort(compareAhaRankedAgents);
    rankedAgents.forEach((a, i) => { a.rank = i + 1; });

    return { rankedAgents };
  };

  const ahaFilteredReferrals = filteredReferrals.filter((r) => getReferralDesignation(r) === 'AHA');
  const ahaOosFilteredReferrals = filteredReferrals.filter((r) => getReferralDesignation(r) === 'AHA_OOS');
  const ahaFilteredPayments = filteredPaymentsByNetwork.filter((p) => getAgentDesignation(p) === 'AHA');
  const ahaOosFilteredPayments = filteredPaymentsByNetwork.filter((p) => getAgentDesignation(p) === 'AHA_OOS');
  const ahaAllNetworkPayments = paymentsByNetwork.filter((p) => getAgentDesignation(p) === 'AHA');
  const ahaOosAllNetworkPayments = paymentsByNetwork.filter((p) => getAgentDesignation(p) === 'AHA_OOS');

  const ahaLeaderboards = await buildAhaAgentLeaderboards(
    ahaFilteredReferrals,
    ahaFilteredPayments,
    ahaAllNetworkPayments
  );
  const ahaOosLeaderboards = await buildAhaAgentLeaderboards(
    ahaOosFilteredReferrals,
    ahaOosFilteredPayments,
    ahaOosAllNetworkPayments
  );

  // Admin metrics: referrals created within timeframe and network only.
  // "Unassigned" = still in "New Lead" (not paired). "Assigned" = moved to Paired or beyond.
  const adminEligibleReferrals = filteredReferrals;

  // M-29: assignment rate must be driven by `assignedAgent` presence, not by
  // referral.status === 'New Lead' (which can be true after re-opens, etc).
  const assignedReferrals = adminEligibleReferrals.filter(
    (referral) => Boolean(referral.assignedAgent)
  ).length;
  const unassignedReferrals = adminEligibleReferrals.length - assignedReferrals;
  const assignmentRate = safePercent(assignedReferrals, adminEligibleReferrals.length);

  const slaFields = adminEligibleReferrals
    .map((referral) => referral.sla)
    .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

  const firstContactRecords = slaFields
    .map((sla) => sla.timeToFirstAgentContactHours ?? null)
    .filter((value): value is number => value != null);
  // M-28: use SLA_THRESHOLDS.hoursToFirstConversation instead of a hard-coded 24.
  const firstContactWithin24HoursCount = firstContactRecords.filter(
    (value) => value <= SLA_THRESHOLDS.hoursToFirstConversation
  ).length;
  const firstContactWithin24HoursRate = safePercent(
    firstContactWithin24HoursCount,
    firstContactRecords.length
  );

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

      const leadStart = getReferralTimeframeAnchor(referral);
      const lastUnderContractAt = referral.sla.lastUnderContractAt
        ? new Date(referral.sla.lastUnderContractAt)
        : null;
      if (leadStart && lastUnderContractAt && lastUnderContractAt >= leadStart) {
        return differenceInCalendarDays(lastUnderContractAt, leadStart);
      }
      return null;
    })
    .filter((value): value is number => value != null && value >= 0);
  const daysToContractAvg = computeAverage(daysToContractValues);

  const daysToCloseAvg = computeAverage(
    slaFields
      .map((sla) => sla.daysToClose ?? null)
      .filter((value): value is number => value != null && value >= 0)
  );

  const adminAverageLeadToContract = daysToContractAvg;
  const adminAverageContractToClose = daysToCloseAvg;

  // Admin task metrics: overdue, due today, completed today, 30-day trend.
  // Unfiltered AdminTask.find({}) was scanning the entire collection (growing
  // forever) on every dashboard load. We only need:
  //   - all currently-open tasks (for overdue / due-today / total counts and
  //     for "outstanding at end of day" over the 30-day trend)
  //   - tasks resolved within the trend / timeframe window (for completion
  //     counts and on-time metrics)
  const taskTrendDays = 30;
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const trendStart = startOfDay(addDays(now, -taskTrendDays + 1));
  const resolvedSince =
    timeframeStart && timeframeStart < trendStart ? timeframeStart : trendStart;

  const ADMIN_TASK_PROJECTION =
    'status dueAt dueAtOverride snoozedUntil completedAt dismissedAt createdAt updatedAt referralId ruleKey cycleKey';

  const [openTasks, resolvedTasks] = await Promise.all([
    AdminTask.find({ status: 'open' })
      .select(ADMIN_TASK_PROJECTION)
      .lean<AdminTaskLean[]>(),
    AdminTask.find({
      status: { $in: ['completed', 'dismissed'] },
      $or: [
        { completedAt: { $gte: resolvedSince } },
        { dismissedAt: { $gte: resolvedSince } },
      ],
    })
      .select(ADMIN_TASK_PROJECTION)
      .lean<AdminTaskLean[]>(),
  ]);
  const adminTasks: AdminTaskLean[] = [...openTasks, ...resolvedTasks];

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
    const at = getTaskResolvedAt(task);
    if (!at) return false;
    if (timeframeStart && at < timeframeStart) return false;
    if (timeframeEnd && at > timeframeEnd) return false;
    return true;
  }).length;

  const resolvedTasksInTimeframe = adminTasks.filter((task) => {
    const resolvedAt = getTaskResolvedAt(task);
    if (!resolvedAt) return false;
    if (timeframeStart && resolvedAt < timeframeStart) return false;
    if (timeframeEnd && resolvedAt > timeframeEnd) return false;
    return true;
  });

  const resolvedTasksWithDueDateInTimeframe = resolvedTasksInTimeframe.filter(
    (task) => getEffectiveDueDate(task, getTaskResolvedAt(task) ?? now) != null
  );

  const onTimeTaskCompletionCount = resolvedTasksWithDueDateInTimeframe.filter(
    (task) => wasTaskResolvedOnOrBeforeDueDate(task) === true
  ).length;
  const onTimeTaskCompletionSampleSize = resolvedTasksWithDueDateInTimeframe.length;

  // 30-day task activity trend: one point per day (taskTrendDays / trendStart
  // declared above so they can floor the AdminTask fetch window).
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

  const openTaskReferralIds = new Set(
    openTasks
      .map((task) => task.referralId?.toString())
      .filter((id): id is string => Boolean(id))
  );
  const noOpenTaskReferrals = referralsByNetwork
    .filter((referral) => {
      const normalizedStatus = normalizeStatusKey(referral.status ?? '');
      if (normalizedStatus === 'closed' || normalizedStatus === 'lost') return false;
      return !openTaskReferralIds.has(referral._id.toString());
    })
    .map((referral) => {
      const agentId = referral.assignedAgent?.toString() ?? null;
      const mcId = referral.lender?.toString() ?? null;
      const lastActivityAt = referral.updatedAt ?? referral.referralDate ?? referral.createdAt;
      return {
        id: referral._id.toString(),
        borrowerName: referral.borrower?.name ?? 'Unknown',
        status: referral.status ?? 'New Lead',
        agentName: agentId ? (agentNameMap.get(agentId) ?? null) : null,
        mcName: mcId ? (lenderNameMap.get(mcId) ?? null) : null,
        lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null
      };
    })
    .sort((a, b) => {
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 10);

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
  const agitPercentage = safePercent(agitReferrals.length, filteredReferrals.length);

  const agitFilteredPayments = filteredPaymentsByNetwork.filter((payment) =>
    agitReferralIds.has(payment.referral._id.toString())
  );

  // Lost referrals (status === 'Lost')
  const agitLostReferrals = agitReferrals.filter(
    (referral) => normalizeStatusKey(referral.status ?? '') === 'lost'
  ).length;

  // C-6: mirror Main dashboard's isClosedDealEligible (which additionally
  // excludes payments where usedAssignedAgent === false).
  const agitDealsClosed = agitFilteredPayments.filter((payment) => isClosedDealEligible(payment))
    .length;

  const agitCloseRate = computeCohortCloseRate(agitDealsClosed, agitReferrals.length);

  // Used AFC / AFC Attach Rate
  const agitClosedOrPaidPayments = agitFilteredPayments.filter(
    (payment) =>
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent !== false &&
      CLOSED_DEAL_STATUSES.has(payment.status) &&
      resolveDealSideForMetrics(
        payment.side,
        payment.referral?.dealSide,
        payment.referral?.clientType ?? null
      ) === 'buy'
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
      usedAfc: payment.usedAfc ?? null,
      referralStatus: payment.referral?.status ?? null,
      usedAssignedAgent: payment.usedAssignedAgent ?? null,
      agentAttribution: payment.agentAttribution ?? null
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
      const anchor = getReferralTimeframeAnchor(r);
      if (!anchor) return false;
      return anchor >= previousStart && anchor <= previousEnd;
    });
    const prevReferralIdSet = new Set(prevReferrals.map((r) => r._id.toString()));
    // C-4: cohort-align close rate — prior period's closed-deal count must be
    // referrals that were *created* in the prior window, not payments whose
    // metricDate happens to fall in the prior window.
    const prevCohortDealsClosed = paymentsByNetwork.filter((payment) => {
      if (!isClosedDealEligible(payment)) return false;
      return prevReferralIdSet.has(payment.referral._id.toString());
    });
    const prevDealsClosedByMetricDate = paymentsByNetwork.filter((payment) => {
      const metricDate = payment.metricDate ?? resolveMetricDate(payment);
      if (metricDate < previousStart || metricDate > previousEnd) return false;
      if (!isClosedDealEligible(payment)) return false;
      return true;
    });
    const prevRealized = paymentsByNetwork.reduce((sum, payment) => {
      const receivedDate = resolvePaymentReceivedDate(payment);
      if (!receivedDate) return sum;
      if (receivedDate < previousStart || receivedDate > previousEnd) return sum;
      if (!isRevenueEligiblePayment(payment)) return sum;
      return sum + (payment.receivedAmountCents ?? 0);
    }, 0);
    periodOverPeriod = {
      previous: {
        totalReferrals: prevReferrals.length,
        dealsClosed: prevDealsClosedByMetricDate.length,
        realizedRevenueCents: prevRealized,
        closeRate: computeCohortCloseRate(prevCohortDealsClosed.length, prevReferrals.length)
      },
      current: {
        totalReferrals,
        dealsClosed: dealsClosedForSummary,
        realizedRevenueCents,
        closeRate: cohortCloseRateSummary
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
      funnel: conversionFunnel,
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
        pendingClosingsList,
        pendingClosingsThisMonthList,
        pendingClosingsNextMonthList,
        expectedRevenueFromPendingClosingsCents,
        generatedRevenueList,
        closedNotPaidList,
        dealsClosedList,
        averageDaysClosedToPaidList,
        closeRate: cohortCloseRateSummary,
        revenueRealizationRatePercent:
          realizedRevenueCents + expectedRevenueCents > 0
            ? safePercent(realizedRevenueCents, realizedRevenueCents + expectedRevenueCents)
            : null,
        closedNotPaidPercentOfExpected:
          expectedRevenueCents > 0 ? safePercent(closedNotPaidCents, expectedRevenueCents) : null,
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
      outsideLenderLossLeaderboard: mcOutsideLenderLossLeaderboard,
      requestLeaderboard: mcRequestLeaderboard,
      kpiLeaderboard: { rankedMcs: mcKpiLeaderboard },
      afcRiskCallList: mcAfcRiskCallList,
      stageOnTransferSummary,
      stageOnTransferDrilldown,
      pushbackSummary: {
        distinctDealsPushedBack: mcDistinctDealsPushedBack,
        totalPushbackEvents: mcTotalPushbackEvents,
        // M-15: divide only by events that actually carry measured days.
        averageDaysPushedBackPerEvent:
          mcTotalPushbackEventsWithDays > 0 ? mcTotalPushbackDays / mcTotalPushbackEventsWithDays : 0,
        pushbackRatePercent:
          mcEligibleDealsForPushbackInScope > 0
            ? (mcDistinctDealsPushedBack / mcEligibleDealsForPushbackInScope) * 100
            : 0,
        byMc: Array.from(mcPushbackStatsMap.entries())
          .filter(([id, stats]) => id !== 'unassigned' && stats.dealsWithPushback > 0 && isMcIncludedInLeaderboards(id))
          .map(([id, stats]) => {
            const totalDeals = mcEligibleDealsForPushbackRateMap.get(id) ?? 0;
            const pushbackRatePercent =
              totalDeals > 0 ? (stats.dealsWithPushback / totalDeals) * 100 : 0;
            return {
              id,
              name: lenderNameMap.get(id) ?? 'Unknown MC',
              dealsPushedBack: stats.dealsWithPushback,
              totalDeals,
              pushbackRatePercent
            };
          })
          .sort(
            (a, b) =>
              b.dealsPushedBack - a.dealsPushedBack ||
              b.pushbackRatePercent - a.pushbackRatePercent ||
              a.name.localeCompare(b.name) ||
              a.id.localeCompare(b.id)
          )
      }
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
      onTimeTaskCompletionCount,
      onTimeTaskCompletionSampleSize,
      totalOpenTasks,
      taskActivityTrend,
      stalePipelineCount: staleReferrals.length,
      stalePipelineList,
      noOpenTaskReferrals
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

  const durationMs = Date.now() - requestStartedAt;
  const response = NextResponse.json(responsePayload);
  response.headers.set('server-timing', `dashboard;dur=${durationMs}`);
  if (durationMs > 5_000) {
    console.warn(
      `[dashboard] slow response: ${durationMs}ms role=${role ?? 'unknown'} timeframe=${timeframe.key} network=${context.networkFilter}`
    );
  }
  return response;
}
