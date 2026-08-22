import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeSlaInsights } from '@/utils/sla-insights';

export function SLAWidget({ referral }: { referral: any }) {
  const { durations } = computeSlaInsights(referral);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Speed to serve</CardTitle>
        <p className="text-sm text-foreground-muted">
          Time between key milestones in this referral journey and the AI coach&apos;s next steps.
        </p>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2">
          {durations.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <dt className="text-foreground-subtle">{item.label}</dt>
              <dd className="font-medium tabular-nums text-foreground">{item.formatted}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
