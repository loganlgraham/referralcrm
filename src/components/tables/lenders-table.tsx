'use client';

import Link from 'next/link';
import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState, useCallback, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Pagination } from '@/components/tables/pagination';
import { fetcher } from '@/utils/fetcher';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldGrid, FieldLabel, selectFieldClasses } from '@/components/ui/field-group';
import { TBody, THead, Table, TableScroll, TableShell, Td, Th, Tr } from '@/components/ui/table-shell';

interface LenderRow {
  _id: string;
  name: string;
  email: string;
  phone: string;
  nmlsId: string;
  licensedStates?: string[];
  active?: boolean;
  metrics?: {
    closingsLast12Months: number;
    closingRate: number;
    totalReferrals: number;
    activePipeline: number;
    dealsClosedAllTime: number;
    revenueRealizedCents: number;
    npsScore: number | null;
  };
}

type SortKey = 'name' | 'email' | 'phone' | 'nmls' | 'states';

type CreatedLenderSummary = {
  id: string;
  name: string;
  email: string;
};

interface LendersTableProps {
  showForm?: boolean;
  setShowForm?: Dispatch<SetStateAction<boolean>>;
}

interface LendersResponse {
  items: LenderRow[];
  total: number;
  page: number;
  pageSize: number;
}

type LenderForm = {
  name: string;
  email: string;
  phone: string;
  nmlsId: string;
  licensedStates: string;
};

function LenderFormFields({
  form,
  handleChange,
  saving,
}: {
  form: LenderForm;
  handleChange: (field: keyof LenderForm) => (event: ChangeEvent<HTMLInputElement>) => void;
  saving: boolean;
}) {
  return (
    <FieldGrid>
      <label className="block space-y-1.5">
        <FieldLabel label="Name" />
        <Input type="text" value={form.name} onChange={handleChange('name')} required disabled={saving} />
      </label>
      <label className="block space-y-1.5">
        <FieldLabel label="Email" />
        <Input type="email" value={form.email} onChange={handleChange('email')} required disabled={saving} />
      </label>
      <label className="block space-y-1.5">
        <FieldLabel label="Phone" />
        <Input
          type="tel"
          value={form.phone}
          onChange={handleChange('phone')}
          disabled={saving}
          className="text-numeric"
        />
      </label>
      <label className="block space-y-1.5">
        <FieldLabel label="NMLS ID" />
        <Input
          type="text"
          value={form.nmlsId}
          onChange={handleChange('nmlsId')}
          disabled={saving}
          className="text-numeric"
        />
      </label>
      <label className="block space-y-1.5">
        <FieldLabel label="Licensed states" hint="comma separated" />
        <Input
          type="text"
          value={form.licensedStates}
          onChange={handleChange('licensedStates')}
          placeholder="CO, UT"
          disabled={saving}
        />
      </label>
      <div className="flex items-end sm:col-span-2">
        <Button type="submit" loading={saving}>
          {saving ? 'Saving…' : 'Save MC'}
        </Button>
      </div>
    </FieldGrid>
  );
}

