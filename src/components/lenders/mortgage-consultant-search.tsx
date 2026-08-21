'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { ArrowRightIcon, Loader2Icon, MailIcon, PhoneIcon, SearchIcon, SparklesIcon } from 'lucide-react';

import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatDecimal, formatNumber, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { Button, buttonClasses } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';

interface MortgageConsultant {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  nmlsId?: string;
  licensedStates?: string[];
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

const EMPTY_LENDER_METRICS = {
  closingsLast12Months: 0,
  closingRate: 0,
  totalReferrals: 0,
  activePipeline: 0,
  dealsClosedAllTime: 0,
  revenueRealizedCents: 0,
  npsScore: null as number | null,
};

const STATE_MAP: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  NEW_HAMPSHIRE: 'NH',
  NEW_JERSEY: 'NJ',
  NEW_MEXICO: 'NM',
  NEW_YORK: 'NY',
  NORTH_CAROLINA: 'NC',
  NORTH_DAKOTA: 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  RHODE_ISLAND: 'RI',
  SOUTH_CAROLINA: 'SC',
  SOUTH_DAKOTA: 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  WEST_VIRGINIA: 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  DISTRICT_OF_COLUMBIA: 'DC',
};

const normalizeStateTokens = (description: string) => {
  const tokens = description
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const states = new Set<string>();

  tokens.forEach((token) => {
    if (token.length === 2 && STATE_MAP[token]) {
      states.add(token);
      return;
    }
    const mapped = STATE_MAP[token];
    if (mapped) {
      states.add(mapped);
    }
  });

  return Array.from(states);
};

const sortConsultants = (consultants: MortgageConsultant[]) =>
  [...consultants].sort((a, b) => {
    const aMetrics = a.metrics ?? {
      closingsLast12Months: 0,
      closingRate: 0,
      npsScore: null,
      activePipeline: 0,
    };
    const bMetrics = b.metrics ?? {
      closingsLast12Months: 0,
      closingRate: 0,
      npsScore: null,
      activePipeline: 0,
    };

    if (aMetrics.closingsLast12Months !== bMetrics.closingsLast12Months) {
      return bMetrics.closingsLast12Months - aMetrics.closingsLast12Months;
    }
    if (aMetrics.closingRate !== bMetrics.closingRate) {
      return bMetrics.closingRate - aMetrics.closingRate;
    }
    const aNps = aMetrics.npsScore ?? -Infinity;
    const bNps = bMetrics.npsScore ?? -Infinity;
    if (aNps !== bNps) {
      return bNps - aNps;
    }
    return (bMetrics.activePipeline ?? 0) - (aMetrics.activePipeline ?? 0);
  });

export function MortgageConsultantSearch() {
  const { data: session } = useSession();
  const isAgent = session?.user?.role === 'agent';
  const { data: consultants, isLoading } = useSWR<MortgageConsultant[]>('/api/lenders', fetcher);
  const [description, setDescription] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [matches, setMatches] = useState<MortgageConsultant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const matchedCountLabel = useMemo(() => {
    if (states.length === 0) {
      return 'Enter a state to see suggested consultants';
    }
    if (matches.length === 0) {
      return 'No mortgage consultants found for that licensing region yet';
    }
    return `${matches.length} consultant${matches.length === 1 ? '' : 's'} licensed here`;
  }, [matches.length, states.length]);

  if (!isAgent) {
    return null;
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!consultants || isLoading) return;

    const parsedStates = normalizeStateTokens(description);
    if (parsedStates.length === 0) {
      setError('List at least one state (or abbreviation) to check licensing coverage.');
      return;
    }

    setIsSearching(true);
    setError(null);
    setStates(parsedStates);

    const filtered = consultants.filter((consultant) => {
      const licensed = consultant.licensedStates ?? [];
      return parsedStates.some((state) => licensed.includes(state));
    });

    if (filtered.length === 0) {
      setError('No mortgage consultants are licensed in that area yet. Try another nearby state.');
      setMatches([]);
      setIsSearching(false);
      return;
    }

    setMatches(sortConsultants(filtered));
    setIsSearching(false);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-full bg-primary/10 p-2 text-primary">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <p className="font-display text-sm font-semibold tracking-[-0.02em] text-foreground">Find a mortgage consultant</p>
            <p className="text-sm text-foreground-muted">
              Describe where your borrower needs a licensed mortgage consultant. We’ll surface teammates licensed in that state
              with recent performance so you can pick a partner and launch the referral flow.
            </p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Which state does your borrower need?</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="e.g., TX and NM or Colorado"
              disabled={isSearching}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground-subtle">We’ll check licensing coverage and rank top performers.</p>
            <Button
              type="submit"
              disabled={isLoading}
              loading={isSearching}
              leadingIcon={<SearchIcon className="h-4 w-4" />}
            >
              {isSearching ? 'Searching...' : 'Find licensed MCs'}
            </Button>
          </div>
        </form>
      </div>

      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-eyebrow text-foreground-subtle">Licensing focus</p>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-foreground-muted">
              {states.length > 0 ? (
                states.map((state) => (
                  <span key={state} className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-foreground-muted">
                    {state}
                  </span>
                ))
              ) : (
                <span className="text-sm text-foreground-subtle">No states entered yet.</span>
              )}
            </div>
          </div>
          <div className="text-right text-sm text-foreground-muted">
            <p className="font-semibold text-foreground">{matchedCountLabel}</p>
            <p className="text-xs text-foreground-subtle">Profiles are read-only—start a referral when you pick your partner.</p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="mt-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Loading mortgage consultants...
            </div>
          ) : matches.length > 0 ? (
            matches.map((mc) => {
              const metrics = mc.metrics ?? EMPTY_LENDER_METRICS;
              return (
                <div key={mc._id} className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">{mc.name}</h2>
                      <p className="text-sm text-foreground-muted">
                        NMLS <span className="text-numeric">{mc.nmlsId || 'pending'}</span>
                      </p>
                      <p className="mt-1 text-xs text-foreground-subtle">Licensed: {(mc.licensedStates ?? []).join(', ') || '—'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={buildGmailComposeUrl(mc.email)}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      >
                        <MailIcon className="h-4 w-4" />
                        Email
                      </a>
                      {mc.phone && (
                        <a href={`tel:${mc.phone}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                          <PhoneIcon className="h-4 w-4" />
                          <span className="text-numeric">{formatPhoneNumber(mc.phone) || 'Call'}</span>
                        </a>
                      )}
                      <Link href={`/lenders/${mc._id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                        View profile
                        <ArrowRightIcon className="h-4 w-4" />
                      </Link>
                      <Link href={`/referrals/new`} className={buttonClasses({ size: 'sm' })}>
                        Start referral
                        <ArrowRightIcon className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                    <StatTile label="Closings (12 mo)" value={formatNumber(metrics.closingsLast12Months)} />
                    <StatTile label="Closing rate" value={`${formatDecimal(metrics.closingRate)}%`} />
                    <StatTile label="Total referrals" value={formatNumber(metrics.totalReferrals)} />
                    <StatTile label="Active pipeline" value={formatNumber(metrics.activePipeline)} />
                    <StatTile label="Deals closed" value={formatNumber(metrics.dealsClosedAllTime)} />
                    <StatTile label="Revenue realized" value={formatCurrency(metrics.revenueRealizedCents)} />
                    <StatTile
                      label="NPS"
                      value={metrics.npsScore == null ? '—' : formatDecimal(metrics.npsScore)}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              title="No suggestions yet"
              description="Suggested mortgage consultants will appear here after you run a search."
            />
          )}
        </div>
      </div>
    </div>
  );
}
