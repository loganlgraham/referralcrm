import { radius } from 'zipcodes';

export const NEARBY_ZIP_MILES = 15;

/**
 * ZIPs within the given distance of any referral ZIP, including the ZIPs
 * themselves. Uses a bundled ZIP centroid table; unknown ZIPs only match
 * themselves.
 */
export function zipsWithinMiles(zips: readonly string[], miles: number = NEARBY_ZIP_MILES): string[] {
  const nearby = new Set<string>();
  for (const zip of zips) {
    if (!/^\d{5}$/u.test(zip)) continue;
    nearby.add(zip);
    for (const code of radius(zip, miles)) nearby.add(code);
  }
  return [...nearby].sort();
}
