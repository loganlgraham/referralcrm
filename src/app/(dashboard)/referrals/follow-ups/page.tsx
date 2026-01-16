import { Metadata } from 'next';

import { AgentTasksWrapper } from '@/components/agents/agent-tasks-wrapper';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Follow-up Tasks | Referral CRM',
};

export default async function FollowUpTasksPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getCurrentSession();
  
  // Validate pageSize - must be one of: 20, 25, 50, 100 (default to 25)
  const validPageSizes = [20, 25, 50, 100];
  const pageSizeParam = searchParams.pageSize ? Number(searchParams.pageSize) : 25;
  const pageSize = validPageSizes.includes(pageSizeParam) ? pageSizeParam : 25;
  
  const data = await getReferrals({ 
    session, 
    page: Number(searchParams.page || 1),
    pageSize
  });
  
  const viewerRole: 'admin' | 'mc' | 'agent' = (() => {
    const role = session?.user?.role;
    if (role === 'mc') return 'mc';
    if (role === 'agent') return 'agent';
    return 'admin';
  })();
  const referrals = (Array.isArray(data.items) ? data.items : []).map((item) => ({
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
    dealStatus: item.dealStatus ?? null,
    dealStatusLabel: item.dealStatusLabel ?? null,
    origin: item.origin ?? null,
    ahaBucket: item.ahaBucket ?? null,
  }));

  return (
    <AgentTasksWrapper
      referrals={referrals}
      referralsTotal={data.total}
      referralsPage={data.page}
      referralsPageSize={data.pageSize}
      viewerRole={viewerRole}
    />
  );
}
