'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Bell, Clock3, MailWarning } from 'lucide-react';

import clsx from 'clsx';
import { type RecommendationPriority } from '@/utils/sla-insights';

export interface SlaAlertApiResponse {
  summary: {
    totalOpen: number;
    urgent: number;
    high: number;
    medium: number;
    low: number;
    lastEvaluatedAt: string | null;
    notifications: {
      inApp: boolean;
      email: {
        enabled: boolean;
        recipients: string[];
        minPriority: RecommendationPriority;
      };
    };
    thresholds: Record<string, unknown>;
    workerIntervalHours: number;
  };
  alerts: {
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
  }[];
}

const priorityBadgeStyles: Record<RecommendationPriority, string> = {
  urgent: 'bg-red-100 text-red-800 border border-red-200',
  high: 'bg-amber-100 text-amber-800 border border-amber-200',
  medium: 'bg-blue-100 text-blue-800 border border-blue-200',
  low: 'bg-slate-100 text-slate-800 border border-slate-200',
};

const priorityLabel: Record<RecommendationPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const formatDueDate = (value?: string | null) => {
  if (!value) return 'No due date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No due date';
  return `${format(parsed, 'MMM d, h:mm a')} (${formatDistanceToNow(parsed, { addSuffix: true })})`;
};

export function SlaAlertPanel({ data, isLoading }: { data?: SlaAlertApiResponse; isLoading?: boolean }) {
  const alerts = data?.alerts ?? [];
  const summary = data?.summary;
  const lastRefreshed = summary?.lastEvaluatedAt ? formatDistanceToNow(new Date(summary.lastEvaluatedAt), { addSuffix: true }) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Referral SLA alerts</h3>
          <p className="text-sm text-slate-600">
            Automated evaluation of referral journeys with thresholds for assignment, communication, and closing SLAs.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          {summary?.notifications.email.enabled && (
            <div className="flex items-center gap-2">
              <MailWarning className="h-4 w-4 text-amber-600" />
              <span>Email on {summary.notifications.email.minPriority}+</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            <span>{summary?.workerIntervalHours ?? 24}h cadence</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            { label: 'Urgent', value: summary?.urgent ?? 0, tone: 'text-red-700 bg-red-50' },
            { label: 'High', value: summary?.high ?? 0, tone: 'text-amber-700 bg-amber-50' },
            { label: 'Medium', value: summary?.medium ?? 0, tone: 'text-blue-700 bg-blue-50' },
            { label: 'Total open', value: summary?.totalOpen ?? 0, tone: 'text-slate-700 bg-slate-50' },
          ] as const
        ).map((item) => (
          <div key={item.label} className={clsx('rounded-lg border p-3 shadow-sm', item.tone)}>
            <div className="text-sm font-medium text-slate-600">{item.label}</div>
            <div className="text-2xl font-semibold">{isLoading ? '—' : item.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <AlertTriangle className="h-4 w-4" />
            Open alerts
          </div>
          <div className="text-xs text-slate-500">{lastRefreshed ? `Last evaluated ${lastRefreshed}` : 'Awaiting first run'}</div>
        </div>

        {isLoading && alerts.length === 0 && <div className="text-sm text-slate-500">Loading SLA alerts…</div>}
        {!isLoading && alerts.length === 0 && <div className="text-sm text-slate-500">No open SLA alerts 🎉</div>}

        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', priorityBadgeStyles[alert.priority])}>
                      {priorityLabel[alert.priority]}
                    </span>
                    {alert.category && <span className="text-xs uppercase text-slate-500">{alert.category}</span>}
                  </div>
                  <div className="text-sm font-semibold text-slate-800">{alert.title}</div>
                  <p className="text-sm text-slate-600">{alert.message}</p>
                  {alert.supportingMetric && (
                    <p className="text-xs font-medium text-slate-500">{alert.supportingMetric}</p>
                  )}
                </div>
                <div className="text-right text-xs text-slate-500">
                  {alert.referralStatus && <div className="font-semibold text-slate-700">Status: {alert.referralStatus}</div>}
                  {alert.borrowerName && <div>Borrower: {alert.borrowerName}</div>}
                  {alert.assignedAgentName && <div>Agent: {alert.assignedAgentName}</div>}
                  {alert.lenderName && <div>Lender: {alert.lenderName}</div>}
                  {alert.lookingInZip && <div>Market: {alert.lookingInZip}</div>}
                  {alert.detectedAt && <div>Detected {formatDistanceToNow(new Date(alert.detectedAt), { addSuffix: true })}</div>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <div className="flex items-center gap-1">
                  <Bell className="h-3.5 w-3.5" />
                  {formatDueDate(alert.dueAt)}
                </div>
                {alert.statusAge && <div className="flex items-center gap-1 text-slate-500">Updated {alert.statusAge}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
