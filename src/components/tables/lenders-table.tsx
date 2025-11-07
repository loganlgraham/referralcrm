'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { fetcher } from '@/utils/fetcher';

interface LenderRow {
  _id: string;
  name: string;
  email: string;
  phone: string;
  nmlsId: string;
  licensedStates?: string[];
  team?: string;
  region?: string;
}

export function LendersTable() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const { data, mutate } = useSWR<LenderRow[]>('/api/lenders', fetcher);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    nmlsId: '',
    licensedStates: '',
    team: '',
    region: '',
  });

  if (!data) return <div className="rounded-lg bg-white p-4 shadow-sm">Loading mortgage consultants…</div>;

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
          team: form.team,
          region: form.region,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to create mortgage consultant');
      }

      toast.success('Mortgage consultant added');
      setForm({ name: '', email: '', phone: '', nmlsId: '', licensedStates: '', team: '', region: '' });
      setShowForm(false);
      await mutate();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save mortgage consultant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Add a mortgage consultant</h2>
              <p className="text-xs text-slate-500">Keep the directory up to date so agents can collaborate quickly.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((previous) => !previous)}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showForm ? 'Close' : 'New MC'}
            </button>
          </div>
          {showForm && (
            <form onSubmit={handleCreate} className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Name
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={handleChange('email')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Phone
                <input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                NMLS ID
                <input
                  type="text"
                  value={form.nmlsId}
                  onChange={handleChange('nmlsId')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Licensed states (comma separated)
                <input
                  type="text"
                  value={form.licensedStates}
                  onChange={handleChange('licensedStates')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  placeholder="CO, UT"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Team
                <input
                  type="text"
                  value={form.team}
                  onChange={handleChange('team')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Region
                <input
                  type="text"
                  value={form.region}
                  onChange={handleChange('region')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? 'Saving…' : 'Save MC'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Lender</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">NMLS</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Licensed states</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Team</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Region</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((lender) => (
              <tr key={lender._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">
                    <Link href={`/lenders/${lender._id}`} className="text-brand hover:underline">
                      {lender.name}
                    </Link>
                  </div>
                  <div className="text-xs text-slate-500">{lender.email}</div>
                  <div className="text-xs text-slate-500">{lender.phone}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{lender.nmlsId}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{(lender.licensedStates ?? []).join(', ') || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{lender.team ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{lender.region ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
