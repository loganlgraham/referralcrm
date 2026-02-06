'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { ArrowRightIcon, Loader2Icon, MailIcon, PhoneIcon, SearchIcon, SparklesIcon } from 'lucide-react';

import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatDecimal, formatNumber, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';

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
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-full bg-brand/10 p-2 text-brand">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Find a mortgage consultant</p>
            <p className="text-sm text-slate-600">
              Describe where your borrower needs a licensed mortgage consultant. We’ll surface teammates licensed in that state
              with recent performance so you can pick a partner and launch the referral flow.
            </p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Which state does your borrower need?</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              placeholder="e.g., TX and NM or Colorado"
              disabled={isSearching}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">We’ll check licensing coverage and rank top performers.</p>
            <button
              type="submit"
              disabled={isSearching || isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSearching ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
              {isSearching ? 'Searching...' : 'Find licensed MCs'}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-slate-400">Licensing focus</p>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-700">
              {states.length > 0 ? (
                states.map((state) => (
                  <span key={state} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    {state}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">No states entered yet.</span>
              )}
            </div>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p className="font-semibold text-slate-900">{matchedCountLabel}</p>
            <p className="text-xs text-slate-500">Profiles are read-only—start a referral when you pick your partner.</p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Loading mortgage consultants...
            </div>
          ) : matches.length > 0 ? (
            matches.map((mc) => {
              const metrics = mc.metrics ?? EMPTY_LENDER_METRICS;
              return (
                <div key={mc._id} className="rounded-lg border border-slate-200 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{mc.name}</h2>
                      <p className="text-sm text-slate-600">NMLS {mc.nmlsId || 'pending'}</p>
                      <p className="mt-1 text-xs text-slate-500">Licensed: {(mc.licensedStates ?? []).join(', ') || '—'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={buildGmailComposeUrl(mc.email)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:text-brand"
                      >
                        <MailIcon className="h-4 w-4" />
                        Email
                      </a>
                      {mc.phone && (
                        <a
                          href={`tel:${mc.phone}`}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:text-brand"
                        >
                          <PhoneIcon className="h-4 w-4" />
                          {formatPhoneNumber(mc.phone) || 'Call'}
                        </a>
                      )}
                      <Link
                        href={`/lenders/${mc._id}`}
                        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        View profile
                        <ArrowRightIcon className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/referrals/new`}
                        className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
                      >
                        Start referral
                        <ArrowRightIcon className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 md:grid-cols-4">
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Closings (12 mo)</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(metrics.closingsLast12Months)}</p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Closing rate</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{formatDecimal(metrics.closingRate)}%</p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Total referrals</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(metrics.totalReferrals)}</p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Active pipeline</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(metrics.activePipeline)}</p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Deals closed</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(metrics.dealsClosedAllTime)}</p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">Revenue realized</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(metrics.revenueRealizedCents)}</p>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <p className="text-xs uppercase text-slate-400">NPS</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{metrics.npsScore == null ? '—' : formatDecimal(metrics.npsScore)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              Suggested mortgage consultants will appear here after you run a search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
