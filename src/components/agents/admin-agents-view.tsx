'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, MapPin } from 'lucide-react';
import useSWR from 'swr';

import { FindAgentExperience } from '@/components/find-agent/find-agent-experience';
import { AgentsTable } from '@/components/tables/agents-table';
import { Modal } from '@/components/ui/modal';
import { AddAgentForm } from '@/components/agents/add-agent-form';
import { fetcher } from '@/utils/fetcher';

interface InactiveAgentsResponse {
  total: number;
}

export function AdminAgentsView() {
  const [showAddAgentModal, setShowAddAgentModal] = useState(false);
  const [showAISearchModal, setShowAISearchModal] = useState(false);
  const { data: inactiveAgentsData } = useSWR<InactiveAgentsResponse>(
    '/api/agents?minimal=true&all=true&activeFilter=inactive',
    fetcher
  );
  const inactiveCount = inactiveAgentsData?.total ?? 0;

  const handleAgentCreated = () => {
    // The AgentsTable will refresh via SWR when the page re-renders
    // We can close the modal after a short delay to show success message
    setTimeout(() => {
      setShowAddAgentModal(false);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
          <p className="text-sm text-foreground-subtle">Browse and manage real estate agent partners.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowAddAgentModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Add agent"
          >
            <Plus className="h-4 w-4" />
            <span>Add Agent</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAISearchModal(true)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Find agent by area"
          >
            <MapPin className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Inactive agents</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{inactiveCount}</p>
            <p className="text-sm text-foreground-subtle">
              Inactive agents are hidden from non-admin users and should be reviewed before assignment.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/agents?activeFilter=inactive"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
            >
              View inactive agents
            </Link>
            <Link
              href="/agents"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
            >
              View all agents
            </Link>
          </div>
        </div>
      </div>

      <AgentsTable />

      {/* Add Agent Modal */}
      <Modal
        isOpen={showAddAgentModal}
        onClose={() => setShowAddAgentModal(false)}
        title="Add Agent"
        size="lg"
      >
        <AddAgentForm
          onSuccess={handleAgentCreated}
          onClose={() => setShowAddAgentModal(false)}
        />
      </Modal>

      {/* AI Search Modal */}
      <Modal
        isOpen={showAISearchModal}
        onClose={() => setShowAISearchModal(false)}
        size="xl"
      >
        <div className="p-6">
          <FindAgentExperience variant="admin" />
        </div>
      </Modal>
    </div>
  );
}
