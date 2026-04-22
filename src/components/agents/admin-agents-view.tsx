'use client';

import { useState } from 'react';
import { Plus, MapPin } from 'lucide-react';

import { FindAgentExperience } from '@/components/find-agent/find-agent-experience';
import { AgentsTable } from '@/components/tables/agents-table';
import { Modal } from '@/components/ui/modal';
import { AddAgentForm } from '@/components/agents/add-agent-form';

export function AdminAgentsView() {
  const [showAddAgentModal, setShowAddAgentModal] = useState(false);
  const [showAISearchModal, setShowAISearchModal] = useState(false);

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
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Add agent"
          >
            <Plus className="h-4 w-4" />
            <span>Add Agent</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAISearchModal(true)}
            className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Find agent by area"
          >
            <MapPin className="h-4 w-4" />
          </button>
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
