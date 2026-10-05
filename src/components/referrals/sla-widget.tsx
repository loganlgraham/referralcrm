import { RailCard } from '@/components/referrals/referral-rail';
import { computeSlaInsights } from '@/utils/sla-insights';

export function SLAWidget({ referral }: { referral: any }) {
  const { durations } = computeSlaInsights(referral);

  return (
    <RailCard title="Speed to serve" description="Time between key milestones.">
      <dl className="divide-y divide-border">
        {durations.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
            <dt className="text-foreground-muted">{item.label}</dt>
            <dd className="text-numeric font-semibold text-foreground">{item.formatted}</dd>
          </div>
        ))}
      </dl>
    </RailCard>
  );
}
