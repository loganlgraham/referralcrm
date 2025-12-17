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
  const viewerRole: 'admin' | 'mc' | 'agent' = (() => {
    const role = session?.user?.role;
    if (role === 'mc') return 'mc';
    if (role === 'agent') return 'agent';
    return 'admin';
  })();
  const referrals = data.items.map((item) => ({
    _id: item._id,
    borrowerName: item.borrowerName,
    status: item.status,
    createdAt: item.createdAt,
    statusLastUpdated: item.statusLastUpdated ?? null,
    daysInStatus: item.daysInStatus,
    assignedAgentName: item.assignedAgentName,
    buySideAgentName: item.buySideAgentName ?? null,
    sellSideAgentName: item.sellSideAgentName ?? null,
    clientType: item.clientType ?? null,
    dealSide: item.dealSide ?? null,
    lenderName: item.lenderName ?? null,
    origin: item.origin ?? null,
  }));

  return <FollowUpTasksBoard referrals={referrals} viewerRole={viewerRole} />;
}
