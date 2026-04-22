import { computeSlaInsights } from '@/utils/sla-insights';

export function SLAWidget({ referral }: { referral: any }) {
  const { durations } = computeSlaInsights(referral);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-muted/50 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Speed to serve</h2>
        <p className="text-xs text-foreground-subtle">
          Time between key milestones in this referral journey and the AI coach&apos;s next steps.
        </p>
      </div>
      <dl className="space-y-2">
        {durations.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-foreground-subtle">{item.label}</dt>
            <dd className="font-medium text-foreground">{item.formatted}</dd>
          </div>
        ))}
      </dl>

    </div>
  );
}
