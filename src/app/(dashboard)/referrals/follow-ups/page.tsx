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
  const data = await getReferrals({ session, page: 1 });
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
  }));

  return <FollowUpTasksBoard referrals={referrals} />;
}
