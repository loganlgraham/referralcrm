export type NetworkOption = 'AHA' | 'AHA_OOS' | 'AGIT';

export const NETWORK_OPTIONS: readonly NetworkOption[] = ['AHA', 'AHA_OOS', 'AGIT'];

const NETWORK_OPTION_SET = new Set<string>(NETWORK_OPTIONS);

const isNetworkOption = (value: string): value is NetworkOption => NETWORK_OPTION_SET.has(value);

/**
 * Parses a comma-separated network list (e.g. `AHA,AHA_OOS`) into a deduped
 * list in canonical order. Returns an empty list for "all networks": a missing
 * value, `ALL`, or a value with no recognized networks.
 */
export function parseNetworkList(raw: string | null | undefined): NetworkOption[] {
  if (!raw) return [];
  const requested = new Set(
    raw
      .split(',')
      .map((part) => part.trim())
      .filter(isNetworkOption)
  );
  return NETWORK_OPTIONS.filter((option) => requested.has(option));
}

/** Inverse of `parseNetworkList`; an empty list serializes to `ALL`. */
export function serializeNetworkList(networks: readonly NetworkOption[]): string {
  const selected = new Set(networks);
  const ordered = NETWORK_OPTIONS.filter((option) => selected.has(option));
  return ordered.length === 0 ? 'ALL' : ordered.join(',');
}
