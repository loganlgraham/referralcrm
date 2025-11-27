import { mergeAndNormalizeZipCodes } from './zip-coverage';

export class GeocodingError extends Error {
  status?: string;

  constructor(message: string, status?: string) {
    super(message);
    this.name = 'GeocodingError';
    this.status = status;
  }
}

export interface GeocodingResult {
  formattedAddress: string;
  placeId?: string;
  center: { lat: number; lng: number };
  viewport?: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  bounds?: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  postalCodes: string[];
}

interface GoogleGeocodeComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeGeometry {
  location: { lat: number; lng: number };
  viewport?: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } };
  bounds?: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } };
}

interface GoogleGeocodeResult {
  formatted_address: string;
  place_id?: string;
  address_components?: GoogleGeocodeComponent[];
  geometry: GoogleGeocodeGeometry;
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: GoogleGeocodeResult[];
}

const buildUrl = (label: string, apiKey: string): string => {
  const params = new URLSearchParams({ address: label, key: apiKey });
  return `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
};

const extractPostalCodes = (components: GoogleGeocodeComponent[] = []): string[] => {
  const raw = components
    .filter((component) => component.types?.includes('postal_code'))
    .map((component) => component.long_name);
  return mergeAndNormalizeZipCodes(raw);
};

export const geocodeCoverageLabel = async (label: string): Promise<GeocodingResult> => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new GeocodingError('Google Maps API key is not configured');
  }

  const response = await fetch(buildUrl(label, apiKey));
  if (!response.ok) {
    throw new GeocodingError('Failed to query Google Maps Geocoding API');
  }

  const payload = (await response.json()) as GoogleGeocodeResponse;

  if (payload.status !== 'OK') {
    const message = payload.error_message || payload.status;
    throw new GeocodingError(message, payload.status);
  }

  const [primary] = payload.results;
  if (!primary) {
    throw new GeocodingError('No geocoding results found', 'ZERO_RESULTS');
  }

  const center = primary.geometry.location;
  const viewport = primary.geometry.viewport;
  const bounds = primary.geometry.bounds;
  const postalCodes = extractPostalCodes(primary.address_components ?? []);

  return {
    formattedAddress: primary.formatted_address,
    placeId: primary.place_id,
    center,
    viewport,
    bounds,
    postalCodes,
  };
};
