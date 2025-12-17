import { NextResponse } from 'next/server';
import { formatDistanceToNow } from 'date-fns';

import { SLA_ALERT_CONFIG, SLA_ALERT_PRIORITY_WEIGHT } from '@/config/sla-alerts';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral, type ReferralDocument } from '@/models/referral';
import { SlaAlert, type SlaAlertDocument } from '@/models/sla-alert';
import {
  computeSlaInsights,
  resolvePrimaryAgentName,
  sortRecommendations,
  type RecommendationPriority,
  type ReferralLike,
} from '@/utils/sla-insights';

interface ApiAlert {
  id: string;
  referralId: string;
  borrowerName?: string | null;
  referralStatus?: string | null;
  priority: RecommendationPriority;
  title: string;
  message: string;
  category: string;
  supportingMetric?: string | null;
  dueAt?: string | null;
  detectedAt?: string | null;
  lastEvaluatedAt?: string | null;
  ahaBucket?: string | null;
  org?: string | null;
  assignedAgentName?: string | null;
  lenderName?: string | null;
  lookingInZip?: string | null;
  statusAge?: string | null;
}

type SummaryPayload = {
  totalOpen: number;
  urgent: number;
  high: number;
  medium: number;
  low: number;
  lastEvaluatedAt: number | null;
};

const formatIso = (value?: Date | null) => (value ? value.toISOString() : null);

const resolveBorrowerName = (referral: ReferralDocument): string => {
  return (
    referral.borrower?.name ?? `${referral.borrower?.firstName ?? ''} ${referral.borrower?.lastName ?? ''}`.trim()
  );
};

const buildPaymentsByReferral = async () => {
  const payments = await Payment.find({})
    .select('referralId status createdAt updatedAt paidDate invoiceDate closingDate terminatedReason')
    .lean();

  return payments.reduce<Record<string, any[]>>((acc, payment) => {
    if (!payment.referralId) return acc;
    const key = payment.referralId.toString();
    acc[key] = acc[key] ?? [];
    acc[key].push({
      status: payment.status,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      paidDate: payment.paidDate ?? payment.invoiceDate,
      closedDate: payment.closingDate,
      terminatedReason: payment.terminatedReason,
    });
    return acc;
  }, {});
};

const buildAlertsOnDemand = async () => {
  const evaluatedAt = new Date();

  const [referrals, paymentsByReferral] = await Promise.all([
    Referral.find<ReferralDocument>({ deletedAt: null })
      .select(
        'borrower status statusLastUpdated clientType dealSide stageOnTransfer assignedAgent buySideAgent sellSideAgent lender origin audit notes sla ahaBucket org lookingInZip createdAt'
      )
      .populate([
        { path: 'assignedAgent', select: 'name fullName' },
        { path: 'buySideAgent', select: 'name fullName' },
        { path: 'sellSideAgent', select: 'name fullName' },
        { path: 'lender', select: 'name' },
      ])
      .lean<ReferralDocument[]>(),
    buildPaymentsByReferral(),
  ]);

  const summary = {
    totalOpen: 0,
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0,
    lastEvaluatedAt: evaluatedAt.getTime(),
  };

  const alerts: ApiAlert[] = [];

  for (const referral of referrals) {
    const referralId = referral._id.toString();
    const payments = paymentsByReferral[referralId] ?? [];
    const insights = computeSlaInsights({ ...(referral as unknown as ReferralLike), payments });
    const recommendations = sortRecommendations(insights.recommendations);

    for (const rec of recommendations) {
      summary.totalOpen += 1;
      summary[rec.priority] += 1;

      alerts.push({
        id: `${referralId}:${rec.id}`,
        referralId,
        borrowerName: resolveBorrowerName(referral),
        referralStatus: referral.status,
        priority: rec.priority,
        title: rec.title,
        message: rec.message,
        category: rec.category,
        supportingMetric: rec.supportingMetric ?? null,
        dueAt: formatIso(rec.dueAt ? new Date(rec.dueAt) : null),
        detectedAt: evaluatedAt.toISOString(),
        lastEvaluatedAt: evaluatedAt.toISOString(),
        ahaBucket: referral.ahaBucket ?? null,
        org: referral.org ?? null,
        assignedAgentName: resolvePrimaryAgentName(referral as unknown as ReferralLike) ?? null,
        lenderName: (referral as any).lender?.name ?? null,
        lookingInZip: referral.lookingInZip ?? null,
        statusAge: referral.statusLastUpdated
          ? formatDistanceToNow(new Date(referral.statusLastUpdated), { addSuffix: true })
          : null,
      });
    }
  }

  const ordered = sortByPriority(alerts);

  return { alerts: ordered, summary } as const;
};

