'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatInTimeZone } from 'date-fns-tz';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

interface Activity {
  _id: string;
  actor: string;
  actorName?: string | null;
  channel: string;
  content: string;
  createdAt: string;
}

export function ReferralTimeline({ referralId }: { referralId: string }) {
  const { data, error, isLoading } = useSWR<Activity[]>(
    `/api/referrals/${referralId}/activities`,
    fetcher,
    {
      refreshInterval: 60_000,
    }
  );

  const activities = Array.isArray(data) ? data : [];
  const hasActivity = activities.length > 0;
  const [showAll, setShowAll] = useState(false);
  const visibleActivities = useMemo(
    () => (showAll ? activities : activities.slice(0, 5)),
    [activities, showAll]
  );
  const canShowToggle = activities.length > 5;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity timeline</CardTitle>
        <p className="text-sm text-foreground-muted">Latest interactions and updates from your team.</p>
      </CardHeader>
      <CardContent className="space-y-4">
      {isLoading && <p className="text-sm text-foreground-subtle">Loading activity…</p>}
      {error && !isLoading && (
        <p className="text-sm text-danger">We couldn’t load recent activity. Please refresh to try again.</p>
      )}
      {data && !hasActivity && (
        <EmptyState
          compact
          title="No activity logged yet"
          description="Add a note or update the status to get started."
        />
      )}
      {hasActivity && (
        <div className="space-y-3">
          {visibleActivities.map((activity) => (
            <div key={activity._id} className="rounded-lg border border-border bg-surface-muted p-3">
              <div className="flex items-center justify-between text-xs text-foreground-subtle">
                <span className="font-semibold text-foreground-muted">{activity.channel}</span>
                <span className="tabular-nums">
                  {formatInTimeZone(new Date(activity.createdAt), SLA_TIME_ZONE, "MMM d, yyyy 'at' h:mm a 'MT'")}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground-muted">{activity.content}</p>
              <p className="text-xs text-foreground-subtle">
                by {activity.actorName?.trim() || activity.actor}
                {activity.actorName?.trim() && activity.actor !== activity.actorName.trim()
                  ? ` (${activity.actor})`
                  : ''}
              </p>
            </div>
          ))}
          {canShowToggle && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAll((previous) => !previous)}
            >
              {showAll ? 'Show less' : 'Show all activity'}
            </Button>
          )}
        </div>
      )}
      </CardContent>
    </Card>
  );
}
