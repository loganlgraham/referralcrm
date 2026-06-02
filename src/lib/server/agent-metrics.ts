import { differenceInCalendarDays } from 'date-fns';
import { subDays, subYears } from 'date-fns';
import { Types } from 'mongoose';

import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { computeCohortCloseRate } from '@/lib/server/dashboard-math';

function resolvePaymentMetricDate(payment: PaymentWithReferral): Date {
  if (payment.closingDate) {
    return new Date(payment.closingDate);
  }
  if (payment.referral?.sla?.lastClosedAt) {
    return new Date(payment.referral.sla.lastClosedAt);
  }
  if (payment.status === 'paid' && payment.paidDate) {
    return new Date(payment.paidDate);
  }
  if (payment.invoiceDate) {
    return new Date(payment.invoiceDate);
  }
  return new Date(payment.updatedAt ?? payment.createdAt ?? new Date());
}

const ACTIVE_PIPELINE_STATUSES = new Set([
  'Paired',
  'In Communication',
  'Active Lead',
  'Showing Homes',
  'Under Contract',
]);
const CLOSED_DEAL_STATUSES = new Set(['closed', 'payment_sent', 'paid']);

export interface AgentMetricsSummary {
  closingsLast12Months: number;
  closingRate: number;
  avgResponseHours: number | null;
  npsScore: number | null;
  totalReferralFeesPaidCents: number;
  totalNetIncomeCents: number;
  totalReferrals: number;
  activePipeline: number;
  averageReferralFeePaidCents: number | null;
  averageCommissionPercent: number | null;
  referralsLast30Days: number;
  firstContactWithin24HoursRate: number | null;
  dealsClosedAllTime: number;
  averageDaysClosedToPaid: number | null;
  averageDaysPairedToUnderContract: number | null;
  averageDaysUnderContractToClosed: number | null;
}

type ReferralLean = {
  _id: Types.ObjectId;
  assignedAgent?: Types.ObjectId | null;
  buySideAgent?: Types.ObjectId | null;
  sellSideAgent?: Types.ObjectId | null;
  status?: string | null;
  statusLastUpdated?: Date | null;
  sla?: {
    timeToFirstAgentContactHours?: number | null;
    daysToClose?: number | null;
    closedToPaidMinutes?: number | null;
    previousClosedToPaidMinutes?: number | null;
    lastPairedAt?: Date | string | null;
    lastUnderContractAt?: Date | string | null;
    lastClosedAt?: Date | string | null;
  } | null;
  commissionBasisPoints?: number | null;
  referralFeeDueCents?: number | null;
  closedPriceCents?: number | null;
  estPurchasePriceCents?: number | null;
  createdAt?: Date | null;
};

type PaymentWithReferral = {
  _id: Types.ObjectId;
  agentId?: Types.ObjectId | null;
  agentAttribution?: 'AHA' | 'AHA_OOS' | 'OUTSIDE_AGENT' | null;
  side?: 'buy' | 'sell' | null;
  status: string;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  commissionFlatFeeCents?: number | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  contractPriceCents?: number | null;
  paidDate?: Date | null;
  invoiceDate?: Date | null;
  closingDate?: Date | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
  usedAssignedAgent?: boolean | null;
  referral: ReferralLean;
};

const toObjectIdString = (value: Types.ObjectId | string | null | undefined): string | null => {
  if (!value) return null;
  return typeof value === 'string' ? value : value.toString();
};

const resolveAttachedAgentIds = (referral: ReferralLean): string[] => {
  const ids = [
    toObjectIdString(referral.assignedAgent),
    toObjectIdString(referral.buySideAgent),
    toObjectIdString(referral.sellSideAgent),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(ids));
};

