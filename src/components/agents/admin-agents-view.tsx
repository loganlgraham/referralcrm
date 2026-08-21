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
import { PageHeader } from '@/components/ui/page-header';
import { Button, buttonClasses } from '@/components/ui/button';

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Partner network"
        title="Agents"
        description="Browse and manage real estate agent partners."
        attention={inactiveCount > 0}
        actions={
          <>
            <Button
              type="button"
              onClick={() => setShowAddAgentModal(true)}
              aria-label="Add agent"
              leadingIcon={<Plus className="h-4 w-4" />}
            >
              Add Agent
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAISearchModal(true)}
              aria-label="Find agent by area"
            >
              <MapPin className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow text-foreground-subtle">Inactive agents</p>
            <p className="text-numeric mt-1 text-2xl font-semibold tracking-[-0.02em] text-foreground">{inactiveCount}</p>
            <p className="text-sm text-foreground-subtle">
              Inactive agents are hidden from non-admin users and should be reviewed before assignment.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/agents?activeFilter=inactive"
              className={buttonClasses({ variant: 'secondary' })}
            >
              View inactive agents
            </Link>
            <Link href="/agents" className={buttonClasses({ variant: 'secondary' })}>
              View all agents
            </Link>
          </div>
        </div>
      </div>

      <AgentsTable hideHeading />

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
