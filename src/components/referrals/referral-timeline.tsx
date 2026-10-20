'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatInTimeZone } from 'date-fns-tz';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { railCardClasses, railTitleClasses } from '@/components/referrals/referral-rail';

interface Activity {
  _id: string;
  actor: string;
  actorName?: string | null;
  channel: string;
  content: string;
  createdAt: string;
}

const channelChipClasses: Record<string, string> = {
  email: 'bg-info-soft text-info',
  call: 'bg-success-soft text-success',
  sms: 'bg-success-soft text-success',
  note: 'bg-accent-soft text-accent',
  status: 'bg-warning-soft text-warning',
  update: 'bg-primary-soft text-primary',
};

const channelDotClasses: Record<string, string> = {
  email: 'bg-info',
  call: 'bg-success',
  sms: 'bg-success',
  note: 'bg-accent',
  status: 'bg-warning',
  update: 'bg-primary',
};

const resolveChannelChip = (channel: string) =>
  channelChipClasses[channel.trim().toLowerCase()] ?? 'bg-surface-muted text-foreground-muted';

const resolveChannelDot = (channel: string) =>
  channelDotClasses[channel.trim().toLowerCase()] ?? 'bg-foreground-subtle';

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
    <section className={railCardClasses}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={railTitleClasses}>Activity</h2>
          <p className="mt-0.5 text-[13px] text-foreground-muted">Latest interactions and updates from your team.</p>
        </div>
        {hasActivity ? (
          <span className="text-numeric rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-foreground-muted">
            {activities.length}
          </span>
        ) : null}
      </div>
      <div className="mt-4">
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
          <>
            <ol className="list-none">
              {visibleActivities.map((activity) => {
                const actorName = activity.actorName?.trim();
                const showActorHandle = Boolean(actorName) && activity.actor !== actorName;
                return (
                  <li key={activity._id} className="group relative flex gap-3 pb-5 last:pb-0">
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-[7px] top-6 w-px bg-border group-last:hidden"
                    />
                    <span
                      aria-hidden
                      className="relative mt-[5px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-surface shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                    >
                      <span className={`h-[7px] w-[7px] rounded-full ${resolveChannelDot(activity.channel)}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${resolveChannelChip(
                              activity.channel
                            )}`}
                          >
                            {activity.channel}
                          </span>
                          <span className="truncate text-sm font-semibold text-foreground">
                            {actorName || activity.actor}
                          </span>
                          {showActorHandle ? (
                            <span className="truncate text-xs text-foreground-subtle">{activity.actor}</span>
                          ) : null}
                        </div>
                        <span className="text-numeric text-xs text-foreground-subtle">
                          {formatInTimeZone(new Date(activity.createdAt), SLA_TIME_ZONE, "MMM d, yyyy 'at' h:mm a 'MT'")}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-sm leading-relaxed text-foreground-muted">{activity.content}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {canShowToggle && (
              <button
                type="button"
                onClick={() => setShowAll((previous) => !previous)}
                className="mt-4 text-[13px] font-semibold text-primary transition hover:text-primary-hover"
              >
                {showAll ? 'Show less' : `Show all activity (${activities.length})`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
