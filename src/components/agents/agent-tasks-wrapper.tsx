'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import useSWR from 'swr';

import { FollowUpTasksBoard } from '@/components/referrals/follow-up-task-board';
import { AgentOnboardingTaskBoard } from '@/components/agents/agent-onboarding-task-board';
import { fetcher } from '@/utils/fetcher';
import type { FollowUpTaskRole } from '@/components/referrals/use-follow-up-tasks';

interface BoardReferral {
  _id: string;
  borrowerName: string;
  status: string;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
  createdAt: string;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  buySideAgentName?: string | null;
  sellSideAgentName?: string | null;
  clientType?: 'Buyer' | 'Seller' | 'Both' | null;
  dealSide?: 'buy' | 'sell' | null;
  lenderName?: string | null;
  origin?: 'agent' | 'mc' | 'admin' | null;
}

interface BoardAgent {
  _id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface ReferralsResponse {
  items: BoardReferral[];
  total: number;
  page: number;
  pageSize: number;
}

interface AgentsResponse {
  items: BoardAgent[];
  total: number;
  page: number;
  pageSize: number;
}

interface AgentTasksWrapperProps {
  referrals: BoardReferral[];
  viewerRole: FollowUpTaskRole;
}

export function AgentTasksWrapper({
  referrals,
  viewerRole,
}: AgentTasksWrapperProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get('tab') || 'clients';

  const agentsPage = Number(searchParams.get('agentsPage') || 1);
  const agentsPageSize = 25;

  // Only fetch agents if we're on the agents tab and user is admin
  const shouldFetchAgents = activeTab === 'agents' && viewerRole === 'admin';
  const { data: agentsData } = useSWR<AgentsResponse>(
    shouldFetchAgents ? `/api/agents?page=${agentsPage}&pageSize=${agentsPageSize}&all=true` : null,
    fetcher
  );

  const handleTabChange = (tab: 'clients' | 'agents') => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'clients') {
      params.delete('tab');
      params.delete('agentsPage');
    } else {
      params.set('tab', 'agents');
    }
    router.push(`/referrals/follow-ups?${params.toString()}`);
  };

  const agents = useMemo(() => {
    if (!agentsData?.items) return [];
    return agentsData.items.map((agent) => ({
      _id: agent._id,
      name: agent.name || 'Unnamed agent',
      email: agent.email || '',
      createdAt: new Date().toISOString(), // createdAt not in API response, use current time as fallback
    }));
  }, [agentsData]);

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            type="button"
            onClick={() => handleTabChange('clients')}
            className={`
              whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium transition
              ${
                activeTab === 'clients'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }
            `}
          >
            Client Tasks
          </button>
          {viewerRole === 'admin' && (
            <button
              type="button"
              onClick={() => handleTabChange('agents')}
              className={`
                whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium transition
                ${
                  activeTab === 'agents'
                    ? 'border-brand text-brand'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }
              `}
            >
              Agent Tasks
            </button>
          )}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'clients' ? (
        <>
          <FollowUpTasksBoard referrals={referrals} viewerRole={viewerRole} />
        </>
      ) : (
        <>
          {shouldFetchAgents ? (
            <>
              <AgentOnboardingTaskBoard agents={agents} />
              {agentsData && agentsData.total > 0 && (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <p className="text-sm text-slate-600">
                      Showing <span className="font-medium text-slate-900">
                        {agentsData.total === 0 ? 0 : (agentsData.page - 1) * agentsData.pageSize + 1}
                      </span> to{' '}
                      <span className="font-medium text-slate-900">
                        {Math.min(agentsData.page * agentsData.pageSize, agentsData.total)}
                      </span> of{' '}
                      <span className="font-medium text-slate-900">{agentsData.total}</span> agents
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const params = new URLSearchParams(searchParams.toString());
                        if (agentsPage > 1) {
                          params.set('agentsPage', (agentsPage - 1).toString());
                        } else {
                          params.delete('agentsPage');
                        }
                        router.push(`/referrals/follow-ups?${params.toString()}`);
                      }}
                      disabled={agentsPage <= 1}
                      className="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Previous page"
                    >
                      ←
                    </button>
                    <span className="px-3 py-1.5 text-sm font-medium text-slate-700">
                      Page {agentsPage} of {Math.ceil(agentsData.total / agentsData.pageSize)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const params = new URLSearchParams(searchParams.toString());
                        const totalPages = Math.ceil(agentsData.total / agentsData.pageSize);
                        if (agentsPage < totalPages) {
                          params.set('agentsPage', (agentsPage + 1).toString());
                          router.push(`/referrals/follow-ups?${params.toString()}`);
                        }
                      }}
                      disabled={agentsPage >= Math.ceil(agentsData.total / agentsData.pageSize)}
                      className="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Next page"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
              Loading agents...
            </div>
          )}
        </>
      )}
    </div>
  );
}
