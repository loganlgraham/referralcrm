'use client';

import Link from 'next/link';
import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState, useCallback, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Pagination } from '@/components/tables/pagination';
import { fetcher } from '@/utils/fetcher';

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

  if (!data) return <div className="rounded-md bg-surface-raised p-4 shadow-sm">Loading mortgage consultants…</div>;

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
        className="flex items-center gap-1 text-left"
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
              <button
                type="button"
                onClick={handleSendWelcomeEmail}
                disabled={sendingWelcome}
                className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sendingWelcome ? 'Sending…' : 'Send welcome email'}
              </button>
              <button
                type="button"
                onClick={() => setLastCreatedLender(null)}
                className="rounded border border-border px-4 py-2 text-sm font-semibold text-foreground-muted hover:bg-surface-muted"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && !hasExternalControl && (
        <div className="rounded-lg border border-dashed border-border-strong bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Add a mortgage consultant</h2>
              <p className="text-xs text-foreground-subtle">Keep the directory up to date so agents can collaborate quickly.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((previous) => !previous)}
              className="rounded border border-border-strong px-3 py-1 text-xs font-semibold text-foreground-muted hover:bg-surface-subtle"
            >
              {showForm ? 'Close' : 'New MC'}
            </button>
          </div>
          {showForm && (
            <form onSubmit={handleCreate} className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-foreground-muted">
                Name
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={handleChange('email')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                Phone
                <input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                NMLS ID
                <input
                  type="text"
                  value={form.nmlsId}
                  onChange={handleChange('nmlsId')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                Licensed states (comma separated)
                <input
                  type="text"
                  value={form.licensedStates}
                  onChange={handleChange('licensedStates')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  placeholder="CO, UT"
                  disabled={saving}
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? 'Saving…' : 'Save MC'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {isAdmin && showForm && hasExternalControl && (
        <form onSubmit={handleCreate} className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-foreground-muted">
              Name
              <input
                type="text"
                value={form.name}
                onChange={handleChange('name')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                required
                disabled={saving}
              />
            </label>
            <label className="text-xs font-semibold text-foreground-muted">
              Email
              <input
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                required
                disabled={saving}
              />
            </label>
            <label className="text-xs font-semibold text-foreground-muted">
              Phone
              <input
                type="tel"
                value={form.phone}
                onChange={handleChange('phone')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                disabled={saving}
              />
            </label>
            <label className="text-xs font-semibold text-foreground-muted">
              NMLS ID
              <input
                type="text"
                value={form.nmlsId}
                onChange={handleChange('nmlsId')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                disabled={saving}
              />
            </label>
            <label className="text-xs font-semibold text-foreground-muted">
              Licensed states (comma separated)
              <input
                type="text"
                value={form.licensedStates}
                onChange={handleChange('licensedStates')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                placeholder="CO, UT"
                disabled={saving}
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? 'Saving…' : 'Save MC'}
              </button>
            </div>
          </div>
        </form>
      )}
      {isAdmin && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="block flex-1 text-xs font-semibold text-foreground-muted">
            Search
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              disabled={isPending}
              className="mt-2 w-full max-w-2xl rounded-lg border border-border px-4 py-3 text-base shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Name, email, phone, NMLS ID"
            />
          </label>
          <label className="text-xs font-semibold text-foreground-muted">
            Status
            <select
              value={activeFilter}
              onChange={(event) => updateParams({ activeFilter: event.target.value })}
              disabled={isPending}
              className="mt-2 block rounded border border-border bg-surface-raised px-3 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
      )}
      <div className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Lender" sortKey="name" />
              </th>
              {isAdmin && (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Status
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="NMLS" sortKey="nmls" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                <SortableHeader label="Licensed states" sortKey="states" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedLenders.map((lender) => (
              <tr key={lender._id} className="hover:bg-surface-muted">
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  <div className="font-medium text-foreground">
                    <Link href={`/lenders/${lender._id}`} className="text-primary hover:underline">
                      {lender.name}
                    </Link>
                  </div>
                  <div className="text-xs text-foreground-subtle">{lender.email}</div>
                  <div className="text-xs text-foreground-subtle">{lender.phone}</div>
                </td>
              {isAdmin && (
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      lender.active === false ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
                    }`}
                  >
                    {lender.active === false ? 'Inactive' : 'Active'}
                  </span>
                </td>
              )}
              <td className="px-4 py-3 text-sm text-foreground-muted">{lender.nmlsId}</td>
              <td className="px-4 py-3 text-sm text-foreground-muted">{(lender.licensedStates ?? []).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
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
