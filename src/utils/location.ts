const stateCache = new Map<string, string>();
const locationZipCache = new Map<string, string[]>();
const zipExpansionCache = new Map<string, string[]>();

const stateNameToCode: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  NEW_HAMPSHIRE: 'NH',
  NEW_JERSEY: 'NJ',
  NEW_MEXICO: 'NM',
  NEW_YORK: 'NY',
  NORTH_CAROLINA: 'NC',
  NORTH_DAKOTA: 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  RHODE_ISLAND: 'RI',
  SOUTH_CAROLINA: 'SC',
  SOUTH_DAKOTA: 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  WEST_VIRGINIA: 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  DISTRICT_OF_COLUMBIA: 'DC'
};

const extractStateCode = (content: string): string | null => {
  if (!content) return null;
  const match = content.toUpperCase().match(/\b([A-Z]{2})\b/);
  return match?.[1] ?? null;
};

export function normalizeStateInput(location: string): string | null {
  if (!location) return null;
  const upper = location.toUpperCase();
  if (stateNameToCode[upper]) {
    return stateNameToCode[upper];
  }

  const condensed = upper.replace(/[^A-Z]/g, ' ').trim();
  if (stateNameToCode[condensed.replace(/\s+/g, '_')]) {
    return stateNameToCode[condensed.replace(/\s+/g, '_')];
  }

  if (/^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  return null;
}

export async function inferStateFromPostalCode(postalCode: string): Promise<string | null> {
  const trimmed = postalCode.trim();
  if (!trimmed) {
    return null;
  }

  const zip = trimmed.slice(0, 5);
  const cached = stateCache.get(zip);
  if (cached) {
    return cached;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 12,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise assistant that maps U.S. ZIP codes to their two-letter state abbreviation. Reply with only the two-letter state code.',
          },
          {
            role: 'user',
            content: `ZIP: ${zip}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';
    const state = extractStateCode(content);
    if (state) {
      stateCache.set(zip, state);
    }
    return state ?? null;
  } catch (error) {
    console.error('Failed to infer state from ZIP', error);
    return null;
  }
}

export async function inferZipCodesFromLocation(location: string): Promise<string[]> {
  const trimmed = location.trim();
  if (!trimmed) {
    return [];
  }

  const cached = locationZipCache.get(trimmed.toLowerCase());
  if (cached) {
    return cached;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 64,
        messages: [
          {
            role: 'system',
            content:
              'You return a short, comma-separated list of relevant 5-digit U.S. ZIP codes that match a city, state, county, or ZIP description.'
          },
          {
            role: 'user',
            content: `Location: ${trimmed}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';
    const codes = content
      .split(/[,\s]+/)
      .map((entry: string) => entry.trim())
      .filter((entry: string) => /^\d{5}$/.test(entry));

    if (codes.length > 0) {
      locationZipCache.set(trimmed.toLowerCase(), codes);
    }

    return codes;
  } catch (error) {
    console.error('Failed to infer ZIPs from location', error);
    return [];
  }
}

/**
 * Expands a list of ZIP codes by finding all ZIP codes within 25 miles using OpenAI
 */
export async function expandZipCodesBy25Miles(zipCodes: string[]): Promise<string[]> {
  if (zipCodes.length === 0) {
    return [];
  }

  // Normalize and dedupe input ZIP codes
  const normalizedZips = Array.from(
    new Set(
      zipCodes
        .map((zip) => zip.trim())
        .filter((zip) => /^\d{5}$/.test(zip))
    )
  );

  if (normalizedZips.length === 0) {
    return [];
  }

  // Create cache key from sorted ZIP codes
  const cacheKey = normalizedZips.sort().join(',');
  const cached = zipExpansionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return normalizedZips;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 512,
        messages: [
          {
            role: 'system',
            content:
              'You are a geographic assistant that finds U.S. ZIP codes within a 25-mile radius of given ZIP codes. Return a comma-separated list of all unique 5-digit ZIP codes that are within 25 miles of any of the provided ZIP codes, including the original ZIP codes themselves. Only return valid 5-digit ZIP codes.',
          },
          {
            role: 'user',
            content: `Find all ZIP codes within 25 miles of these ZIP codes: ${normalizedZips.join(', ')}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Failed to expand ZIP codes by 25 miles');
      return normalizedZips;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';
    const codes = content
      .split(/[,\s]+/)
      .map((entry: string) => entry.trim())
      .filter((entry: string) => /^\d{5}$/.test(entry));

    // Combine original ZIPs with expanded ones and dedupe
    const allZips = Array.from(new Set([...normalizedZips, ...codes]));

    if (allZips.length > 0) {
      zipExpansionCache.set(cacheKey, allZips);
    }

    return allZips;
  } catch (error) {
    console.error('Failed to expand ZIP codes by 25 miles', error);
    return normalizedZips;
  }
}
