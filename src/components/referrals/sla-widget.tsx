import { format } from 'date-fns';

import {
  computeSlaInsights,
  sortRecommendations,
  type SlaRecommendation,
} from '@/utils/sla-insights';

const formatDueDate = (dueAt?: string | null) => {
  if (!dueAt) {
    return null;
  }

  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return format(date, "MMM d 'at' h:mmaaa");
};

const badgeStyles: Record<SlaRecommendation['priority'], string> = {
  urgent: 'bg-rose-100 text-rose-700',
  high: 'bg-amber-100 text-amber-700',
  medium: 'bg-indigo-100 text-indigo-700',
  low: 'bg-slate-200 text-slate-600',
};

export function SLAWidget({ referral }: { referral: any }) {
  const { durations, recommendations, riskSummary } = computeSlaInsights(referral);
  const topRecommendations = sortRecommendations(recommendations).slice(0, 3);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Speed to serve</h2>
        <p className="text-xs text-slate-500">
          Time between key milestones in this referral journey and the AI coach&apos;s next steps.
        </p>
      </div>
      <dl className="space-y-2">
        {durations.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-slate-500">{item.label}</dt>
            <dd className="font-medium text-slate-900">{item.formatted}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-3 space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Proactive SLA coaching</h3>
          <p className="text-xs text-slate-500">
            Recommendations update automatically as this referral progresses.
          </p>
        </div>
        {riskSummary && (
          <div
            className={`mb-3 rounded-md border px-3 py-2 text-xs ${
              riskSummary.level === 'at_risk'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : riskSummary.level === 'watch'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            <p className="font-semibold">{riskSummary.headline}</p>
            <p>{riskSummary.detail}</p>
          </div>
        )}
        {topRecommendations.length > 0 ? (
          <ul className="space-y-3">
            {topRecommendations.map((item) => {
              const dueLabel = formatDueDate(item.dueAt);
              return (
                <li key={item.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeStyles[item.priority]}`}>
                      {item.priority === 'urgent'
                        ? 'Immediate'
                        : item.priority === 'high'
                        ? 'High'
                        : item.priority === 'medium'
                        ? 'Medium'
                        : 'Low'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{item.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    {item.supportingMetric && <span>{item.supportingMetric}</span>}
                    {dueLabel && <span>Suggested by {dueLabel}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-emerald-600">All SLA checkpoints look great. No follow-ups needed right now.</p>
        )}
      </div>
    </div>
  );
}
