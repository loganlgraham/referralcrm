'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { fetcher } from '@/utils/fetcher';

interface AgentRow {
  _id: string;
  name: string;
  email: string;
  phone: string;
  statesLicensed: string[];
  zipCoverage?: string[];
  coverageAreas?: string[];
  closings12mo: number;
  closingRatePercentage?: number | null;
  npsScore?: number;
  avgResponseHours?: number;
}

export function AgentsTable() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const { data, mutate } = useSWR<AgentRow[]>('/api/agents', fetcher);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    states: '',
    coverage: '',
    closings: '',
    closingRate: '',
    nps: '',
    avgResponse: '',
  });

  if (!data) return <div className="rounded-lg bg-white p-4 shadow-sm">Loading agents…</div>;

  const handleChange = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const statesLicensed = form.states
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const coverageAreas = form.coverage
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const closings12mo = form.closings ? Number.parseInt(form.closings, 10) : 0;
      const closingRatePercentage = form.closingRate ? Number.parseFloat(form.closingRate) : null;
      const npsScore = form.nps ? Number.parseFloat(form.nps) : null;
      const avgResponseHours = form.avgResponse ? Number.parseFloat(form.avgResponse) : null;

      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          statesLicensed,
          coverageAreas,
          closings12mo,
          closingRatePercentage,
          npsScore,
          avgResponseHours,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to create agent');
      }

      toast.success('Agent added');
      setForm({
        name: '',
        email: '',
        phone: '',
        states: '',
        coverage: '',
        closings: '',
        closingRate: '',
        nps: '',
        avgResponse: '',
      });
      setShowForm(false);
      await mutate();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save agent');
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
              <h2 className="text-sm font-semibold text-slate-800">Add an agent</h2>
              <p className="text-xs text-slate-500">Create directory entries for new signups so teams can assign referrals.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((previous) => !previous)}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showForm ? 'Close' : 'New agent'}
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
                States (comma separated)
                <input
                  type="text"
                  value={form.states}
                  onChange={handleChange('states')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  placeholder="CO, UT"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Areas covered (comma separated)
                <input
                  type="text"
                  value={form.coverage}
                  onChange={handleChange('coverage')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Denver, 80202"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Closings last 12 mo
                <input
                  type="number"
                  min="0"
                  value={form.closings}
                  onChange={handleChange('closings')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Closing %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.closingRate}
                  onChange={handleChange('closingRate')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                NPS
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.nps}
                  onChange={handleChange('nps')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Avg response (hrs)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.avgResponse}
                  onChange={handleChange('avgResponse')}
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
                  {saving ? 'Saving…' : 'Save agent'}
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
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Agent</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">States</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Areas covered</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Closings (12mo)</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Closing %</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">NPS</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Avg response</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((agent) => (
              <tr key={agent._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">
                    <Link href={`/agents/${agent._id}`} className="text-brand hover:underline">
                      {agent.name}
                    </Link>
                  </div>
                  <div className="text-xs text-slate-500">{agent.email}</div>
                  <div className="text-xs text-slate-500">{agent.phone}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.statesLicensed.join(', ')}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {(agent.coverageAreas ?? agent.zipCoverage ?? []).slice(0, 5).join(', ') || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.closings12mo}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {agent.closingRatePercentage !== undefined && agent.closingRatePercentage !== null
                    ? `${agent.closingRatePercentage}%`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.npsScore ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {agent.avgResponseHours ? `${agent.avgResponseHours} hrs` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
}
