export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import Link from 'next/link';
import { PlusIcon, Send } from 'lucide-react';
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {tableMode === 'agent' ? 'My referrals' : 'Referrals'}
          </h1>
          <p className="text-sm text-foreground-subtle">
            {tableMode === 'agent'
              ? 'Review your leads, update their status, and capture quick notes as you work each opportunity.'
              : tableMode === 'mc'
              ? 'Keep tabs on the borrowers you have handed off and collaborate with partnered agents.'
              : 'Track every lead from intake through close.'}
          </p>
        </div>
        {showAddReferralButton ? (
          role === 'admin' ? (
            <Link
              href="/referrals/new"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <PlusIcon className="h-4 w-4" />
              Add Referral
            </Link>
          ) : (
            <Link
              href="/referrals/new"
              className="group relative inline-flex max-w-full items-center gap-3 overflow-hidden rounded-xl bg-gradient-to-br from-primary-hover via-primary-active to-primary px-4 py-3 text-white no-underline shadow-lg shadow-primary/25 ring-1 ring-inset ring-white/15 transition hover:-translate-y-0.5 hover:text-white hover:shadow-xl hover:shadow-primary/30 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.18)_48%,transparent_62%)] bg-[length:220%_100%] bg-left transition-[background-position] duration-700 group-hover:bg-right"
              />
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/20">
                <Send
                  className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </span>
              <span className="relative text-sm font-semibold leading-tight tracking-tight">
                Introduce a client to AFC
              </span>
            </Link>
          )
        ) : null}
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
        <div className="rounded-xl border border-dashed border-border-strong bg-surface-raised p-10 text-center text-sm text-foreground-subtle">
          {tableMode === 'agent'
            ? 'No referrals yet. When you have a buyer ready for financing, introduce them to AFC and we will pair them with a mortgage consultant.'
            : 'No referrals yet. Add your first referral to get started.'}
        </div>
      )}
    </div>
  );
}
