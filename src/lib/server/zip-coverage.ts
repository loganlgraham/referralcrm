import { Types } from 'mongoose';

import { Zip } from '@/models/zip';

export interface CoverageLocationInput {
  label?: string | null;
  zipCodes?: string[] | null;
}

const normalizeZipCode = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) {
    return null;
  }

  return digits.slice(0, 5);
};

const dedupeZipCodes = (values: Iterable<string | null | undefined>): string[] => {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeZipCode(value ?? undefined);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
};

const parseCityState = (label: string): { city: string; state: string } => {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { city: '', state: '' };
  }

  if (parts.length === 1) {
    return { city: parts[0], state: '' };
  }

  const state = parts.pop() ?? '';
  const city = parts.join(', ');
  return { city, state };
};

interface SyncAgentZipCoverageOptions {
  agentId: Types.ObjectId | string;
  coverageLocations?: CoverageLocationInput[];
  explicitZipCodes?: string[];
}

export const syncAgentZipCoverage = async ({
  agentId,
  coverageLocations = [],
  explicitZipCodes = [],
}: SyncAgentZipCoverageOptions): Promise<void> => {
  const normalizedAgentId =
    typeof agentId === 'string' ? new Types.ObjectId(agentId) : agentId;

  const locationZipCodes = coverageLocations.flatMap((location) =>
    Array.isArray(location?.zipCodes) ? location.zipCodes : []
  );

  const zipCodes = dedupeZipCodes([...explicitZipCodes, ...locationZipCodes]);

  const metadata = new Map<string, { city: string; state: string }>();
  coverageLocations.forEach((location) => {
    if (!location?.label) {
      return;
    }

    const parsed = parseCityState(location.label);
    (location.zipCodes ?? []).forEach((zip) => {
      const normalized = normalizeZipCode(zip);
      if (normalized && !metadata.has(normalized)) {
        metadata.set(normalized, parsed);
      }
    });
  });

  try {
    if (zipCodes.length === 0) {
      await Zip.updateMany(
        { agents: normalizedAgentId },
        { $pull: { agents: normalizedAgentId } }
      );
      await Zip.deleteMany({ agents: { $exists: true, $size: 0 } });
      return;
    }

    await Zip.updateMany(
      { agents: normalizedAgentId, code: { $nin: zipCodes } },
      { $pull: { agents: normalizedAgentId } }
    );

    const operations = zipCodes.map((code) => {
      const locationMetadata = metadata.get(code);
      const update: {
        $setOnInsert: { code: string; city: string; state: string };
        $addToSet: { agents: Types.ObjectId };
        $set?: { city?: string; state?: string };
      } = {
        $setOnInsert: {
          code,
          city: locationMetadata?.city ?? '',
          state: locationMetadata?.state ?? '',
        },
        $addToSet: { agents: normalizedAgentId },
      };

      if (locationMetadata?.city || locationMetadata?.state) {
        update.$set = {};
        if (locationMetadata.city) {
          update.$set.city = locationMetadata.city;
        }
        if (locationMetadata.state) {
          update.$set.state = locationMetadata.state;
        }
      }

      return Zip.updateOne({ code }, update, { upsert: true });
    });

    await Promise.all(operations);
    await Zip.deleteMany({ agents: { $exists: true, $size: 0 } });
  } catch (error) {
    console.error('Failed to sync agent ZIP coverage', error);
  }
};

export const mergeAndNormalizeZipCodes = (
  values: Iterable<string | null | undefined>
): string[] => dedupeZipCodes(values);

export const normalizeCoverageLocations = (
  locations: CoverageLocationInput[]
): { label: string; zipCodes: string[] }[] => {
  const uniqueByLabel = new Map<string, { label: string; zipCodes: string[] }>();

  locations.forEach((location) => {
    const label = location?.label?.trim();
    if (!label) {
      return;
    }

    const normalizedZipCodes = dedupeZipCodes(location.zipCodes ?? []);
    if (normalizedZipCodes.length === 0) {
      return;
    }

    const key = label.toLowerCase();
    if (uniqueByLabel.has(key)) {
      const existing = uniqueByLabel.get(key)!;
      const merged = dedupeZipCodes([...existing.zipCodes, ...normalizedZipCodes]);
      uniqueByLabel.set(key, { label: existing.label, zipCodes: merged });
      return;
    }

    uniqueByLabel.set(key, { label, zipCodes: normalizedZipCodes });
  });

  return Array.from(uniqueByLabel.values());
};

export const normalizeZipCodeForStorage = normalizeZipCode;
