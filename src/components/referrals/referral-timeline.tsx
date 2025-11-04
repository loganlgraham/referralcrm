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
  const { data } = useSWR<Activity[]>(`/api/referrals/${referralId}/activities`, fetcher, {
    refreshInterval: 60_000
  });

  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading activity…</div>;
  }

  return (
    <div className="space-y-4">
      {data.map((activity) => (
        <div key={activity._id} className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="uppercase">{activity.channel}</span>
            <span>{format(new Date(activity.createdAt), 'PPpp')}</span>
          </div>
          <p className="mt-2 text-sm text-slate-700">{activity.content}</p>
          <p className="text-xs text-slate-500">by {activity.actor}</p>
        </div>
      ))}
    </div>
  );
}