export const resolvePaymentAgentIdForMetrics = (payment: {
  agentId?: Types.ObjectId | string | null;
  side?: 'buy' | 'sell' | null;
  referral?: {
    assignedAgent?: Types.ObjectId | string | null;
    buySideAgent?: Types.ObjectId | string | null;
    sellSideAgent?: Types.ObjectId | string | null;
  } | null;
}): string | null => {
  const explicitAgentId = toObjectIdString(payment.agentId);
  if (explicitAgentId) {
    return explicitAgentId;
  }

  const referral = payment.referral;
  if (!referral) {
    return null;
  }

  if (payment.side === 'sell') {
    return toObjectIdString(referral.sellSideAgent) ?? toObjectIdString(referral.assignedAgent);
  }

  if (payment.side === 'buy') {
    return toObjectIdString(referral.buySideAgent) ?? toObjectIdString(referral.assignedAgent);
  }

  return (
    toObjectIdString(referral.assignedAgent) ??
    toObjectIdString(referral.buySideAgent) ??
    toObjectIdString(referral.sellSideAgent)
  );
};

const isClosedDealEligible = (payment: PaymentWithReferral): boolean =>
  CLOSED_DEAL_STATUSES.has(payment.status) &&
  payment.agentAttribution !== 'OUTSIDE_AGENT' &&
  payment.usedAssignedAgent !== false;

export const EMPTY_AGENT_METRICS: AgentMetricsSummary = {
  closingsLast12Months: 0,
  closingRate: 0,
  avgResponseHours: null,
  npsScore: null,
  totalReferralFeesPaidCents: 0,
  totalNetIncomeCents: 0,
  totalReferrals: 0,
  activePipeline: 0,
  averageReferralFeePaidCents: null,
  averageCommissionPercent: null,
  referralsLast30Days: 0,
  firstContactWithin24HoursRate: null,
  dealsClosedAllTime: 0,
  averageDaysClosedToPaid: null,
  averageDaysPairedToUnderContract: null,
  averageDaysUnderContractToClosed: null
};

