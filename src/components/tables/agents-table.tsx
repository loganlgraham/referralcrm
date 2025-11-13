'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useId, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { fetcher } from '@/utils/fetcher';
import { useCoverageSuggestions } from '@/hooks/use-coverage-suggestions';
import { formatCurrency, formatDecimal, formatPhoneNumber } from '@/utils/formatters';

interface AgentRow {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  brokerage?: string;
  statesLicensed: string[];
  coverageAreas?: string[];
  metrics: {
    closingsLast12Months: number;
    closingRate: number;
    avgResponseHours: number | null;
    npsScore: number | null;
    totalReferralFeesPaidCents: number;
    totalNetIncomeCents: number;
    totalReferrals: number;
    activePipeline: number;
    averageReferralFeePaidCents: number | null;
    averageCommissionPercent: number | null;
  };
  npsScore?: number | null;
}

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  licenseNumber: '',
  brokerage: '',
  states: '',
  coverage: '',
};

export function AgentsTable() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  const { data, mutate } = useSWR<AgentRow[]>('/api/agents', fetcher);
  const { suggestions, mutate: mutateSuggestions } = useCoverageSuggestions();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const datalistId = useId();

  const formDisabled = saving;

  const agents = useMemo(() => data ?? [], [data]);

  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading agents…</div>;
  }

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

      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          licenseNumber: form.licenseNumber,
          brokerage: form.brokerage,
          statesLicensed,
          coverageAreas,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to create agent');
      }

      toast.success('Agent added');
      setForm(EMPTY_FORM);
      setShowForm(false);
      await mutate();
      await mutateSuggestions();
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
                  disabled={formDisabled}
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
                  disabled={formDisabled}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Phone
                <input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={formDisabled}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                License number
                <input
                  type="text"
                  value={form.licenseNumber}
                  onChange={handleChange('licenseNumber')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={formDisabled}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Brokerage
                <input
                  type="text"
                  value={form.brokerage}
                  onChange={handleChange('brokerage')}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={formDisabled}
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
                  disabled={formDisabled}
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
                  list={datalistId}
                  disabled={formDisabled}
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={formDisabled}
                  className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? 'Saving…' : 'Save agent'}
                </button>
              </div>
            </form>
          )}
          {suggestions.length > 0 && (
            <datalist id={datalistId}>
              {suggestions.map((suggestion) => (
                <option key={suggestion.id} value={suggestion.value} />
              ))}
            </datalist>
          )}
        </div>
      )}

      {isAdmin && suggestions.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Saved coverage suggestions</h3>
              <p className="text-xs text-slate-500">Click a suggestion to remove it from the list.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(`/api/agents/coverage-suggestions/${suggestion.id}`, {
                      method: 'DELETE'
                    });
                    if (!response.ok && response.status !== 204) {
                      throw new Error('Unable to delete suggestion');
                    }
                    await mutateSuggestions();
                    toast.success('Suggestion removed');
                  } catch (error) {
                    console.error(error);
                    toast.error('Unable to delete suggestion');
                  }
                }}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                {suggestion.value}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Agent</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">License</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Brokerage</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">States</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Areas covered</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Closings (12mo)</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Closing %</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">NPS</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Avg response</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral fees paid</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Net income</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.map((agent) => (
              <tr key={agent._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">
                    <Link href={`/agents/${agent._id}`} className="text-brand hover:underline">
                      {agent.name}
                    </Link>
                  </div>
                  <div className="text-xs text-slate-500">
                    <a href={`mailto:${agent.email}`} className="text-brand hover:underline">
                      {agent.email}
                    </a>
                  </div>
                  <div className="text-xs text-slate-500">{formatPhoneNumber(agent.phone) || '—'}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.licenseNumber || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.brokerage || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.statesLicensed.join(', ') || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {(agent.coverageAreas ?? []).slice(0, 5).join(', ') || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.metrics.closingsLast12Months}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {(() => {
                    const closingRate = formatDecimal(agent.metrics.closingRate);
                    return closingRate === '—' ? '—' : `${closingRate}%`;
                  })()}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.metrics.npsScore ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {agent.metrics.avgResponseHours == null
                    ? '—'
                    : `${formatDecimal(agent.metrics.avgResponseHours)} hrs`}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {formatCurrency(agent.metrics.totalReferralFeesPaidCents)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {formatCurrency(agent.metrics.totalNetIncomeCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
