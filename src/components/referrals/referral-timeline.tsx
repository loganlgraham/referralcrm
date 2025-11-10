'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { format } from 'date-fns';

interface Activity {
  _id: string;
  actor: string;
  channel: string;
  content: string;
  createdAt: string;
}

export function ReferralTimeline({ referralId }: { referralId: string }) {
  const {
    data,
    error,
    isLoading
  } = useSWR<Activity[]>(`/api/referrals/${referralId}/activities`, fetcher, {
    refreshInterval: 60_000
  });

  const activities = Array.isArray(data) ? data : [];
  const hasActivity = activities.length > 0;

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
          {activities.map((activity) => (
            <div key={activity._id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="uppercase">{activity.channel}</span>
                <span>{format(new Date(activity.createdAt), 'PPpp')}</span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{activity.content}</p>
              <p className="text-xs text-slate-500">by {activity.actor}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