export async function computeAgentMetrics(
  agentIds: Types.ObjectId[],
  agentNpsScores?: Map<string, number | null>
): Promise<Map<string, AgentMetricsSummary>> {
  if (!agentIds.length) {
    return new Map();
  }

  const [referrals, payments] = await Promise.all([
    Referral.find({
      $or: [
        { assignedAgent: { $in: agentIds } },
        { buySideAgent: { $in: agentIds } },
        { sellSideAgent: { $in: agentIds } },
      ],
      deletedAt: null
    })
      .select(
        'assignedAgent buySideAgent sellSideAgent status statusLastUpdated sla commissionBasisPoints referralFeeDueCents closedPriceCents estPurchasePriceCents createdAt'
      )
      .lean<ReferralLean[]>(),
    Payment.aggregate<PaymentWithReferral>([
      {
        $match: {
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
          $or: [
            { 'referral.assignedAgent': { $in: agentIds } },
            { 'referral.buySideAgent': { $in: agentIds } },
            { 'referral.sellSideAgent': { $in: agentIds } },
            { agentId: { $in: agentIds } },
          ],
        }
      },
      {
        $project: {
          _id: 1,
          agentId: 1,
          agentAttribution: 1,
          side: 1,
          status: 1,
          expectedAmountCents: 1,
          receivedAmountCents: 1,
          commissionFlatFeeCents: 1,
          commissionBasisPoints: 1,
          referralFeeBasisPoints: 1,
          contractPriceCents: 1,
          paidDate: 1,
          invoiceDate: 1,
          closingDate: 1,
          updatedAt: 1,
          createdAt: 1,
          usedAssignedAgent: 1,
          referral: {
            _id: '$referral._id',
            assignedAgent: '$referral.assignedAgent',
            buySideAgent: '$referral.buySideAgent',
            sellSideAgent: '$referral.sellSideAgent',
            status: '$referral.status',
            statusLastUpdated: '$referral.statusLastUpdated',
            sla: '$referral.sla',
            commissionBasisPoints: '$referral.commissionBasisPoints',
            referralFeeDueCents: '$referral.referralFeeDueCents',
            closedPriceCents: '$referral.closedPriceCents',
            estPurchasePriceCents: '$referral.estPurchasePriceCents',
            createdAt: '$referral.createdAt'
          }
        }
      }
    ])
  ]);

  const referralMap = new Map<string, ReferralLean[]>();
  referrals.forEach((referral) => {
    resolveAttachedAgentIds(referral).forEach((agentId) => {
      const bucket = referralMap.get(agentId) ?? [];
      bucket.push(referral);
      referralMap.set(agentId, bucket);
    });
  });

  const paymentMap = new Map<string, PaymentWithReferral[]>();
  payments.forEach((payment) => {
    const agentId = resolvePaymentAgentIdForMetrics(payment);
    if (!agentId || !agentIds.some((candidate) => candidate.toString() === agentId)) return;
    const bucket = paymentMap.get(agentId) ?? [];
    bucket.push(payment);
    paymentMap.set(agentId, bucket);
  });

  const lastYear = subYears(new Date(), 1);
  const last30Days = subDays(new Date(), 30);

  const metricsByAgent = new Map<string, AgentMetricsSummary>();

  agentIds.forEach((agentId) => {
    const id = agentId.toString();
    const agentReferrals = referralMap.get(id) ?? [];
    const agentPayments = paymentMap.get(id) ?? [];

    if (!agentReferrals.length && !agentPayments.length) {
      const npsScore = agentNpsScores?.get(id) ?? null;
      metricsByAgent.set(id, { ...EMPTY_AGENT_METRICS, npsScore });
      return;
    }

    const totalReferrals = agentReferrals.length;
    const activePipeline = agentReferrals.filter(
      (referral) => ACTIVE_PIPELINE_STATUSES.has((referral.status ?? '').trim())
    ).length;

    const referralsLast30Days = agentReferrals.filter((referral) => {
      if (!referral.createdAt) return false;
      return referral.createdAt >= last30Days;
    }).length;

    const responseSamples = agentReferrals
      .map((referral) => referral.sla?.timeToFirstAgentContactHours ?? null)
      .filter((value): value is number => value != null);
    const avgResponseHours = responseSamples.length
      ? responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length
      : null;

    const firstContactWithin24hCount = responseSamples.filter((value) => value <= 24).length;
    const firstContactWithin24HoursRate = responseSamples.length
      ? (firstContactWithin24hCount / responseSamples.length) * 100
      : null;

    const closedPayments = agentPayments.filter(isClosedDealEligible);

    const dealsClosedAllTime = closedPayments.length;

    const closedReferralIds = new Set(closedPayments.map((payment) => payment.referral._id.toString()));
    const closingRate = computeCohortCloseRate(closedReferralIds.size, totalReferrals);

    let closingsLast12Months = 0;
    let totalReferralFeesPaidCents = 0;
    let totalNetIncomeCents = 0;
    let referralFeesSamples = 0;
    let referralFeesSum = 0;
    let commissionPercentSamples = 0;
    let commissionPercentSum = 0;

    closedPayments.forEach((payment) => {
      const metricDate = resolvePaymentMetricDate(payment);
      if (metricDate >= lastYear) {
        closingsLast12Months += 1;
      }

      const referral = payment.referral ?? ({} as ReferralLean);
      const referralFeePaid = payment.receivedAmountCents ?? referral.referralFeeDueCents ?? 0;
      if (payment.status === 'paid') {
        totalReferralFeesPaidCents += referralFeePaid;
        referralFeesSum += referralFeePaid;
        referralFeesSamples += 1;
      }

      const flatFeeCents = payment.commissionFlatFeeCents ?? 0;
      const priceCents =
        payment.contractPriceCents && payment.contractPriceCents > 0
          ? payment.contractPriceCents
          : referral.closedPriceCents && referral.closedPriceCents > 0
            ? referral.closedPriceCents
            : referral.estPurchasePriceCents ?? 0;
      let commissionCents = 0;
      let commissionPercent = 0;
      if (flatFeeCents > 0) {
        commissionCents = flatFeeCents;
        commissionPercent = priceCents > 0 ? (flatFeeCents / priceCents) * 100 : 0;
      } else {
        const commissionBasisPoints =
          (payment.commissionBasisPoints ?? 0) > 0
            ? payment.commissionBasisPoints!
            : (referral.commissionBasisPoints ?? 0) > 0
              ? referral.commissionBasisPoints!
              : DEFAULT_AGENT_COMMISSION_BPS;
        commissionCents = Math.round((priceCents * commissionBasisPoints) / 10000);
        commissionPercent = commissionBasisPoints / 100;
      }

      if (commissionPercent > 0) {
        commissionPercentSum += commissionPercent;
        commissionPercentSamples += 1;
      }

      if (payment.status === 'paid' && commissionCents > 0) {
        totalNetIncomeCents += commissionCents - referralFeePaid;
      }
    });

    const averageReferralFeePaidCents =
      referralFeesSamples > 0 ? Math.round(referralFeesSum / referralFeesSamples) : null;

    const averageCommissionPercent =
      commissionPercentSamples > 0 ? commissionPercentSum / commissionPercentSamples : null;

    // Calculate average days closed to paid (only for paid deals where usedAssignedAgent is true)
    const paidPaymentsWithAgent = agentPayments.filter(
      (payment) =>
        payment.status === 'paid' &&
        payment.usedAssignedAgent === true &&
        payment.agentAttribution !== 'OUTSIDE_AGENT'
    );
    const closedToPaidDays = paidPaymentsWithAgent
      .map((payment) => {
        const end = payment.paidDate ? new Date(payment.paidDate) : null;
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
          const fallbackStart =
            closingDate ?? (payment.invoiceDate ? new Date(payment.invoiceDate) : new Date(payment.updatedAt ?? payment.createdAt ?? new Date()));
          const days = differenceInCalendarDays(end, fallbackStart);
          return days >= 0 ? days : null;
        }

        return null;
      })
      .filter((value): value is number => value != null);
    const averageDaysClosedToPaid =
      closedToPaidDays.length > 0
        ? closedToPaidDays.reduce((sum, value) => sum + value, 0) / closedToPaidDays.length
        : null;

    // Calculate average days paired → under contract
    const pairedToContractDays = agentReferrals
      .map((referral) => {
        const paired = referral.sla?.lastPairedAt;
        const underContract = referral.sla?.lastUnderContractAt;
        if (!paired || !underContract) return null;
        return differenceInCalendarDays(new Date(underContract), new Date(paired));
      })
      .filter((value): value is number => value != null);
    const averageDaysPairedToUnderContract =
      pairedToContractDays.length > 0
        ? pairedToContractDays.reduce((sum, value) => sum + value, 0) / pairedToContractDays.length
        : null;

    // Calculate average days under contract → closed
    const underContractToClosedDays = agentReferrals
      .map((referral) => {
        const underContract = referral.sla?.lastUnderContractAt;
        const closed = referral.sla?.lastClosedAt;
        const daysToClose = referral.sla?.daysToClose;
        if (underContract && closed) {
          return differenceInCalendarDays(new Date(closed), new Date(underContract));
        }
        if (daysToClose != null && daysToClose >= 0) {
          return daysToClose;
        }
        return null;
      })
      .filter((value): value is number => value != null);
    const averageDaysUnderContractToClosed =
      underContractToClosedDays.length > 0
        ? underContractToClosedDays.reduce((sum, value) => sum + value, 0) / underContractToClosedDays.length
        : null;

    const npsScore = agentNpsScores?.get(id) ?? null;

    metricsByAgent.set(id, {
      closingsLast12Months,
      closingRate,
      avgResponseHours,
      npsScore,
      totalReferralFeesPaidCents,
      totalNetIncomeCents,
      totalReferrals,
      activePipeline,
      averageReferralFeePaidCents,
      averageCommissionPercent,
      referralsLast30Days,
      firstContactWithin24HoursRate,
      dealsClosedAllTime,
      averageDaysClosedToPaid,
      averageDaysPairedToUnderContract,
      averageDaysUnderContractToClosed
    });
  });

  return metricsByAgent;
}

