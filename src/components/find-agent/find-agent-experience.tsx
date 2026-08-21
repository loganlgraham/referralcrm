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
import { buildGmailComposeUrl } from '@/utils/gmail';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Button, buttonClasses } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FieldGroup, FieldLabel } from '@/components/ui/field-group';

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
  const { data: agentsResponse, isLoading } = useSWR<{ items: AgentSuggestion[] }>('/api/agents?all=true', fetcher);
  const agents = agentsResponse?.items ?? [];
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Partner network"
        title={headline}
        description={introCopy}
      />

      <FieldGroup
        title="Suggested agent search"
        description={helperCopy}
        action={
          <span className="rounded-full bg-primary/10 p-1.5 text-primary">
            <SparklesIcon className="h-4 w-4" aria-hidden />
          </span>
        }
      >
        <form onSubmit={handleSearch} className="space-y-4">
          <label className="block space-y-1.5">
            <FieldLabel label={promptLabel} />
            {isAdminVariant ? (
              <Input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={placeholder}
                disabled={isSearching}
              />
            ) : (
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder={placeholder}
                disabled={isSearching}
              />
            )}
          </label>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isLoading}
              loading={isSearching}
              leadingIcon={<SearchIcon className="h-4 w-4" aria-hidden />}
            >
              {isSearching ? 'Searching...' : ctaLabel}
            </Button>
          </div>
        </form>
      </FieldGroup>

      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-eyebrow text-foreground-subtle">Coverage focus</p>
            <div className="mt-1.5 flex flex-wrap gap-2 text-sm text-foreground-muted">
              {derivedCoverageLabels.length > 0 ? (
                derivedCoverageLabels.map((label) => (
                  <span key={label} className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-foreground-muted">
                    <MapPinIcon className="h-3 w-3 text-primary" />
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-sm text-foreground-subtle">No coverage entered yet.</span>
              )}
            </div>
          </div>
          <div className="text-right text-sm text-foreground-muted">
            <p className="font-semibold text-foreground">{matchedCountLabel}</p>
            <p className="text-xs text-foreground-subtle">Profiles are read-only and do not create referrals.</p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
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
                <div key={agent._id} className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
                        {agent.name}
                      </h2>
                      <p className="text-sm text-foreground-muted">{agent.brokerage || 'Brokerage not provided'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <a
                        href={buildGmailComposeUrl(agent.email)}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      >
                        <MailIcon className="h-4 w-4" aria-hidden />
                        Email
                      </a>
                      {agent.phone && (
                        <a
                          href={`tel:${agent.phone}`}
                          className={buttonClasses({
                            variant: 'secondary',
                            size: 'sm',
                            className: 'text-numeric'
                          })}
                        >
                          <PhoneIcon className="h-4 w-4" aria-hidden />
                          {formatPhoneNumber(agent.phone) || 'Call'}
                        </a>
                      )}
                      <Link href={`/agents/${agent._id}`} className={buttonClasses({ size: 'sm' })}>
                        View profile
                        <ArrowRightIcon className="h-4 w-4" aria-hidden />
                      </Link>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                    <span className="inline-flex items-center gap-1 text-foreground-muted">
                      <MapPinIcon className="h-3 w-3 text-primary" aria-hidden />
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

                  <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    <StatTile
                      label="Closings (12 mo)"
                      value={formatNumber(agent.metrics.closingsLast12Months)}
                    />
                    <StatTile
                      label="Closing rate"
                      value={`${formatDecimal(agent.metrics.closingRate)}%`}
                    />
                    <StatTile
                      label="NPS"
                      value={agent.metrics.npsScore == null ? '—' : formatDecimal(agent.metrics.npsScore)}
                    />
                    <StatTile
                      label="Avg response (hrs)"
                      value={
                        agent.metrics.avgResponseHours == null
                          ? '—'
                          : formatDecimal(agent.metrics.avgResponseHours)
                      }
                    />
                    <StatTile label="Total referrals" value={formatNumber(agent.metrics.totalReferrals)} />
                    <StatTile label="Active pipeline" value={formatNumber(agent.metrics.activePipeline)} />
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              icon={<SearchIcon className="h-4 w-4" aria-hidden />}
              title="No suggested agents yet"
              description="Describe the area above and run the search to see partners who cover it."
            />
          )}
        </div>
      </div>
    </div>
  );
}
