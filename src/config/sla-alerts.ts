import { type RecommendationPriority, SLA_THRESHOLDS } from '@/utils/sla-insights';

const parseRecipients = (): string[] => {
  const raw = process.env.SLA_ALERT_EMAIL_RECIPIENTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

export const SLA_ALERT_PRIORITY_WEIGHT: Record<RecommendationPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const intervalHours = Number.parseInt(process.env.SLA_ALERT_INTERVAL_HOURS ?? '24', 10);
const graceMinutes = Number.parseInt(process.env.SLA_ALERT_GRACE_MINUTES ?? '5', 10);

export const SLA_ALERT_CONFIG = {
  thresholds: SLA_THRESHOLDS,
  notifications: {
    inApp: process.env.SLA_ALERT_IN_APP_ENABLED !== 'false',
    email: {
      enabled: process.env.SLA_ALERT_EMAIL_ENABLED !== 'false',
      recipients: parseRecipients(),
      minPriority: (process.env.SLA_ALERT_EMAIL_MIN_PRIORITY as RecommendationPriority) ?? 'high',
    },
  },
  worker: {
    runContinuously: process.env.SLA_ALERT_WORKER_CONTINUOUS === 'true',
    intervalHours: Number.isFinite(intervalHours) ? intervalHours : 24,
    graceMinutes: Number.isFinite(graceMinutes) ? graceMinutes : 5,
  },
};
