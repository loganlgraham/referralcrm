import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getAgentProfile } from '@/lib/server/people';
import { PersonNotes } from '@/components/people/person-notes';

interface AgentDetailPageProps {
  params: { id: string };
}

export const metadata: Metadata = {
  title: 'Agent Detail | Referral CRM'
};

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const agent = await getAgentProfile(params.id);
  if (!agent) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{agent.name}</h1>
        <p className="mt-2 text-sm text-slate-600">{agent.email}</p>
        <p className="text-sm text-slate-600">{agent.phone || '—'}</p>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-slate-400">States Licensed</p>
            <p className="font-medium text-slate-900">{agent.statesLicensed?.join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Areas Covered</p>
            <p className="font-medium text-slate-900">{agent.coverageAreas?.slice(0, 10).join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Closings (12 mo)</p>
            <p className="font-medium text-slate-900">{agent.closings12mo ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Closing Percentage</p>
            <p className="font-medium text-slate-900">
              {agent.closingRatePercentage !== undefined && agent.closingRatePercentage !== null
                ? `${agent.closingRatePercentage}%`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">NPS Score</p>
            <p className="font-medium text-slate-900">{agent.npsScore ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Avg Response (hrs)</p>
            <p className="font-medium text-slate-900">
              {agent.avgResponseHours !== undefined && agent.avgResponseHours !== null
                ? agent.avgResponseHours
                : '—'}
            </p>
          </div>
        </div>
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
