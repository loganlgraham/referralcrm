import { Metadata } from 'next';

import { FollowUpTasksBoard } from '@/components/referrals/follow-up-task-board';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Follow-up Tasks | Referral CRM',
};

export default async function FollowUpTasksPage() {
  const session = await getCurrentSession();
  let loadError = false;

  const data = await getReferrals({ session, page: 1 }).catch((error) => {
    console.error('Failed to load referrals for follow-up tasks', error);
    loadError = true;
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: 0,
    };
  });

  const referrals = data.items.map((item) => ({
    _id: item._id,
    borrowerName: item.borrowerName,
    status: item.status,
    createdAt: item.createdAt,
    statusLastUpdated: item.statusLastUpdated ?? null,
    daysInStatus: item.daysInStatus,
    assignedAgentName: item.assignedAgentName,
    lenderName: item.lenderName ?? null,
    origin: item.origin ?? null,
    dealStatus: item.dealStatus ?? null,
    dealStatusLabel: item.dealStatusLabel ?? null,
  }));

  return (
    <div className="space-y-4">
      {loadError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          We couldn't load follow-up data right now. Please refresh or try again in a moment.
        </div>
      ) : null}
      <FollowUpTasksBoard referrals={referrals} viewerRole={session?.user.role ?? 'viewer'} />
    </div>
  );
}
