'use client';

import Link from 'next/link';
import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { fetcher } from '@/utils/fetcher';
import { useCoverageSuggestions } from '@/hooks/use-coverage-suggestions';
import { formatCurrency, formatDecimal, formatPhoneNumber } from '@/utils/formatters';
import {
  AGENT_AHA_CLASSIFICATION_OPTIONS,
  AGENT_LANGUAGE_OPTIONS,
  AGENT_SPECIALTY_OPTIONS,
} from '@/constants/agent-options';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

interface AgentRow {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  brokerage?: string;
  statesLicensed: string[];
  coverageAreas?: string[];
  coverageLocations?: CoverageLocation[];
  specialties?: string[];
  languages?: string[];
  ahaDesignation?: 'AHA' | 'AHA_OOS' | null;
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

type AgentFormState = {
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  brokerage: string;
  states: string;
  coverageDescription: string;
  coverageLocations: CoverageLocation[];
  specialties: string[];
  languages: string[];
  ahaDesignation: '' | 'AHA' | 'AHA_OOS';
};

const createEmptyForm = (): AgentFormState => ({
  name: '',
  email: '',
  phone: '',
  licenseNumber: '',
  brokerage: '',
  states: '',
  coverageDescription: '',
  coverageLocations: [],
  specialties: [],
  languages: [],
  ahaDesignation: '',
});

export function AgentsTable() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  const { data, mutate } = useSWR<AgentRow[]>('/api/agents', fetcher);
  const { suggestions, mutate: mutateSuggestions } = useCoverageSuggestions();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AgentFormState>(() => createEmptyForm());
  const [isGeneratingCoverage, setIsGeneratingCoverage] = useState(false);
  const [coverageProgress, setCoverageProgress] = useState(0);

  useEffect(() => {
    if (!isGeneratingCoverage) {
      return;
    }

    setCoverageProgress((value) => (value < 12 ? 12 : value));
    const interval = window.setInterval(() => {
      setCoverageProgress((value) => {
        if (value >= 88) {
          return 88;
        }
        return value + 4;
      });
    }, 400);

    return () => {
      window.clearInterval(interval);
    };
  }, [isGeneratingCoverage]);

  useEffect(() => {
    if (isGeneratingCoverage || coverageProgress === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCoverageProgress(0);
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isGeneratingCoverage, coverageProgress]);

  const coverageButtonStyles = useMemo<CSSProperties | undefined>(() => {
    if (!isGeneratingCoverage && coverageProgress === 0) {
      return undefined;
    }

    const progress = Math.min(Math.max(coverageProgress, 0), 100);

    return {
      backgroundImage: `linear-gradient(90deg, #0b365d 0%, #0b365d ${progress}%, #0f4c81 ${progress}%, #2f6aa3 100%)`,
      transition: 'background-image 250ms linear',
    };
  }, [coverageProgress, isGeneratingCoverage]);
  const formDisabled = saving;

  const agents = useMemo(() => data ?? [], [data]);

  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading agents…</div>;
  }

  type TextField = Exclude<keyof AgentFormState, 'coverageLocations' | 'specialties' | 'languages'>;

  const handleChange = (field: TextField) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleSelectChange = (field: 'specialties' | 'languages') => (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setForm((previous) => ({ ...previous, [field]: selected }));
  };

