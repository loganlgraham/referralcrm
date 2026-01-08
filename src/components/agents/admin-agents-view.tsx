'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';

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
      {/* Icon buttons at the top */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowAddAgentModal(true)}
          className="flex items-center justify-center rounded-md bg-slate-900 p-2 text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Add agent"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setShowAISearchModal(true)}
          className="flex items-center justify-center rounded-md bg-slate-900 p-2 text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="AI search for agents"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Main page content - regular search, designation, and table */}
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
