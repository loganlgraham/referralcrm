import {
  buildDealZipApplyFilter,
  buildDealZipRollbackFilter,
  extractZipFromPropertyAddress,
  lookupZipWithCensusGeocoder,
  normalizeDealPropertyZipInput,
  resolveDealZipBackfillPlans,
  type DealZipBackfillCandidate,
  type DealZipBackfillManifestEntry,
} from '@/lib/server/deal-property-zip-backfill';

const makeCandidate = (
  overrides: Partial<DealZipBackfillCandidate> = {}
): DealZipBackfillCandidate => ({
  _id: 'payment-1',
  propertyAddress: '123 Main St',
  propertyCity: 'Denver',
  propertyState: 'CO',
  propertyPostalCode: null,
  propertyPostalCodeSource: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('deal property ZIP backfill helpers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes five-digit ZIPs and ZIP+4 values without losing leading zeros', () => {
    expect(normalizeDealPropertyZipInput('01234')).toEqual({ ok: true, zip: '01234' });
    expect(normalizeDealPropertyZipInput(' 01234-5678 ')).toEqual({ ok: true, zip: '01234' });
    expect(normalizeDealPropertyZipInput('')).toEqual({ ok: true, zip: null });
    expect(normalizeDealPropertyZipInput(null)).toEqual({ ok: true, zip: null });
  });

  it('rejects invalid ZIP text without padding or numeric coercion', () => {
    expect(normalizeDealPropertyZipInput('1234')).toEqual({
      ok: false,
      reason: 'invalid_zip',
    });
    expect(normalizeDealPropertyZipInput('123456')).toEqual({
      ok: false,
      reason: 'invalid_zip',
    });
    expect(normalizeDealPropertyZipInput('ABCDE')).toEqual({
      ok: false,
      reason: 'invalid_zip',
    });
  });

  it('extracts an embedded ZIP+4 from the deal property address', () => {
    expect(
      extractZipFromPropertyAddress({
        propertyAddress: '50 Memorial Dr, Cambridge, MA 02142-1314',
        propertyCity: 'Cambridge',
        propertyState: 'MA',
      })
    ).toEqual({
      zip: '02142',
      source: 'address_extracted',
    });
  });

  it('does not extract a ZIP when the embedded ZIP conflicts with the deal state', () => {
    expect(
      extractZipFromPropertyAddress({
        propertyAddress: '50 Memorial Dr, Cambridge, MA 90210',
        propertyCity: 'Cambridge',
        propertyState: 'MA',
      })
    ).toBeNull();
  });

  it('deduplicates normalized address lookups across separate deals', async () => {
    const lookup = jest.fn().mockResolvedValue({
      status: 'verified',
      zip: '80202',
      normalizedAddress: '1701 Wynkoop St, Denver, CO 80202',
    });
    const plans = await resolveDealZipBackfillPlans(
      [
        makeCandidate({ _id: 'payment-1', propertyAddress: '1701 Wynkoop St' }),
        makeCandidate({ _id: 'payment-2', propertyAddress: ' 1701  Wynkoop St ' }),
      ],
      { lookup }
    );

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(plans.map((plan) => plan.outcome)).toEqual(['update', 'update']);
    expect(plans.map((plan) => plan.zip)).toEqual(['80202', '80202']);
  });

  it('skips existing manual ZIPs and unresolved incomplete addresses', async () => {
    const lookup = jest.fn();
    const plans = await resolveDealZipBackfillPlans(
      [
        makeCandidate({
          _id: 'manual',
          propertyPostalCode: '01234',
          propertyPostalCodeSource: 'manual',
        }),
        makeCandidate({
          _id: 'missing-city',
          propertyAddress: '123 Main St',
          propertyCity: null,
        }),
      ],
      { lookup }
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(plans).toEqual([
      expect.objectContaining({ paymentId: 'manual', outcome: 'skip_existing' }),
      expect.objectContaining({ paymentId: 'missing-city', outcome: 'unresolved', reason: 'incomplete_address' }),
    ]);
  });

  it('leaves conflicting or ambiguous lookup matches unresolved', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValueOnce({ status: 'ambiguous', candidates: ['80202', '80203'] })
      .mockResolvedValueOnce({ status: 'not_found' });
    const plans = await resolveDealZipBackfillPlans(
      [
        makeCandidate({ _id: 'ambiguous', propertyAddress: '123 Main St' }),
        makeCandidate({ _id: 'not-found', propertyAddress: '999 Missing Rd' }),
      ],
      { lookup }
    );

    expect(plans).toEqual([
      expect.objectContaining({ paymentId: 'ambiguous', outcome: 'unresolved', reason: 'ambiguous_lookup' }),
      expect.objectContaining({ paymentId: 'not-found', outcome: 'unresolved', reason: 'lookup_not_found' }),
    ]);
  });

  it('builds an apply filter that refuses address changes and populated ZIPs', () => {
    const candidate = makeCandidate({ _id: 'payment-1', updatedAt: '2026-01-02T00:00:00.000Z' });
    expect(buildDealZipApplyFilter(candidate)).toEqual({
      _id: 'payment-1',
      propertyAddress: '123 Main St',
      propertyCity: 'Denver',
      propertyState: 'CO',
      $or: [{ propertyPostalCode: { $exists: false } }, { propertyPostalCode: null }, { propertyPostalCode: '' }],
    });
  });

  it('builds a rollback filter that preserves later manual edits', () => {
    const entry: DealZipBackfillManifestEntry = {
      runId: 'run-1',
      paymentId: 'payment-1',
      previousZip: null,
      previousSource: null,
      nextZip: '80202',
      nextSource: 'address_verified',
      propertyAddress: '1701 Wynkoop St',
      propertyCity: 'Denver',
      propertyState: 'CO',
      appliedAt: '2026-01-02T00:00:00.000Z',
    };

    expect(buildDealZipRollbackFilter(entry)).toEqual({
      _id: 'payment-1',
      propertyPostalCode: '80202',
      propertyPostalCodeSource: 'address_verified',
    });
  });

  it('returns a verified ZIP from a single Census geocoder match', async () => {
    global.fetch = jest.fn() as typeof fetch;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              matchedAddress: '1701 WYNKOOP ST, DENVER, CO, 80202',
              addressComponents: { zip: '80202' },
            },
          ],
        },
      }),
    } as Response);

    await expect(
      lookupZipWithCensusGeocoder({
        propertyAddress: '1701 Wynkoop St',
        propertyCity: 'Denver',
        propertyState: 'CO',
      })
    ).resolves.toEqual({
      status: 'verified',
      zip: '80202',
      normalizedAddress: '1701 WYNKOOP ST, DENVER, CO, 80202',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('geocoding.geo.census.gov/geocoder/locations/onelineaddress'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('treats multiple Census ZIP matches as ambiguous', async () => {
    global.fetch = jest.fn() as typeof fetch;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            { addressComponents: { zip: '80202' } },
            { addressComponents: { zip: '80203' } },
          ],
        },
      }),
    } as Response);

    await expect(
      lookupZipWithCensusGeocoder({
        propertyAddress: '123 Main St',
        propertyCity: 'Denver',
        propertyState: 'CO',
      })
    ).resolves.toEqual({
      status: 'ambiguous',
      candidates: ['80202', '80203'],
    });
  });

  it('returns not_found when Census has no matches', async () => {
    global.fetch = jest.fn() as typeof fetch;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { addressMatches: [] } }),
    } as Response);

    await expect(
      lookupZipWithCensusGeocoder({
        propertyAddress: '999 Missing Rd',
        propertyCity: 'Denver',
        propertyState: 'CO',
      })
    ).resolves.toEqual({ status: 'not_found' });
  });
});
