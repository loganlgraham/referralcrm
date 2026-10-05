import { describe, expect, it } from '@jest/globals';
import { parseNetworkList, serializeNetworkList } from '@/utils/network-filter';

describe('parseNetworkList', () => {
  it('treats missing, ALL, and unrecognized values as all networks', () => {
    expect(parseNetworkList(null)).toEqual([]);
    expect(parseNetworkList(undefined)).toEqual([]);
    expect(parseNetworkList('')).toEqual([]);
    expect(parseNetworkList('ALL')).toEqual([]);
    expect(parseNetworkList('AFC,bogus')).toEqual([]);
  });

  it('parses a single network', () => {
    expect(parseNetworkList('AGIT')).toEqual(['AGIT']);
  });

  it('dedupes, trims, drops unknown values, and returns canonical order', () => {
    expect(parseNetworkList(' AGIT, AHA ,AHA,nope,AHA_OOS')).toEqual(['AHA', 'AHA_OOS', 'AGIT']);
  });
});

describe('serializeNetworkList', () => {
  it('serializes an empty list to ALL', () => {
    expect(serializeNetworkList([])).toBe('ALL');
  });

  it('serializes in canonical order regardless of selection order', () => {
    expect(serializeNetworkList(['AHA_OOS', 'AHA'])).toBe('AHA,AHA_OOS');
    expect(serializeNetworkList(['AGIT', 'AHA_OOS', 'AHA'])).toBe('AHA,AHA_OOS,AGIT');
  });

  it('round-trips through parseNetworkList', () => {
    expect(parseNetworkList(serializeNetworkList(['AGIT', 'AHA']))).toEqual(['AHA', 'AGIT']);
  });
});
