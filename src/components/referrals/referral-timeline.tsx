'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatInTimeZone } from 'date-fns-tz';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { useMemo, useState } from 'react';

interface Activity {
  _id: string;
  actor: string;
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
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Activity timeline</h2>
        <p className="text-sm text-slate-500">Latest interactions and updates from your team.</p>
      </div>
      {isLoading && <p className="text-sm text-slate-500">Loading activity…</p>}
      {error && !isLoading && (
        <p className="text-sm text-rose-500">We couldn’t load recent activity. Please refresh to try again.</p>
      )}
      {data && !hasActivity && (
        <p className="text-sm text-slate-500">No activity logged yet. Add a note or update the status to get started.</p>
      )}
      {hasActivity && (
        <div className="space-y-3">
          {visibleActivities.map((activity) => (
            <div key={activity._id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="uppercase">{activity.channel}</span>
                <span>{formatInTimeZone(new Date(activity.createdAt), SLA_TIME_ZONE, "MMM d, yyyy 'at' h:mm a 'MT'")}</span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{activity.content}</p>
              <p className="text-xs text-slate-500">by {activity.actor}</p>
            </div>
          ))}
          {canShowToggle && (
            <button
              type="button"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              onClick={() => setShowAll((previous) => !previous)}
            >
              {showAll ? 'Show less' : 'Show all activity'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
