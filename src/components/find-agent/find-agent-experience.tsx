'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowRightIcon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';

import { fetcher } from '@/utils/fetcher';
import { formatDecimal, formatNumber, formatPhoneNumber } from '@/utils/formatters';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

interface AgentSuggestion {
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
  metrics: {
    closingsLast12Months: number;
    closingRate: number;
    npsScore: number | null;
    avgResponseHours: number | null;
    totalReferrals: number;
    activePipeline: number;
  };
}

interface ZipCodeResponse {
  zipCodes?: string[];
  locations?: CoverageLocation[];
  error?: string;
}

const normalizeZipCode = (zip: string | null | undefined) => {
  if (!zip) return null;
  const digits = zip.replace(/\D/g, '');
  if (digits.length !== 5) return null;
  return digits;
};

const agentCoverageSet = (agent: AgentSuggestion) =>
  new Set(
    [
      ...(Array.isArray(agent.coverageAreas) ? agent.coverageAreas : []),
      ...((agent.coverageLocations ?? []).flatMap((location) => 
        Array.isArray(location?.zipCodes) ? location.zipCodes : []
      ) ?? []),
    ]
      .map((zip) => normalizeZipCode(zip))
      .filter((zip): zip is string => Boolean(zip))
  );

const matchesCoverage = (agent: AgentSuggestion, targetZips: string[]) => {
  if (targetZips.length === 0) return false;
  const coverage = agentCoverageSet(agent);
  return targetZips.some((zip) => coverage.has(zip));
};

const sortMatches = (agents: AgentSuggestion[]) =>
  [...agents].sort((a, b) => {
    if (a.metrics.closingsLast12Months !== b.metrics.closingsLast12Months) {
      return b.metrics.closingsLast12Months - a.metrics.closingsLast12Months;
    }
    if (a.metrics.closingRate !== b.metrics.closingRate) {
      return b.metrics.closingRate - a.metrics.closingRate;
    }
    const aNps = a.metrics.npsScore ?? -Infinity;
    const bNps = b.metrics.npsScore ?? -Infinity;
    if (aNps !== bNps) {
      return bNps - aNps;
    }
    return (a.metrics.avgResponseHours ?? Infinity) - (b.metrics.avgResponseHours ?? Infinity);
  });

