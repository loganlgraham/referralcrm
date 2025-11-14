import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCurrentSession } from '@/lib/auth';
import { getAgentProfile } from '@/lib/server/people';
import { PersonNotes } from '@/components/people/person-notes';
import { AgentNpsEditor } from '@/components/people/agent-nps-editor';
import { formatCurrency, formatDecimal, formatPhoneNumber } from '@/utils/formatters';

interface AgentDetailPageProps {
  params: { id: string };
}

export const metadata: Metadata = {
  title: 'Agent Detail | Referral CRM'
};

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'mc')) {
    notFound();
  }

  const agent = await getAgentProfile(params.id);
  if (!agent) {
    notFound();
  }

  const canEditNps = session.user.role === 'admin';

  const metricCards = [
    { label: 'Closings (12 mo)', value: agent.metrics.closingsLast12Months.toString() },
    {
      label: 'Closing Percentage',
      value: agent.metrics.totalReferrals === 0
        ? '—'
        : `${formatDecimal(agent.metrics.closingRate)}%`
    },
    { label: 'NPS Score', value: agent.metrics.npsScore ?? '—' },
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
    }
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{agent.name}</h1>
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          <p>
            Email:{' '}
            <a href={`mailto:${agent.email}`} className="text-brand hover:underline">
              {agent.email}
            </a>
          </p>
          <p>Phone: {formatPhoneNumber(agent.phone) || '—'}</p>
          <p>License: {agent.licenseNumber || '—'}</p>
          <p>Brokerage: {agent.brokerage || '—'}</p>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-slate-400">States Licensed</p>
            <p className="font-medium text-slate-900">{agent.statesLicensed?.join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Areas Covered</p>
            <p className="font-medium text-slate-900">
              {(() => {
                const labels =
                  Array.isArray(agent.coverageLocations) && agent.coverageLocations.length > 0
                    ? agent.coverageLocations.map((location) => location.label)
                    : agent.coverageAreas ?? [];
                return labels.slice(0, 10).join(', ') || '—';
              })()}
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 text-sm text-slate-600 md:grid-cols-3">
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
      <PersonNotes
        subjectId={params.id}
        initialNotes={agent.notes}
        endpoint="/api/agents"
        description="Only admins and mortgage consultants can view these notes. They remain hidden from the agent by default."
      />
    </div>
  );
}
