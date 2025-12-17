import 'dotenv/config';

import { format } from 'date-fns';
import mongoose, { type FilterQuery, Types } from 'mongoose';

import { connectMongo } from '../src/lib/mongoose';
import { Referral, type ReferralDocument } from '../src/models/referral';
import { Payment } from '../src/models/payment';
import { SlaAlert, type SlaAlertDocument } from '../src/models/sla-alert';
import { SLA_ALERT_CONFIG, SLA_ALERT_PRIORITY_WEIGHT } from '../src/config/sla-alerts';
import {
  computeSlaInsights,
  resolvePrimaryAgentName,
  sortRecommendations,
  type RecommendationPriority,
  type ReferralLike,
} from '../src/utils/sla-insights';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '../src/lib/email';

const PRIORITY_LABEL: Record<RecommendationPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const OPEN_ALERT_FILTER: FilterQuery<SlaAlertDocument> = {
  $or: [{ status: 'open' }, { status: { $exists: false } }],
};

const shouldEmailPriority = (priority: RecommendationPriority): boolean => {
  const minPriority = SLA_ALERT_CONFIG.notifications.email.minPriority || 'high';
  return SLA_ALERT_PRIORITY_WEIGHT[priority] <= SLA_ALERT_PRIORITY_WEIGHT[minPriority];
};

const buildPaymentsByReferral = async () => {
  const payments = await Payment.find({})
    .select('referralId status createdAt updatedAt paidDate invoiceDate closingDate terminatedReason')
    .lean();

  return payments.reduce<Record<string, any[]>>((acc, payment) => {
    if (!payment.referralId) return acc;
    const key = (payment.referralId as Types.ObjectId).toString();
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

const resolveBorrowerName = (referral: ReferralDocument): string => {
  return referral.borrower?.name ?? `${referral.borrower?.firstName ?? ''} ${referral.borrower?.lastName ?? ''}`.trim();
};

const upsertSlaAlert = async (
  referral: ReferralDocument,
  recommendation: ReturnType<typeof sortRecommendations>[number],
  evaluatedAt: Date
) => {
  const query = { referralId: referral._id, recommendationId: recommendation.id };
  const existing = await SlaAlert.findOne(query).lean<SlaAlertDocument | null>();

  const dueAt = recommendation.dueAt ? new Date(recommendation.dueAt) : null;
  const update = {
    title: recommendation.title,
    message: recommendation.message,
    priority: recommendation.priority,
    category: recommendation.category,
    supportingMetric: recommendation.supportingMetric ?? null,
    dueAt,
    status: 'open',
    lastEvaluatedAt: evaluatedAt,
    referralSnapshot: {
      borrowerName: resolveBorrowerName(referral),
      referralStatus: referral.status,
      org: referral.org ?? null,
      ahaBucket: referral.ahaBucket ?? null,
      assignedAgentName: resolvePrimaryAgentName(referral as unknown as ReferralLike) ?? null,
      lenderName: (referral as any).lender?.name ?? null,
      lookingInZip: referral.lookingInZip ?? null,
    },
  };

  const alert = await SlaAlert.findOneAndUpdate(
    query,
    {
      $set: update,
      $setOnInsert: {
        firstDetectedAt: evaluatedAt,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<SlaAlertDocument | null>();

  const wasNew = !existing;
  const priorityRaised =
    existing && SLA_ALERT_PRIORITY_WEIGHT[recommendation.priority] < SLA_ALERT_PRIORITY_WEIGHT[existing.priority as RecommendationPriority];
  const notify =
    SLA_ALERT_CONFIG.notifications.email.enabled &&
    SLA_ALERT_CONFIG.notifications.email.recipients.length > 0 &&
    (wasNew || priorityRaised) &&
    shouldEmailPriority(recommendation.priority);

  return { alert, notify } as const;
};

const resolveEmailBody = (alerts: { title: string; priority: RecommendationPriority; message: string; borrower?: string }[]) => {
  const lines = alerts.map((item) => {
    const borrowerLabel = item.borrower ? ` (${item.borrower})` : '';
    return `• [${PRIORITY_LABEL[item.priority]}] ${item.title}${borrowerLabel}: ${item.message}`;
  });

  return lines.join('\n');
};

async function evaluateSlaAlerts() {
  const evaluatedAt = new Date();
  await connectMongo();

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

  const emailCandidates: { title: string; priority: RecommendationPriority; message: string; borrower?: string }[] = [];

  for (const referral of referrals) {
    const referralId = referral._id.toString();
    const payments = paymentsByReferral[referralId] ?? [];
    const insights = computeSlaInsights({ ...(referral as unknown as ReferralLike), payments });
    const recommendations = sortRecommendations(insights.recommendations);

    const activeRecommendationIds = new Set<string>();

    for (const rec of recommendations) {
      const { alert, notify } = await upsertSlaAlert(referral as ReferralDocument, rec, evaluatedAt);
      if (notify && alert) {
        emailCandidates.push({
          title: alert.title,
          priority: alert.priority,
          message: alert.message,
          borrower: alert.referralSnapshot?.borrowerName ?? resolveBorrowerName(referral as ReferralDocument),
        });
        await SlaAlert.updateOne({ _id: alert._id }, { $set: { lastNotifiedAt: evaluatedAt } });
      }
      activeRecommendationIds.add(rec.id);
    }

    const inactiveFilter = { referralId: new Types.ObjectId(referralId), recommendationId: { $nin: Array.from(activeRecommendationIds) } };
    await SlaAlert.updateMany(inactiveFilter, { $set: { status: 'resolved', resolvedAt: evaluatedAt, lastEvaluatedAt: evaluatedAt } });
  }

  if (
    emailCandidates.length > 0 &&
    SLA_ALERT_CONFIG.notifications.email.enabled &&
    SLA_ALERT_CONFIG.notifications.email.recipients.length > 0 &&
    isTransactionalEmailConfigured()
  ) {
    const subject = `Referral SLA alerts (${emailCandidates.length}) - ${format(evaluatedAt, 'MMM d')}`;
    const html = `<p>The following SLA alerts were created or escalated:</p><ul>${emailCandidates
      .map(
        (item) =>
          `<li><strong>[${PRIORITY_LABEL[item.priority]}]</strong> ${item.title}${
            item.borrower ? ` (${item.borrower})` : ''
          }: ${item.message}</li>`
      )
      .join('')}</ul>`;
    const text = `The following SLA alerts were created or escalated:\n${resolveEmailBody(emailCandidates)}`;

    await sendTransactionalEmail({
      to: SLA_ALERT_CONFIG.notifications.email.recipients,
      subject,
      html,
      text,
    });
  }

  const openCount = await SlaAlert.countDocuments(OPEN_ALERT_FILTER);
  const totalCount = await SlaAlert.countDocuments({});

  console.log(`Evaluated ${referrals.length} referrals. Open alerts: ${openCount}/${totalCount}.`);
}

async function start() {
  await evaluateSlaAlerts();

  if (!SLA_ALERT_CONFIG.worker.runContinuously) {
    await mongoose.connection.close();
    process.exit(0);
  }

  const intervalMs = Math.max(1, SLA_ALERT_CONFIG.worker.intervalHours) * 60 * 60 * 1000;
  console.log(`Scheduling recurring SLA alert evaluation every ${SLA_ALERT_CONFIG.worker.intervalHours} hours.`);
  setInterval(() => {
    void evaluateSlaAlerts().catch((error) => console.error('SLA alert worker run failed', error));
  }, intervalMs);
}

start().catch((error) => {
  console.error('Failed to start SLA alert worker', error);
  process.exit(1);
});
