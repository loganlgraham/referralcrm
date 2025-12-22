import { NextResponse } from 'next/server';
import { formatDistanceToNow } from 'date-fns';

import { SLA_ALERT_CONFIG, SLA_ALERT_PRIORITY_WEIGHT } from '@/config/sla-alerts';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { SlaAlert, type SlaAlertDocument } from '@/models/sla-alert';
import { type RecommendationPriority } from '@/utils/sla-insights';

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

const formatIso = (value?: Date | null) => (value ? value.toISOString() : null);

const sortByPriority = <T extends { priority: RecommendationPriority; dueAt?: Date | null }>(
  items: T[]
): T[] => {
  return [...items].sort((a, b) => {
    const priorityDiff = SLA_ALERT_PRIORITY_WEIGHT[a.priority] - SLA_ALERT_PRIORITY_WEIGHT[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const aDue = a.dueAt ? a.dueAt.getTime() : Infinity;
    const bDue = b.dueAt ? b.dueAt.getTime() : Infinity;
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

  const ordered = sortByPriority(alerts);

  const summary = summaryStats.reduce(
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
      lastEvaluatedAt: null as number | null,
    }
  );

  const response: { summary: any; alerts: ApiAlert[] } = {
    summary: {
      totalOpen: summary.totalOpen,
      urgent: summary.urgent,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      lastEvaluatedAt: summary.lastEvaluatedAt ? new Date(summary.lastEvaluatedAt).toISOString() : null,
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
    alerts: ordered.map<ApiAlert>((alert) => ({
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
      statusAge: alert.lastEvaluatedAt
        ? formatDistanceToNow(alert.lastEvaluatedAt, { addSuffix: true })
        : null,
    })),
  };

  return NextResponse.json(response);
}