  const handleAhaChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((previous) => ({ ...previous, ahaDesignation: event.target.value as AgentFormState['ahaDesignation'] }));
  };

  const normalizeZipCode = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 5) {
      return null;
    }
    return digits.slice(0, 5);
  };

  const deriveZipCodes = (locations: CoverageLocation[]): string[] =>
    Array.from(
      new Set(
        locations.flatMap((location) =>
          (Array.isArray(location.zipCodes) ? location.zipCodes : [])
            .map((zip) => normalizeZipCode(zip))
            .filter((zip: string | null): zip is string => Boolean(zip))
        )
      )
    );

  const mergeCoverageLocations = (
    existing: CoverageLocation[],
    incoming: CoverageLocation[]
  ): CoverageLocation[] => {
    const merged = new Map<string, CoverageLocation>();

    existing.forEach((location) => {
      merged.set(location.label.toLowerCase(), {
        label: location.label,
        zipCodes: Array.from(new Set(location.zipCodes)),
      });
    });

    incoming.forEach((location) => {
      const label = location.label?.trim();
      if (!label) {
        return;
      }

      const normalizedZipCodes = Array.from(
        new Set(
          (Array.isArray(location.zipCodes) ? location.zipCodes : [])
            .map((zip) => normalizeZipCode(zip))
            .filter((zip: string | null): zip is string => Boolean(zip))
        )
      );

      if (normalizedZipCodes.length === 0) {
        return;
      }

      const key = label.toLowerCase();
      const existingLocation = merged.get(key);
      if (existingLocation) {
        merged.set(key, {
          label: existingLocation.label,
          zipCodes: Array.from(new Set([...existingLocation.zipCodes, ...normalizedZipCodes])),
        });
      } else {
        merged.set(key, { label, zipCodes: normalizedZipCodes });
      }
    });

    return Array.from(merged.values());
  };

  const updateCoverageLocations = (updater: (current: CoverageLocation[]) => CoverageLocation[]) => {
    setForm((previous) => ({
      ...previous,
      coverageLocations: updater(previous.coverageLocations),
    }));
  };

  const removeCoverageLocation = (label: string) => {
    const normalized = label.toLowerCase();
    updateCoverageLocations((current) =>
      current.filter((location) => location.label.toLowerCase() !== normalized)
    );
  };

  const addCoverageLocations = (locations: CoverageLocation[]) => {
    updateCoverageLocations((current) => mergeCoverageLocations(current, locations));
  };

  const generateCoverageLocations = async () => {
    const description = form.coverageDescription.trim();
    if (!description) {
      toast.error('Describe the agent’s coverage areas first.');
      return;
    }

    setIsGeneratingCoverage(true);
    setCoverageProgress(12);
    try {
      const response = await fetch('/api/coverage/zip-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Unable to generate ZIP codes');
      }

      const payload = await response.json();
      const receivedLocations = Array.isArray(payload?.locations) ? payload.locations : [];
      const normalizedLocations = receivedLocations
        .map((location: CoverageLocation | null | undefined) => {
          const label = location?.label?.trim() ?? '';
          const zipCodes = Array.from(
            new Set(
              (Array.isArray(location?.zipCodes) ? location.zipCodes : [])
                .map((zip) => normalizeZipCode(zip))
                .filter((zip: string | null): zip is string => Boolean(zip))
            )
          );

          return { label, zipCodes };
        })
        .filter(
          (location: { label: string; zipCodes: string[] }): location is CoverageLocation =>
            Boolean(location.label) && location.zipCodes.length > 0
        );

      if (normalizedLocations.length === 0) {
        const fallbackZipCodes = Array.isArray(payload?.zipCodes) ? payload.zipCodes : [];
        const fallbackLocations = fallbackZipCodes
          .map((zip: string) => normalizeZipCode(zip))
          .filter((zip: string | null): zip is string => Boolean(zip))
          .map((zip: string) => ({ label: zip, zipCodes: [zip] }));

        if (fallbackLocations.length === 0) {
          toast.info('No coverage locations were identified. Try adding more detail.');
          return;
        }

        addCoverageLocations(fallbackLocations);
        toast.success('ZIP codes added as coverage placeholders.');
        return;
      }

      addCoverageLocations(normalizedLocations);

      toast.success('Coverage locations added to the agent.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to generate coverage locations');
    } finally {
      setCoverageProgress(100);
      setIsGeneratingCoverage(false);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    try {
      const statesLicensed = form.states
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const normalizedCoverageLocations = mergeCoverageLocations([], form.coverageLocations);
      const coverageZipCodes = deriveZipCodes(normalizedCoverageLocations);
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
          coverageAreas: coverageZipCodes,
          coverageLocations: normalizedCoverageLocations,
          specialties: form.specialties,
          languages: form.languages,
          ahaDesignation: form.ahaDesignation || null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to create agent');
      }

      toast.success('Agent added');
      setForm(createEmptyForm());
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
                AHA classification
                <select
                  value={form.ahaDesignation}
                  onChange={handleAhaChange}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  disabled={formDisabled}
                >
                  <option value="">Not set</option>
                  {AGENT_AHA_CLASSIFICATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === 'AHA_OOS' ? 'AHA OOS' : option}
                    </option>
                  ))}
                </select>
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
              <div className="md:col-span-2 space-y-2">
                <label
                  htmlFor="new-agent-coverage-description"
                  className="text-xs font-semibold text-slate-600"
                >
                  Areas covered
                </label>
                <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-3">
                  <textarea
                    id="new-agent-coverage-description"
                    value={form.coverageDescription}
                    onChange={handleChange('coverageDescription')}
                    className="w-full flex-1 rounded border border-slate-200 px-3 py-2 text-sm md:min-h-[5.5rem]"
                    placeholder="Describe the neighborhoods, cities, and counties this agent serves"
                    rows={3}
                    disabled={formDisabled || isGeneratingCoverage}
                  />
                  <button
                    type="button"
                    onClick={generateCoverageLocations}
                    className="flex shrink-0 items-center justify-center rounded bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70 md:h-full md:min-h-[5.5rem] md:self-stretch"
                    style={coverageButtonStyles}
                    disabled={formDisabled || isGeneratingCoverage}
                  >
                    {isGeneratingCoverage ? 'Generating…' : 'Save Service Areas'}
                  </button>
                </div>
              </div>
              <div className="md:col-span-2 space-y-2">
                <p className="text-xs font-semibold text-slate-600">Cities, towns & counties</p>
                <div className="flex flex-wrap gap-2">
                  {form.coverageLocations.length === 0 ? (
                    <p className="text-xs text-slate-500">No coverage locations added yet.</p>
                  ) : (
                    form.coverageLocations.map((location) => (
                      <span
                        key={location.label}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        {location.label}
                        <button
                          type="button"
                          onClick={() => removeCoverageLocation(location.label)}
                          className="text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                          aria-label={`Remove ${location.label}`}
                          disabled={formDisabled}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="md:col-span-2 grid gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Specialties
                  <select
                    multiple
                    value={form.specialties}
                    onChange={handleSelectChange('specialties')}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                    size={6}
                    disabled={formDisabled}
                  >
                    {AGENT_SPECIALTY_OPTIONS.map((specialty) => (
                      <option key={specialty} value={specialty}>
                        {specialty}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    Hold Ctrl (Windows) or Command (Mac) to select multiple specialties.
                  </span>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Languages spoken
                  <select
                    multiple
                    value={form.languages}
                    onChange={handleSelectChange('languages')}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                    size={5}
                    disabled={formDisabled}
                  >
                    {AGENT_LANGUAGE_OPTIONS.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    Hold Ctrl (Windows) or Command (Mac) to select multiple languages.
                  </span>
                </label>
              </div>
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
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">AHA</th>
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
                <td className="px-4 py-3 text-sm text-slate-700">
                  {agent.ahaDesignation === 'AHA'
                    ? 'AHA'
                    : agent.ahaDesignation === 'AHA_OOS'
                    ? 'AHA OOS'
                    : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{agent.statesLicensed.join(', ') || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {(() => {
                    const labels =
                      Array.isArray(agent.coverageLocations) && agent.coverageLocations.length > 0
                        ? agent.coverageLocations.map((location) => location.label)
                        : agent.coverageAreas ?? [];
                    return labels.slice(0, 5).join(', ') || '—';
                  })()}
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
