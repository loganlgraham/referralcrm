'use client';

import { useState } from 'react';

import { FindAgentExperience } from '@/components/find-agent/find-agent-experience';
import { AgentsTable } from '@/components/tables/agents-table';

export function AdminAgentsView() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm((previous) => !previous)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          {showForm ? 'Close form' : 'Add agent'}
        </button>
      </div>

      <FindAgentExperience variant="admin" />

      <AgentsTable showForm={showForm} setShowForm={setShowForm} />
    </div>
  );
}
