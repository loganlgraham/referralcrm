import { subDays, subYears } from 'date-fns';
import { Types } from 'mongoose';

import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

function resolvePaymentMetricDate(payment: any): Date {
  if (payment.status === 'paid' && payment.paidDate) {
    return new Date(payment.paidDate);
  }
  if (payment.invoiceDate) {
    return new Date(payment.invoiceDate);
  }
  return new Date(payment.updatedAt ?? payment.createdAt ?? new Date());
}

const NON_ACTIVE_STATUSES = new Set(['Closed', 'Lost', 'Terminated']);

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
}

type ReferralLean = {
  _id: Types.ObjectId;
  assignedAgent?: Types.ObjectId | null;
  status?: string | null;
  statusLastUpdated?: Date | null;
  sla?: {
    timeToFirstAgentContactHours?: number | null;
    daysToClose?: number | null;
  } | null;
  commissionBasisPoints?: number | null;
  referralFeeDueCents?: number | null;
  closedPriceCents?: number | null;
  estPurchasePriceCents?: number | null;
  createdAt?: Date | null;
};

type PaymentWithReferral = {
  _id: Types.ObjectId;
  status: string;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  paidDate?: Date | null;
  invoiceDate?: Date | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
  referral: ReferralLean;
};

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
  dealsClosedAllTime: 0
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
      assignedAgent: { $in: agentIds },
      deletedAt: null
    })
      .select(
        'assignedAgent status statusLastUpdated sla commissionBasisPoints referralFeeDueCents closedPriceCents estPurchasePriceCents createdAt'
      )
      .lean<ReferralLean[]>(),
    Payment.aggregate<PaymentWithReferral>([
      {
        $match: {
          status: { $in: ['under_contract', 'closed', 'paid'] }
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
          'referral.assignedAgent': { $in: agentIds }
        }
      }
    ])
  ]);

  const referralMap = new Map<string, ReferralLean[]>();
  referrals.forEach((referral) => {
    const agentId = referral.assignedAgent?.toString();
    if (!agentId) return;
    const bucket = referralMap.get(agentId) ?? [];
    bucket.push(referral);
    referralMap.set(agentId, bucket);
  });

  const paymentMap = new Map<string, PaymentWithReferral[]>();
  payments.forEach((payment) => {
    const agentId = payment.referral?.assignedAgent?.toString();
    if (!agentId) return;
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
      (referral) => !NON_ACTIVE_STATUSES.has((referral.status ?? '').trim())
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

    const closedPayments = agentPayments.filter((payment) =>
      ['closed', 'paid'].includes(payment.status)
    );

    const dealsClosedAllTime = closedPayments.length;

    const closingRate = totalReferrals === 0 ? 0 : (dealsClosedAllTime / totalReferrals) * 100;

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

      const commissionBasisPoints = referral.commissionBasisPoints ?? 0;
      const priceCents =
        referral.closedPriceCents && referral.closedPriceCents > 0
          ? referral.closedPriceCents
          : referral.estPurchasePriceCents ?? 0;
      const commissionCents = Math.round((priceCents * commissionBasisPoints) / 10000);

      if (commissionBasisPoints > 0) {
        commissionPercentSum += commissionBasisPoints / 100;
        commissionPercentSamples += 1;
      }

      totalNetIncomeCents += commissionCents - referralFeePaid;
    });

    const averageReferralFeePaidCents =
      referralFeesSamples > 0 ? Math.round(referralFeesSum / referralFeesSamples) : null;

    const averageCommissionPercent =
      commissionPercentSamples > 0 ? commissionPercentSum / commissionPercentSamples : null;

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
      dealsClosedAllTime
    });
  });

  return metricsByAgent;
}

