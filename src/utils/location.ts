const stateCache = new Map<string, string>();

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
