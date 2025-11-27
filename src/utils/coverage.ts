import { CoverageLocation } from '@/types/coverage';

export const normalizeZipCode = (value: string): string | null => {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) {
    return null;
  }
  return digits.slice(0, 5);
};

export const mergeAndNormalizeZipCodes = (
  values: Iterable<string | null | undefined>
): string[] => {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = typeof value === 'string' ? normalizeZipCode(value) : null;
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique.values());
};

export const mergeCoverageLocations = (
  existing: CoverageLocation[],
  incoming: CoverageLocation[]
): CoverageLocation[] => {
  const merged = new Map<string, CoverageLocation>();

  const upsert = (location: CoverageLocation, overwriteGeometry: boolean) => {
    const key = location.label.toLowerCase();
    const existingLocation = merged.get(key);
    const zipCodes = mergeAndNormalizeZipCodes(location.zipCodes ?? []);
    if (existingLocation) {
      merged.set(key, {
        ...existingLocation,
        ...location,
        zipCodes: mergeAndNormalizeZipCodes([...existingLocation.zipCodes, ...zipCodes]),
        center: overwriteGeometry ? location.center ?? existingLocation.center : existingLocation.center ?? location.center,
        viewport:
          overwriteGeometry || !existingLocation.viewport ? location.viewport ?? existingLocation.viewport : existingLocation.viewport,
        bounds:
          overwriteGeometry || !existingLocation.bounds ? location.bounds ?? existingLocation.bounds : existingLocation.bounds,
        placeId: overwriteGeometry ? location.placeId ?? existingLocation.placeId : existingLocation.placeId ?? location.placeId,
      });
      return;
    }

    merged.set(key, {
      ...location,
      label: location.label,
      zipCodes,
    });
  };

  existing.forEach((location) => upsert(location, false));
  incoming.forEach((location) => upsert(location, true));

  return Array.from(merged.values());
};

export const deriveZipCodes = (locations: CoverageLocation[]): string[] =>
  mergeAndNormalizeZipCodes(
    locations.flatMap((location) => (Array.isArray(location.zipCodes) ? location.zipCodes : []))
  );
