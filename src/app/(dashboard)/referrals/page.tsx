export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import Link from 'next/link';
import { PlusIcon, Send } from 'lucide-react';
import { ReferralTable, ReferralRow, ReferralSummary } from '@/components/tables/referral-table';
import { Pagination } from '@/components/tables/pagination';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';
import { Filters } from '@/components/forms/referral-filters';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Referrals | Referral CRM'
};

export default async function ReferralsPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getCurrentSession();
  const role = (session?.user?.role as 'admin' | 'manager' | 'mc' | 'agent' | 'viewer' | undefined) ?? 'viewer';
  const tableMode: 'admin' | 'mc' | 'agent' = role === 'agent' ? 'agent' : role === 'mc' ? 'mc' : 'admin';
  const ahaBucketParam = searchParams.ahaBucket?.toString();
  const agentReferralsParam = searchParams.agentReferrals?.toString();
  const agentReferrals =
    agentReferralsParam === 'yes' || agentReferralsParam === 'no' ? agentReferralsParam : 'all';

  // Validate pageSize - must be one of: 20, 25, 50, 100 (default to 25)
  const validPageSizes = [20, 25, 50, 100];
  const pageSizeParam = searchParams.pageSize ? Number(searchParams.pageSize) : 25;
  const pageSize = validPageSizes.includes(pageSizeParam) ? pageSizeParam : 25;

  const sortBy = searchParams.sortBy?.toString() ?? null;
  const sortDirection = (searchParams.sortDirection?.toString() as 'asc' | 'desc' | undefined) ?? null;

  const data = await getReferrals({
    session,
    page: Number(searchParams.page || 1),
    pageSize,
    status: searchParams.status?.toString(),
    mc: searchParams.mc?.toString(),
    agent: searchParams.agent?.toString(),
    zip: searchParams.zip?.toString(),
    search: searchParams.search?.toString() ?? null,
    ahaBucket: ahaBucketParam === 'AHA' || ahaBucketParam === 'AHA_OOS' || ahaBucketParam === 'AGIT' ? ahaBucketParam : null,
    agentReferrals: role === 'admin' && agentReferrals !== 'all' ? agentReferrals : null,
    timeline: searchParams.timeline?.toString() ?? null,
    sortBy,
    sortDirection,
    maxStageReached: searchParams.maxStageReached?.toString() ?? null
  });

  const items = (data && Array.isArray(data.items) ? data.items : []) as ReferralRow[];
  const hasReferrals = items.length > 0;
  const summary = data?.summary ?? {
    total: data?.total ?? items.length,
    closedDeals: 0,
    closeRate: 0,
    activeReferrals: 0
  };
  const showAgentOriginIndicator = tableMode === 'admin' && agentReferrals === 'all';
  const showAddReferralButton = role !== 'mc';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Pipeline"
        title={tableMode === 'agent' ? 'My referrals' : 'Referrals'}
        description={
          tableMode === 'agent'
            ? 'Review your leads, update their status, and capture quick notes as you work each opportunity.'
            : tableMode === 'mc'
            ? 'Keep tabs on the borrowers you have handed off and collaborate with partnered agents.'
            : 'Track every lead from intake through close.'
        }
        attention={tableMode === 'admin' ? false : undefined}
        actions={
          role === 'admin' ? (
            <Link href="/referrals/new" className={buttonClasses()}>
              <PlusIcon className="h-4 w-4" aria-hidden />
              Add referral
            </Link>
          ) : null
        }
      />
      <Filters mode={tableMode} />
      {hasReferrals ? (
        <div className="space-y-4">
          {tableMode !== 'admin' && (
            <ReferralSummary summary={summary} mode={tableMode === 'agent' ? 'agent' : 'mc'} />
          )}
          <ReferralTable
            data={items}
            mode={tableMode}
            showAgentOriginIndicator={showAgentOriginIndicator}
            stackOnMobile={tableMode !== 'admin'}
          />
          <Pagination
            currentPage={data?.page ?? 1}
            totalItems={data?.total ?? 0}
            pageSize={data?.pageSize ?? 25}
            totalPages={Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25))}
            itemLabel="referrals"
          />
        </div>
      ) : (
        <EmptyState
          icon={<Send className="h-4 w-4" aria-hidden />}
          title="No referrals yet"
          description={
            tableMode === 'agent'
              ? 'When you have a buyer ready for financing, introduce them to AFC and we will pair them with a mortgage consultant.'
              : 'Add your first referral to get started.'
          }
          action={
            showAddReferralButton ? (
              <Link href="/referrals/new" className={buttonClasses({ size: 'sm' })}>
                {role === 'admin' ? 'Add referral' : 'Introduce a client to AFC'}
              </Link>
            ) : null
          }
        />
      )}
    </div>
  );
}
