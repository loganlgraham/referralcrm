import { zipToState } from '@/utils/location';
import {
  normalizeDealPropertyZipInput,
  type DealPropertyZipSource,
} from '@/utils/deal-property-zip';

export { normalizeDealPropertyZipInput };

export type DealZipBackfillCandidate = {
  _id: string;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyPostalCode?: string | null;
  propertyPostalCodeSource?: DealPropertyZipSource | null;
  updatedAt?: string | Date | null;
};

export type DealZipLookupResult =
  | { status: 'verified'; zip: string; normalizedAddress?: string | null }
  | { status: 'ambiguous'; candidates?: string[] }
  | { status: 'not_found' }
  | { status: 'error'; message?: string };

export type DealZipLookup = (address: {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
}) => Promise<DealZipLookupResult>;

type CensusAddressMatch = {
  matchedAddress?: string | null;
  addressComponents?: {
    zip?: string | null;
  } | null;
};

export type DealZipBackfillPlan =
  | {
      paymentId: string;
      outcome: 'update';
      zip: string;
      source: Extract<DealPropertyZipSource, 'address_extracted' | 'address_verified'>;
      candidate: DealZipBackfillCandidate;
      normalizedAddress?: string | null;
    }
  | {
      paymentId: string;
      outcome: 'skip_existing' | 'unresolved';
      reason?: string;
      candidate: DealZipBackfillCandidate;
    };

export type DealZipBackfillManifestEntry = {
  runId: string;
  paymentId: string;
  previousZip: string | null;
  previousSource: DealPropertyZipSource | null;
  nextZip: string;
  nextSource: DealPropertyZipSource;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  appliedAt: string;
};

const ZIP_IN_TEXT_REGEX = /(?:^|[^\d])(\d{5})(?:-\d{4})?(?!\d)/g;

const normalizeText = (value: string | null | undefined): string =>
  value?.trim().replace(/\s+/g, ' ') ?? '';

const buildAddressKey = (candidate: {
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
}): string =>
  [
    normalizeText(candidate.propertyAddress).toLowerCase(),
    normalizeText(candidate.propertyCity).toLowerCase(),
    normalizeText(candidate.propertyState).toUpperCase(),
  ].join('|');

const isAddressComplete = (candidate: DealZipBackfillCandidate): candidate is DealZipBackfillCandidate & {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
} =>
  Boolean(
    normalizeText(candidate.propertyAddress) &&
      normalizeText(candidate.propertyCity) &&
      /^[A-Za-z]{2}$/.test(normalizeText(candidate.propertyState))
  );

