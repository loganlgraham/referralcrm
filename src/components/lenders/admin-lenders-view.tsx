'use client';

import { useState } from 'react';

import { MortgageConsultantSearch } from '@/components/lenders/mortgage-consultant-search';
import { LendersTable } from '@/components/tables/lenders-table';

export function AdminLendersView() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Mortgage Consultants</h1>
          <p className="text-sm text-slate-500">Manage and browse licensed mortgage consultants.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((previous) => !previous)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {showForm ? 'Close form' : 'Add mortgage consultant'}
        </button>
      </div>

      <MortgageConsultantSearch />

      <LendersTable showForm={showForm} setShowForm={setShowForm} />
    </div>
  );
}