export function FindAgentExperience({ variant = 'agent' }: { variant?: 'agent' | 'admin' }) {
  const { data: agents, isLoading } = useSWR<AgentSuggestion[]>('/api/agents', fetcher);
  const [description, setDescription] = useState('');
  const [zipCodes, setZipCodes] = useState<string[]>([]);
  const [locations, setLocations] = useState<CoverageLocation[]>([]);
  const [matches, setMatches] = useState<AgentSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const matchedCountLabel = useMemo(() => {
    if (zipCodes.length === 0) {
      return 'Enter an area to see suggested agents';
    }
    if (matches.length === 0) {
      return 'No agents found for this coverage yet';
    }
    return `${matches.length} agent${matches.length === 1 ? '' : 's'} cover these areas`;
  }, [matches.length, zipCodes.length]);

  const isAdminVariant = variant === 'admin';
  const headline = isAdminVariant ? 'Find an agent' : 'Find Agent';
  const introCopy = isAdminVariant
    ? 'Enter a ZIP, city, county, or state to surface agents who cover the area, ranked by volume, conversion, and responsiveness.'
    : 'Use the Suggested Agent AI search to uncover partners who cover your buyer’s area. Browse profiles to review performance, specialties, and contact details before you reach out.';
  const promptLabel = isAdminVariant ? 'Location to match' : 'Where is your buyer looking?';
  const helperCopy = isAdminVariant
    ? 'We will translate the area into ZIP coverage and rank matching agents by their performance metrics.'
    : 'We’ll translate your notes into ZIP coverage and surface matching agents.';
  const placeholder = isAdminVariant
    ? 'e.g., 98103 or King County WA or Tampa, FL'
    : 'e.g., Austin metro near Round Rock and Cedar Park; open to north San Antonio';
  const ctaLabel = isAdminVariant ? 'Find matching agents' : 'Run Suggested Agent Search';

  const derivedCoverageLabels = useMemo(() => {
    if (locations.length > 0) {
      return locations.map((location) => location.label);
    }
    if (zipCodes.length > 0) {
      return zipCodes;
    }
    return [];
  }, [locations, zipCodes]);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agents || isLoading) {
      return;
    }

    const trimmed = description.trim();
    if (!trimmed) {
      setError('Describe the buyer’s target area to get a suggested agent list.');
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch('/api/coverage/zip-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed }),
      });

      const payload: ZipCodeResponse = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to generate suggested coverage right now.');
      }

      const normalizedZips = Array.from(
        new Set((payload.zipCodes ?? []).map((zip) => normalizeZipCode(zip)).filter((zip): zip is string => Boolean(zip)))
      );

      setZipCodes(normalizedZips);
      setLocations(Array.isArray(payload.locations) ? payload.locations : []);

      const filteredMatches = agents.filter((agent) => matchesCoverage(agent, normalizedZips));
      setMatches(sortMatches(filteredMatches));

      if (filteredMatches.length === 0) {
        setError('No active agents cover that area yet. Try another description or a nearby city.');
      }
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : 'Unable to run the suggested agent search.';
      setError(message);
      setMatches([]);
      setZipCodes([]);
      setLocations([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-full bg-brand/10 p-2 text-brand">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900">{headline}</h1>
            <p className="text-sm text-slate-600">{introCopy}</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">{promptLabel}</span>
            {isAdminVariant ? (
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder={placeholder}
                disabled={isSearching}
              />
            ) : (
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder={placeholder}
                disabled={isSearching}
              />
            )}
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">{helperCopy}</p>
            <button
              type="submit"
              disabled={isSearching || isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSearching ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
              {isSearching ? 'Searching...' : ctaLabel}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-slate-400">Coverage focus</p>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-700">
              {derivedCoverageLabels.length > 0 ? (
                derivedCoverageLabels.map((label) => (
                  <span key={label} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    <MapPinIcon className="h-3 w-3 text-brand" />
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">No coverage entered yet.</span>
              )}
            </div>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p className="font-semibold text-slate-900">{matchedCountLabel}</p>
            <p className="text-xs text-slate-500">Profiles are read-only and do not create referrals.</p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Loading agents...
            </div>
          ) : matches.length > 0 ? (
            matches.map((agent) => {
              const coverageLabels = Array.isArray(agent.coverageLocations) 
                ? agent.coverageLocations.map((location) => location?.label).filter(Boolean)
                : Array.isArray(agent.coverageAreas) 
                  ? agent.coverageAreas 
                  : [];
              return (
                <div key={agent._id} className="rounded-lg border border-slate-200 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold text-slate-900">{agent.name}</h2>
                      <p className="text-sm text-slate-600">{agent.brokerage || 'Brokerage not provided'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 md:justify-end">
                      <a
                        href={`mailto:${agent.email}`}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:text-brand"
                      >
                        <MailIcon className="h-4 w-4" />
                        Email
                      </a>
                      {agent.phone && (
                        <a
                          href={`tel:${agent.phone}`}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:text-brand whitespace-nowrap"
                        >
                          <PhoneIcon className="h-4 w-4" />
                          {formatPhoneNumber(agent.phone) || 'Call'}
                        </a>
                      )}
                      <Link
                        href={`/agents/${agent._id}`}
                        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        View profile
                        <ArrowRightIcon className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium uppercase text-slate-500">
                      <MapPinIcon className="h-3 w-3 text-brand" />
                      {coverageLabels.slice(0, 5).join(', ') || 'Coverage pending'}
                    </span>
                    <span>Licensed: {agent.statesLicensed.join(', ') || '—'}</span>
                    {agent.specialties && agent.specialties.length > 0 && (
                      <span>Specialties: {agent.specialties.join(', ')}</span>
                    )}
                    {agent.languages && agent.languages.length > 0 && (
                      <span>Languages: {agent.languages.join(', ')}</span>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 md:grid-cols-4">
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Closings (12 mo)</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatNumber(agent.metrics.closingsLast12Months)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Closing rate</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatDecimal(agent.metrics.closingRate)}%
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">NPS</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {agent.metrics.npsScore == null ? '—' : formatDecimal(agent.metrics.npsScore)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Avg response (hrs)</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {agent.metrics.avgResponseHours == null
                          ? '—'
                          : formatDecimal(agent.metrics.avgResponseHours)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Total referrals</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatNumber(agent.metrics.totalReferrals)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Active pipeline</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatNumber(agent.metrics.activePipeline)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              Suggested agents will appear here after you run a search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
