import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCurrentSession } from '@/lib/auth';
import { getAgentProfile } from '@/lib/server/people';
import { getReferrals } from '@/lib/server/referrals';
import { PersonNotes } from '@/components/people/person-notes';
import { AgentNpsEditor } from '@/components/people/agent-nps-editor';
import { PersonDealsTable } from '@/components/people/person-deals-table';
import { AgentOverviewCard } from '@/components/people/agent-overview-card';
import { PersonDeleteSection } from '@/components/people/person-delete-section';
import { ReferralTable, type ReferralRow } from '@/components/tables/referral-table';
import { Pagination } from '@/components/tables/pagination';
import { formatCurrency, formatDecimal } from '@/utils/formatters';

interface AgentDetailPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export const metadata: Metadata = {
  title: 'Agent Detail | Referral CRM'
};

export default async function AgentDetailPage({ params, searchParams }: AgentDetailPageProps) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'mc' && session.user.role !== 'agent')) {
    notFound();
  }

  const agent = await getAgentProfile(params.id);
  if (!agent) {
    notFound();
  }

  const isAdmin = session.user.role === 'admin';
  const isAgent = session.user.role === 'agent';
  const isViewingOwnProfile = isAgent && session.user.id === agent._id;
  const canEditNps = isAdmin;
  const canViewNotes = isAdmin;
  const canViewDeals = !isAgent || isViewingOwnProfile;

  const validPageSizes = [20, 25, 50, 100];
  const pageSizeParam = searchParams.pageSize ? Number(searchParams.pageSize) : 25;
  const pageSize = validPageSizes.includes(pageSizeParam) ? pageSizeParam : 25;
  const sortBy = searchParams.sortBy?.toString() ?? null;
  const sortDirection = (searchParams.sortDirection?.toString() as 'asc' | 'desc' | undefined) ?? null;

  const referralsData = canViewDeals
    ? await getReferrals({
        session,
        page: Number(searchParams.page || 1),
        pageSize,
        agent: params.id,
        sortBy,
        sortDirection
      })
    : null;

  const referralItems = (referralsData?.items ?? []) as ReferralRow[];

  const metricCards = [
    { label: 'Closings (12 mo)', value: agent.metrics.closingsLast12Months.toString() },
    {
      label: 'Closing Percentage',
      value: agent.metrics.totalReferrals === 0
        ? '—'
        : `${formatDecimal(agent.metrics.closingRate)}%`
    },
    {
      label: 'Avg Response (hrs)',
      value:
        agent.metrics.avgResponseHours == null
          ? '—'
          : formatDecimal(agent.metrics.avgResponseHours)
    },
    {
      label: 'Total Referral Fees Paid',
      value: formatCurrency(agent.metrics.totalReferralFeesPaidCents)
    },
    {
      label: 'Total Net Income from Referrals',
      value: formatCurrency(agent.metrics.totalNetIncomeCents)
    },
    { label: 'Total Referrals', value: agent.metrics.totalReferrals.toString() },
    { label: 'Active Pipeline', value: agent.metrics.activePipeline.toString() },
    { label: 'Deals Closed (All Time)', value: agent.metrics.dealsClosedAllTime.toString() },
    { label: 'Referrals Last 30 Days', value: agent.metrics.referralsLast30Days.toString() },
    {
      label: 'Avg Referral Fee Paid',
      value:
        agent.metrics.averageReferralFeePaidCents == null
          ? '—'
          : formatCurrency(agent.metrics.averageReferralFeePaidCents)
    },
    {
      label: 'Avg Commission %',
      value:
        agent.metrics.averageCommissionPercent == null
          ? '—'
          : `${formatDecimal(agent.metrics.averageCommissionPercent)}%`
    },
    {
      label: 'First Contact ≤ 24h',
      value: (() => {
        const rate = formatDecimal(agent.metrics.firstContactWithin24HoursRate);
        return rate === '—' ? '—' : `${rate}%`;
      })()
    },
    {
      label: 'Avg. days paired → under contract',
      value:
        agent.metrics.averageDaysPairedToUnderContract == null
          ? '—'
          : `${formatDecimal(agent.metrics.averageDaysPairedToUnderContract)} days`
    },
    {
      label: 'Avg. days under contract → closed',
      value:
        agent.metrics.averageDaysUnderContractToClosed == null
          ? '—'
          : `${formatDecimal(agent.metrics.averageDaysUnderContractToClosed)} days`
    },
    {
      label: 'Avg. days closed → paid',
      value:
        agent.metrics.averageDaysClosedToPaid == null
          ? '—'
          : `${formatDecimal(agent.metrics.averageDaysClosedToPaid)} days`
    }
  ];

  return (
    <div className="space-y-6">
      <AgentOverviewCard agent={agent} isAdmin={isAdmin} />
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Performance snapshot</h2>
        <div className="mt-4 grid gap-4 text-sm text-slate-600 md:grid-cols-3">
          {metricCards.map((card) => (
            <div key={card.label} className="rounded border border-slate-200 p-4">
              <p className="text-xs uppercase text-slate-400">{card.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>
        {canEditNps && (
          <div className="mt-6">
            <AgentNpsEditor agentId={agent._id} initialScore={agent.metrics.npsScore ?? null} />
          </div>
        )}
      </div>
      {canViewDeals && (
        <>
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Referrals</h2>
            <div className="mt-4 space-y-4">
              {referralItems.length > 0 ? (
                <>
                  <ReferralTable
                    data={referralItems}
                    mode={isAdmin ? 'admin' : isAgent ? 'agent' : 'mc'}
                    hideAgentColumn
                  />
                  <Pagination
                    currentPage={referralsData?.page ?? 1}
                    totalItems={referralsData?.total ?? 0}
                    pageSize={referralsData?.pageSize ?? 25}
                    totalPages={Math.ceil((referralsData?.total ?? 0) / (referralsData?.pageSize ?? 25))}
                    itemLabel="referrals"
                  />
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
                  No referrals yet.
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Deals</h2>
            <div className="mt-4">
              <PersonDealsTable deals={agent.deals} context="agent" />
            </div>
          </div>
        </>
      )}
      {canViewNotes && (
        <PersonNotes
          subjectId={params.id}
          initialNotes={agent.notes}
          endpoint="/api/agents"
          description="Only admins can view these notes. They remain hidden from the agent by default."
        />
      )}
      {isAdmin && (
        <PersonDeleteSection
          id={params.id}
          label="agent"
          endpoint="/api/agents"
          redirectPath="/agents"
          details="Deleting this agent removes their profile, notes, and login access. Deals and referrals will stay recorded."
        />
      )}
    </div>
  );
}
