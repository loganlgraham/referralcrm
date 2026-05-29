'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { MortgageConsultantSearch } from '@/components/lenders/mortgage-consultant-search';
import { LendersTable } from '@/components/tables/lenders-table';
import { fetcher } from '@/utils/fetcher';

interface InactiveLendersResponse {
  total: number;
}

export function AdminLendersView() {
  const [showForm, setShowForm] = useState(false);
  const { data: inactiveLendersData } = useSWR<InactiveLendersResponse>(
    '/api/lenders?minimal=true&all=true&activeFilter=inactive',
    fetcher
  );
  const inactiveCount = inactiveLendersData?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Mortgage Consultants</h1>
          <p className="text-sm text-foreground-subtle">Manage and browse licensed mortgage consultants.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((previous) => !previous)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {showForm ? 'Close form' : 'Add mortgage consultant'}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Inactive mortgage consultants</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{inactiveCount}</p>
            <p className="text-sm text-foreground-subtle">
              Inactive mortgage consultants are hidden from non-admin users and should be reviewed before assignment.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/lenders?activeFilter=inactive"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
            >
              View inactive
            </Link>
            <Link
              href="/lenders"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
            >
              View all
            </Link>
          </div>
        </div>
      </div>

      <MortgageConsultantSearch />

      <LendersTable showForm={showForm} setShowForm={setShowForm} />
    </div>
  );
}
