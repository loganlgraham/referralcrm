'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { MortgageConsultantSearch } from '@/components/lenders/mortgage-consultant-search';
import { LendersTable } from '@/components/tables/lenders-table';
import { fetcher } from '@/utils/fetcher';
import { PageHeader } from '@/components/ui/page-header';
import { Button, buttonClasses } from '@/components/ui/button';

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Partner network"
        title="Mortgage consultants"
        description="Manage and browse licensed mortgage consultants."
        attention={inactiveCount > 0}
        actions={
          <Button type="button" onClick={() => setShowForm((previous) => !previous)}>
            {showForm ? 'Close form' : 'Add mortgage consultant'}
          </Button>
        }
      />

      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow text-foreground-subtle">Inactive mortgage consultants</p>
            <p className="text-numeric mt-1 text-2xl font-semibold tracking-[-0.02em] text-foreground">{inactiveCount}</p>
            <p className="text-sm text-foreground-subtle">
              Inactive mortgage consultants are hidden from non-admin users and should be reviewed before assignment.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/lenders?activeFilter=inactive"
              className={buttonClasses({ variant: 'secondary' })}
            >
              View inactive
            </Link>
            <Link href="/lenders" className={buttonClasses({ variant: 'secondary' })}>
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
