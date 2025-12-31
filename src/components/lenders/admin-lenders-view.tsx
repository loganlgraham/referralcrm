'use client';

import { useState } from 'react';

import { MortgageConsultantSearch } from '@/components/lenders/mortgage-consultant-search';
import { LendersTable } from '@/components/tables/lenders-table';

export function AdminLendersView() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm((previous) => !previous)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          {showForm ? 'Close form' : 'Add mortgage consultant'}
        </button>
      </div>

      <MortgageConsultantSearch />

      <LendersTable showForm={showForm} setShowForm={setShowForm} />
    </div>
  );
}
