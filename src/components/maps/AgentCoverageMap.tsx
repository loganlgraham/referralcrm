'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { CoverageLocation, GeoBounds, GeoPoint } from '@/types/coverage';
import { mergeAndNormalizeZipCodes, mergeCoverageLocations } from '@/utils/coverage';

declare global {
  interface Window {
    google?: { maps?: unknown };
  }
}

type GoogleMaps = NonNullable<NonNullable<typeof window.google>['maps']>;

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

let googleMapsPromise: Promise<GoogleMaps> | null = null;

export const loadGoogleMapsApi = async (): Promise<GoogleMaps> => {
  if (typeof window === 'undefined') {
    throw new Error('Google Maps can only be loaded in the browser.');
  }

  if (window.google?.maps) {
    return window.google.maps as GoogleMaps;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('Google Maps API key is not configured.');
  }

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.google!.maps as GoogleMaps));
        existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Maps')));
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=visualization,places`;
      script.async = true;
      script.defer = true;
      script.dataset.googleMapsLoader = 'true';
      script.addEventListener('load', () => resolve(window.google!.maps as GoogleMaps));
      script.addEventListener('error', () => reject(new Error('Failed to load Google Maps')));
      document.head.appendChild(script);
    });
  }

  return googleMapsPromise;
};

const extractPostalCodes = (components: any[] = []): string[] =>
  mergeAndNormalizeZipCodes(
    components
      .filter((component) => component.types?.includes('postal_code'))
      .map((component) => component.long_name)
  );

const toBounds = (maps: GoogleMaps, bounds?: GeoBounds | null): any | null => {
  if (!bounds) return null;
  const latLngBounds = new (maps as any).LatLngBounds(bounds.southwest, bounds.northeast);
  if (!latLngBounds.isEmpty()) {
    return latLngBounds;
  }
  return null;
};

export const geocodeCoverageLocation = async (
  location: CoverageLocation
): Promise<CoverageLocation> => {
  const maps = await loadGoogleMapsApi();
  const geocoder = new (maps as any).Geocoder();

  return new Promise((resolve, reject) => {
    geocoder.geocode({ address: location.label }, (results: any[], status: string) => {
      if (status !== 'OK' || !results?.[0]) {
        reject(new Error('Unable to validate coverage with Google Maps.'));
        return;
      }

      const [primary] = results;
      const center = primary.geometry.location.toJSON();
      const viewport = primary.geometry.viewport?.toJSON();
      const bounds = primary.geometry.bounds?.toJSON();
      const postalCodes = extractPostalCodes(primary.address_components ?? []);

      resolve({
        label: primary.formatted_address || location.label,
        zipCodes: mergeAndNormalizeZipCodes([...(location.zipCodes ?? []), ...postalCodes]),
        center,
        viewport: viewport ?? undefined,
        bounds: bounds ?? undefined,
        placeId: primary.place_id ?? location.placeId,
      });
    });
  });
};

export const geocodeMissingCoverageLocations = async (
  locations: CoverageLocation[]
): Promise<CoverageLocation[]> => {
  if (locations.length === 0) {
    return [];
  }

  const resolved = await Promise.all(
    locations.map(async (location) => {
      if (location.center) {
        return { ...location, zipCodes: mergeAndNormalizeZipCodes(location.zipCodes ?? []) };
      }
      return geocodeCoverageLocation(location);
    })
  );

  return mergeCoverageLocations([], resolved);
};

interface AgentCoverageMapProps {
  locations: CoverageLocation[];
  className?: string;
  height?: number;
}

export function AgentCoverageMap({ locations, className, height = 360 }: AgentCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [maps, setMaps] = useState<GoogleMaps | null>(null);
  const [map, setMap] = useState<any>(null);
  const overlaysRef = useRef<{ markers: any[]; rectangles: any[] }>({ markers: [], rectangles: [] });

  const geocodedLocations = useMemo(
    () => locations.filter((location) => location.center),
    [locations]
  );

  useEffect(() => {
    loadGoogleMapsApi()
      .then((loadedMaps) => {
        setMaps(loadedMaps);
        if (!map && containerRef.current) {
          const initialCenter = geocodedLocations[0]?.center ?? { lat: 39.5, lng: -98.35 };
          const newMap = new (loadedMaps as any).Map(containerRef.current, {
            center: initialCenter,
            zoom: 4,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
          setMap(newMap);
        }
      })
      .catch((error) => {
        console.error(error);
        setMaps(null);
      });
  }, [geocodedLocations, map]);

  useEffect(() => {
    if (!map || !maps) return;

    overlaysRef.current.markers.forEach((marker) => marker.setMap(null));
    overlaysRef.current.rectangles.forEach((rectangle) => rectangle.setMap(null));
    overlaysRef.current = { markers: [], rectangles: [] };

    const bounds = new (maps as any).LatLngBounds();

    geocodedLocations.forEach((location) => {
      if (!location.center) return;

      const marker = new (maps as any).Marker({
        position: location.center,
        title: location.label,
        map,
      });
      overlaysRef.current.markers.push(marker);
      bounds.extend(location.center as GeoPoint);

      const rectangleBounds = toBounds(maps, location.bounds ?? location.viewport ?? null);
      if (rectangleBounds) {
        const rectangle = new (maps as any).Rectangle({
          bounds: rectangleBounds,
          map,
          fillColor: '#0b365d',
          fillOpacity: 0.12,
          strokeColor: '#0b365d',
          strokeOpacity: 0.6,
          strokeWeight: 1,
        });
        overlaysRef.current.rectangles.push(rectangle);
        bounds.union(rectangleBounds);
      }
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 24);
    } else {
      map.setCenter({ lat: 39.5, lng: -98.35 });
      map.setZoom(4);
    }
  }, [geocodedLocations, map, maps]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500 ${className ?? ''}`}
        style={{ height, minHeight: height }}
      >
        Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable map previews.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height, minHeight: height, borderRadius: '0.75rem', overflow: 'hidden' }}
    />
  );
}