const sortByPriority = <T extends { priority: RecommendationPriority; dueAt?: Date | string | null }>(
  items: T[]
): T[] => {
  const asEpoch = (value?: Date | string | null) => {
    if (!value) return Infinity;
    const normalized = typeof value === 'string' ? new Date(value) : value;
    const epoch = normalized.getTime();
    return Number.isNaN(epoch) ? Infinity : epoch;
  };

  return [...items].sort((a, b) => {
    const priorityDiff = SLA_ALERT_PRIORITY_WEIGHT[a.priority] - SLA_ALERT_PRIORITY_WEIGHT[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const aDue = asEpoch(a.dueAt);
    const bDue = asEpoch(b.dueAt);
    return aDue - bDue;
  });
};

export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
  }

  await connectMongo();

  const openFilter = { $or: [{ status: 'open' }, { status: null }, { status: { $exists: false } }] };

  const [alerts, summaryStats] = await Promise.all([
    SlaAlert.find(openFilter)
      .sort({ priority: 1, dueAt: 1, createdAt: -1 })
      .limit(50)
      .lean<SlaAlertDocument[]>(),
    SlaAlert.aggregate<{
      _id: RecommendationPriority;
      count: number;
      lastEvaluatedAt?: Date | null;
    }>([
      { $match: openFilter },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 },
          lastEvaluatedAt: { $max: '$lastEvaluatedAt' },
        },
      },
    ]),
  ]);

  const hasStoredAlerts = alerts.length > 0 || summaryStats.length > 0;

  const summary = hasStoredAlerts
    ? summaryStats.reduce<SummaryPayload>(
        (acc, item) => {
          acc.totalOpen += item.count;
          acc[item._id] = item.count;
          acc.lastEvaluatedAt = acc.lastEvaluatedAt
            ? Math.max(acc.lastEvaluatedAt, item.lastEvaluatedAt?.getTime() ?? 0)
            : item.lastEvaluatedAt?.getTime() ?? null;
          return acc;
        },
        {
          totalOpen: 0,
          urgent: 0,
          high: 0,
          medium: 0,
          low: 0,
          lastEvaluatedAt: null,
        }
      )
    : null;

  let alertList: ApiAlert[] = [];
  let summaryPayload: SummaryPayload | null = summary;

  if (hasStoredAlerts) {
    alertList = sortByPriority(alerts).map<ApiAlert>((alert) => ({
      id: alert._id.toString(),
      referralId: alert.referralId.toString(),
      borrowerName: alert.referralSnapshot?.borrowerName ?? null,
      referralStatus: alert.referralSnapshot?.referralStatus ?? null,
      priority: alert.priority,
      title: alert.title,
      message: alert.message,
      category: alert.category,
      supportingMetric: alert.supportingMetric ?? null,
      dueAt: formatIso(alert.dueAt),
      detectedAt: formatIso(alert.firstDetectedAt),
      lastEvaluatedAt: formatIso(alert.lastEvaluatedAt),
      ahaBucket: alert.referralSnapshot?.ahaBucket ?? null,
      org: alert.referralSnapshot?.org ?? null,
      assignedAgentName: alert.referralSnapshot?.assignedAgentName ?? null,
      lenderName: alert.referralSnapshot?.lenderName ?? null,
      lookingInZip: alert.referralSnapshot?.lookingInZip ?? null,
      statusAge: alert.lastEvaluatedAt ? formatDistanceToNow(alert.lastEvaluatedAt, { addSuffix: true }) : null,
    }));
  } else {
    const fallback = await buildAlertsOnDemand();
    alertList = fallback.alerts;
    summaryPayload = fallback.summary;
  }

  if (!summaryPayload) {
    const fallback = await buildAlertsOnDemand();
    summaryPayload = fallback.summary;
    if (alertList.length === 0) {
      alertList = fallback.alerts;
    }
  }

  const response: { summary: any; alerts: ApiAlert[] } = {
    summary: {
      totalOpen: summaryPayload.totalOpen,
      urgent: summaryPayload.urgent,
      high: summaryPayload.high,
      medium: summaryPayload.medium,
      low: summaryPayload.low,
      lastEvaluatedAt: summaryPayload.lastEvaluatedAt
        ? new Date(summaryPayload.lastEvaluatedAt).toISOString()
        : null,
      notifications: {
        inApp: SLA_ALERT_CONFIG.notifications.inApp,
        email: {
          enabled: SLA_ALERT_CONFIG.notifications.email.enabled,
          recipients: SLA_ALERT_CONFIG.notifications.email.recipients,
          minPriority: SLA_ALERT_CONFIG.notifications.email.minPriority,
        },
      },
      thresholds: SLA_ALERT_CONFIG.thresholds,
      workerIntervalHours: SLA_ALERT_CONFIG.worker.intervalHours,
    },
    alerts: alertList,
  };

  return NextResponse.json(response);
}
