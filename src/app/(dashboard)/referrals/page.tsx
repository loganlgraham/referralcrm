export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import Link from 'next/link';
import { PlusIcon } from 'lucide-react';
import { ReferralTable, ReferralRow, ReferralSummary } from '@/components/tables/referral-table';
import { Pagination } from '@/components/tables/pagination';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';
import { Filters } from '@/components/forms/referral-filters';

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

  // Validate pageSize - must be one of: 20, 25, 50, 100 (default to 20)
  const validPageSizes = [20, 25, 50, 100];
  const pageSizeParam = searchParams.pageSize ? Number(searchParams.pageSize) : 20;
  const pageSize = validPageSizes.includes(pageSizeParam) ? pageSizeParam : 20;

  const data = await getReferrals({
    session,
    page: Number(searchParams.page || 1),
    pageSize,
    status: searchParams.status?.toString(),
    mc: searchParams.mc?.toString(),
    agent: searchParams.agent?.toString(),
    zip: searchParams.zip?.toString(),
    search: searchParams.search?.toString() ?? null,
    ahaBucket: ahaBucketParam === 'AHA' || ahaBucketParam === 'AHA_OOS' ? ahaBucketParam : null,
    agentReferrals: role === 'admin' && agentReferrals !== 'all' ? agentReferrals : null,
    timeline: searchParams.timeline?.toString() ?? null
  });

  const items = data.items as ReferralRow[];
  const hasReferrals = items.length > 0;
  const summary = data.summary ?? {
    total: data.total ?? items.length,
    closedDeals: 0,
    closeRate: 0,
    activeReferrals: 0
  };
  const showAgentOriginIndicator = tableMode === 'admin' && agentReferrals === 'all';
  const showAddReferralButton = role !== 'mc';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {tableMode === 'agent' ? 'My referrals' : 'Referrals'}
          </h1>
          <p className="text-sm text-slate-500">
            {tableMode === 'agent'
              ? 'Review your leads, update their status, and capture quick notes as you work each opportunity.'
              : tableMode === 'mc'
              ? 'Keep tabs on the borrowers you have handed off and collaborate with partnered agents.'
              : 'Track every lead from intake through close.'}
          </p>
        </div>
        {showAddReferralButton && (
          <Link
            href="/referrals/new"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <PlusIcon className="h-4 w-4" />
            {role === 'admin' ? 'Add Referral' : 'Add Referral for AFC'}
          </Link>
        )}
      </div>
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
          />
          <Pagination
            currentPage={data.page}
            totalItems={data.total}
            pageSize={data.pageSize}
            totalPages={Math.ceil(data.total / data.pageSize)}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No referrals yet. Add your first referral to get started.
        </div>
      )}
    </div>
  );
}