export function extractZipFromPropertyAddress(candidate: {
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
}): { zip: string; source: 'address_extracted' } | null {
  const haystack = [
    candidate.propertyAddress,
    candidate.propertyCity,
    candidate.propertyState,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(', ');
  if (!haystack) {
    return null;
  }

  ZIP_IN_TEXT_REGEX.lastIndex = 0;
  for (const match of haystack.matchAll(ZIP_IN_TEXT_REGEX)) {
    const zip = match[1];
    const normalized = normalizeDealPropertyZipInput(zip);
    if (!normalized.ok || !normalized.zip) {
      continue;
    }
    const state = normalizeText(candidate.propertyState).toUpperCase();
    const zipState = zipToState(normalized.zip);
    if (state && zipState && state !== zipState) {
      continue;
    }
    return { zip: normalized.zip, source: 'address_extracted' };
  }

  return null;
}

export async function resolveDealZipBackfillPlans(
  candidates: DealZipBackfillCandidate[],
  options: { lookup: DealZipLookup }
): Promise<DealZipBackfillPlan[]> {
  const lookupCache = new Map<string, Promise<DealZipLookupResult>>();
  const plans: DealZipBackfillPlan[] = [];

  for (const candidate of candidates) {
      const paymentId = candidate._id;
      const existingZip = normalizeDealPropertyZipInput(candidate.propertyPostalCode ?? null);
      if (existingZip.ok && existingZip.zip) {
        plans.push({ paymentId, outcome: 'skip_existing', candidate });
        continue;
      }

      const extracted = extractZipFromPropertyAddress(candidate);
      if (extracted) {
        plans.push({
          paymentId,
          outcome: 'update',
          zip: extracted.zip,
          source: extracted.source,
          candidate,
        });
        continue;
      }

      if (!isAddressComplete(candidate)) {
        plans.push({ paymentId, outcome: 'unresolved', reason: 'incomplete_address', candidate });
        continue;
      }

      const normalizedCandidate = {
        propertyAddress: normalizeText(candidate.propertyAddress),
        propertyCity: normalizeText(candidate.propertyCity),
        propertyState: normalizeText(candidate.propertyState).toUpperCase(),
      };
      const cacheKey = buildAddressKey(normalizedCandidate);
      let lookupPromise = lookupCache.get(cacheKey);
      if (!lookupPromise) {
        lookupPromise = options.lookup(normalizedCandidate);
        lookupCache.set(cacheKey, lookupPromise);
      }
      const lookupResult = await lookupPromise;

      if (lookupResult.status === 'verified') {
        const normalized = normalizeDealPropertyZipInput(lookupResult.zip);
        if (normalized.ok && normalized.zip) {
          plans.push({
            paymentId,
            outcome: 'update',
            zip: normalized.zip,
            source: 'address_verified',
            candidate,
            normalizedAddress: lookupResult.normalizedAddress ?? null,
          });
          continue;
        }
      }

      const reason =
        lookupResult.status === 'ambiguous'
          ? 'ambiguous_lookup'
          : lookupResult.status === 'not_found'
            ? 'lookup_not_found'
            : 'lookup_error';
      plans.push({ paymentId, outcome: 'unresolved', reason, candidate });
  }

  return plans;
}

export function buildDealZipApplyFilter(candidate: DealZipBackfillCandidate): Record<string, unknown> {
  return {
    _id: candidate._id,
    propertyAddress: candidate.propertyAddress ?? null,
    propertyCity: candidate.propertyCity ?? null,
    propertyState: candidate.propertyState ?? null,
    $or: [{ propertyPostalCode: { $exists: false } }, { propertyPostalCode: null }, { propertyPostalCode: '' }],
  };
}

export function buildDealZipRollbackFilter(entry: DealZipBackfillManifestEntry): Record<string, unknown> {
  return {
    _id: entry.paymentId,
    propertyPostalCode: entry.nextZip,
    propertyPostalCodeSource: entry.nextSource,
  };
}

export async function lookupZipWithCensusGeocoder(address: {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
}): Promise<DealZipLookupResult> {
  const oneLineAddress = `${address.propertyAddress}, ${address.propertyCity}, ${address.propertyState}`;
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', oneLineAddress);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      return { status: 'error', message: `census_http_${response.status}` };
    }

    const payload = (await response.json()) as {
      result?: { addressMatches?: CensusAddressMatch[] | null } | null;
    };
    const matches = Array.isArray(payload.result?.addressMatches)
      ? payload.result.addressMatches
      : [];
    if (matches.length === 0) {
      return { status: 'not_found' };
    }

    const zipByValue = new Map<string, CensusAddressMatch>();
    for (const match of matches) {
      const normalized = normalizeDealPropertyZipInput(match.addressComponents?.zip ?? null);
      if (normalized.ok && normalized.zip) {
        zipByValue.set(normalized.zip, match);
      }
    }

    if (zipByValue.size === 0) {
      return { status: 'not_found' };
    }
    if (zipByValue.size > 1) {
      return { status: 'ambiguous', candidates: Array.from(zipByValue.keys()).sort() };
    }

    const [[zip, match]] = Array.from(zipByValue.entries());
    return {
      status: 'verified',
      zip,
      normalizedAddress: match.matchedAddress ?? null,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'census_lookup_failed',
    };
  }
}
