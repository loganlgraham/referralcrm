import { geocodeCoverageLabel, GeocodingError } from '@/lib/server/google-geocoding';

describe('geocodeCoverageLabel', () => {
  const originalEnvKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = originalEnvKey;
    jest.restoreAllMocks();
  });

  it('returns normalized geocode data with postal codes', async () => {
    const mockResponse = {
      status: 'OK',
      results: [
        {
          formatted_address: 'Austin, TX, USA',
          place_id: 'place-123',
          geometry: {
            location: { lat: 30.2672, lng: -97.7431 },
            viewport: {
              northeast: { lat: 30.5, lng: -97.4 },
              southwest: { lat: 30.0, lng: -98.0 },
            },
            bounds: {
              northeast: { lat: 30.6, lng: -97.2 },
              southwest: { lat: 29.9, lng: -98.2 },
            },
          },
          address_components: [
            { long_name: '78701', short_name: '78701', types: ['postal_code'] },
            { long_name: '78702', short_name: '78702', types: ['postal_code'] },
          ],
        },
      ],
    };

    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockResponse });

    const result = await geocodeCoverageLabel('Austin');

    expect(result.formattedAddress).toBe('Austin, TX, USA');
    expect(result.placeId).toBe('place-123');
    expect(result.center).toEqual({ lat: 30.2672, lng: -97.7431 });
    expect(result.viewport).toEqual({
      northeast: { lat: 30.5, lng: -97.4 },
      southwest: { lat: 30.0, lng: -98.0 },
    });
    expect(result.bounds).toEqual({
      northeast: { lat: 30.6, lng: -97.2 },
      southwest: { lat: 29.9, lng: -98.2 },
    });
    expect(result.postalCodes).toEqual(['78701', '78702']);
  });

  it('throws a GeocodingError when no results are found', async () => {
    const mockResponse = {
      status: 'ZERO_RESULTS',
      results: [],
      error_message: 'No results found',
    };

    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockResponse });

    const promise = geocodeCoverageLabel('Unknown place');

    await expect(promise).rejects.toThrow(GeocodingError);
    await expect(promise).rejects.toHaveProperty('status', 'ZERO_RESULTS');
  });

  it('propagates quota errors gracefully', async () => {
    const mockResponse = {
      status: 'OVER_QUERY_LIMIT',
      results: [],
      error_message: 'Quota exceeded',
    };

    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockResponse });

    await expect(geocodeCoverageLabel('Austin')).rejects.toThrow('Quota exceeded');
  });

  it('requires an API key', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    await expect(geocodeCoverageLabel('Austin')).rejects.toThrow('Google Maps API key is not configured');
  });
});