export function LendersTable({ showForm: externalShowForm, setShowForm: externalSetShowForm }: LendersTableProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);
  
  const page = Number(searchParams.get('page') || 1);
  const pageSizeParam = searchParams.get('pageSize');
  const validPageSizes = [20, 25, 50, 100];
  const pageSize = pageSizeParam && validPageSizes.includes(Number(pageSizeParam)) 
    ? Number(pageSizeParam) 
    : 25;
  const search = searchParams.get('search') || '';
  const activeFilter = (searchParams.get('activeFilter') || 'all') as 'all' | 'active' | 'inactive';
  
  // Build API URL with filters
  const apiParams = new URLSearchParams();
  apiParams.set('page', page.toString());
  apiParams.set('pageSize', pageSize.toString());
  if (search) apiParams.set('search', search);
  if (activeFilter !== 'all') apiParams.set('activeFilter', activeFilter);
  
  const apiUrl = `/api/lenders?${apiParams.toString()}`;
  const { data, mutate } = useSWR<LendersResponse>(apiUrl, fetcher);
  const [internalShowForm, setInternalShowForm] = useState(false);
  const showForm = externalShowForm ?? internalShowForm;
  const setShowForm = externalSetShowForm ?? setInternalShowForm;
  const hasExternalControl = externalShowForm !== undefined && externalSetShowForm !== undefined;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    nmlsId: '',
    licensedStates: '',
  });
  const [lastCreatedLender, setLastCreatedLender] = useState<CreatedLenderSummary | null>(null);
  const [sendingWelcome, setSendingWelcome] = useState(false);
  const [searchQuery, setSearchQuery] = useState(search);

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(
    null
  );
  
  const updateParams = useCallback(
    (updates: { search?: string; activeFilter?: string; page?: number }) => {
      const params = new URLSearchParams(searchParamsString);
      
      if (updates.search !== undefined) {
        if (!updates.search.trim()) {
          params.delete('search');
        } else {
          params.set('search', updates.search.trim());
        }
        params.delete('page');
      }

      if (updates.activeFilter !== undefined) {
        if (updates.activeFilter === 'all') {
          params.delete('activeFilter');
        } else {
          params.set('activeFilter', updates.activeFilter);
        }
        params.delete('page');
      }
      
      if (updates.page !== undefined) {
        if (updates.page <= 1) {
          params.delete('page');
        } else {
          params.set('page', updates.page.toString());
        }
      }
      
      startTransition(() => {
        const queryString = params.toString();
        router.replace(queryString ? `/lenders?${queryString}` : '/lenders');
      });
    },
    [router, searchParamsString, startTransition]
  );
  
  // Debounce search input
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery !== search) {
        updateParams({ search: searchQuery });
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery, search, updateParams]);

  // Sync searchQuery with URL param
  useEffect(() => {
    setSearchQuery(search);
  }, [search]);

  const sortedLenders = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!data) {
      return [];
    }

    if (!sortConfig) {
      return items;
    }

    const getValue = (lender: LenderRow, key: SortKey): string => {
      switch (key) {
        case 'name':
          return lender.name.toLowerCase();
        case 'email':
          return lender.email.toLowerCase();
        case 'phone':
          return lender.phone.toLowerCase();
        case 'nmls':
          return lender.nmlsId.toLowerCase();
        case 'states':
          return (lender.licensedStates ?? []).join(', ').toLowerCase();
        default:
          return '';
      }
    };

    if (!Array.isArray(items)) {
      return [];
    }
    return [...items].sort((a, b) => {
      const aValue = getValue(a, sortConfig.key);
      const bValue = getValue(b, sortConfig.key);
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      return aValue.localeCompare(bValue) * direction;
    });
  }, [data, sortConfig]);

  if (!data) {
    return (
      <div className="rounded-card border border-border bg-surface-raised p-4 text-sm text-foreground-muted shadow-card">
        Loading mortgage consultants…
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    setSortConfig((previous) => {
      if (previous?.key === key) {
        return { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const SortableHeader = ({ label, sortKey }: { label: string; sortKey: SortKey }) => {
    const direction = sortConfig?.key === sortKey ? sortConfig.direction : null;
    const icon = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕';

    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        // Buttons don't inherit text-transform, so the header's eyebrow casing
        // has to be restated or sortable columns read title case.
        className="flex items-center gap-1 text-left uppercase"
      >
        <span>{label}</span>
        <span className="text-[10px] text-foreground-subtle">{icon}</span>
      </button>
    );
  };

  const handleChange = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const licensedStates = form.licensedStates
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);

      const response = await fetch('/api/lenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          nmlsId: form.nmlsId,
          licensedStates,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Unable to create mortgage consultant');
      }

      const createdId = typeof payload?.id === 'string' ? payload.id : null;

      toast.success('Mortgage consultant added');
      setForm({ name: '', email: '', phone: '', nmlsId: '', licensedStates: '' });
      setShowForm(false);
      setLastCreatedLender(
        createdId
          ? {
              id: createdId,
              name: form.name,
              email: form.email,
            }
          : null
      );
      await mutate();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save mortgage consultant');
    } finally {
      setSaving(false);
    }
  };

  const handleSendWelcomeEmail = async () => {
    if (!lastCreatedLender) {
      return;
    }

    setSendingWelcome(true);

    try {
      const response = await fetch(`/api/lenders/${lastCreatedLender.id}/welcome-email`, {
        method: 'POST',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? payload?.message ?? 'Unable to send welcome email');
      }

      toast.success(`Welcome email sent to ${lastCreatedLender.name}`);
      setLastCreatedLender(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to send welcome email');
    } finally {
      setSendingWelcome(false);
    }
  };

  return (
    <div className="space-y-4">
      {isAdmin && lastCreatedLender && (
        <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Send welcome email to {lastCreatedLender.name}
              </p>
              <p className="text-xs text-foreground-muted">{lastCreatedLender.email}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={handleSendWelcomeEmail} loading={sendingWelcome}>
                {sendingWelcome ? 'Sending…' : 'Send welcome email'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setLastCreatedLender(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && !hasExternalControl && (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-raised p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-sm font-semibold tracking-[-0.02em] text-foreground">Add a mortgage consultant</h2>
              <p className="text-xs text-foreground-subtle">Keep the directory up to date so agents can collaborate quickly.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm((previous) => !previous)}>
              {showForm ? 'Close' : 'New MC'}
            </Button>
          </div>
          {showForm && (
            <form onSubmit={handleCreate} className="mt-4">
              <LenderFormFields form={form} handleChange={handleChange} saving={saving} />
            </form>
          )}
        </div>
      )}
      {isAdmin && showForm && hasExternalControl && (
        <form onSubmit={handleCreate} className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <LenderFormFields form={form} handleChange={handleChange} saving={saving} />
        </form>
      )}
      {isAdmin && (
        <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <div className="flex flex-wrap items-end gap-4">
            <label className="block flex-1 space-y-2">
              <span className="text-eyebrow text-foreground-subtle">Search</span>
              <Input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                disabled={isPending}
                className="max-w-2xl"
                placeholder="Name, email, phone, NMLS ID"
              />
            </label>
            <label className="space-y-2">
              <span className="text-eyebrow text-foreground-subtle">Status</span>
              <select
                value={activeFilter}
                onChange={(event) => updateParams({ activeFilter: event.target.value })}
                disabled={isPending}
                className={cn(selectFieldClasses, 'block')}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>
      )}
      <TableShell>
        <TableScroll>
          <Table className="min-w-full">
            <THead>
              <Tr>
                <Th dense={isAdmin} className="text-eyebrow">
                  <SortableHeader label="Lender" sortKey="name" />
                </Th>
                {isAdmin && (
                  <Th dense className="text-eyebrow">
                    Status
                  </Th>
                )}
                <Th dense={isAdmin} className="text-eyebrow">
                  <SortableHeader label="NMLS" sortKey="nmls" />
                </Th>
                <Th dense={isAdmin} className="text-eyebrow">
                  <SortableHeader label="Licensed states" sortKey="states" />
                </Th>
              </Tr>
            </THead>
            <TBody>
              {sortedLenders.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 4 : 3} className="p-4">
                    <EmptyState compact title="No mortgage consultants match this view" />
                  </td>
                </tr>
              ) : (
                sortedLenders.map((lender) => (
                  <Tr key={lender._id}>
                    <Td dense={isAdmin} className="text-foreground-muted">
                      <div className="font-medium text-foreground">
                        <Link href={`/lenders/${lender._id}`} className="text-primary hover:underline">
                          {lender.name}
                        </Link>
                      </div>
                      <div className="text-xs text-foreground-subtle">{lender.email}</div>
                      <div className="text-numeric text-xs text-foreground-subtle">{lender.phone}</div>
                    </Td>
                    {isAdmin && (
                      <Td dense className="text-foreground-muted">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            lender.active === false ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
                          }`}
                        >
                          {lender.active === false ? 'Inactive' : 'Active'}
                        </span>
                      </Td>
                    )}
                    <Td dense={isAdmin} className="text-numeric text-foreground-muted">
                      {lender.nmlsId}
                    </Td>
                    <Td dense={isAdmin} className="text-foreground-muted">
                      {(lender.licensedStates ?? []).join(', ') || '—'}
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableShell>
      {data && (
        <Pagination
          currentPage={data.page}
          totalItems={data.total}
          pageSize={data.pageSize}
          totalPages={Math.ceil(data.total / data.pageSize)}
          itemLabel="lenders"
        />
      )}
    </div>
  );
}
