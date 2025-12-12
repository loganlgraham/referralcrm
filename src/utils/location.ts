const stateCache = new Map<string, string>();
const locationZipCache = new Map<string, string[]>();

const extractStateCode = (content: string): string | null => {
  if (!content) return null;
  const match = content.toUpperCase().match(/\b([A-Z]{2})\b/);
  return match?.[1] ?? null;
};

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
