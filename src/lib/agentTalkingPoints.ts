import OpenAI from 'openai';

const FALLBACK_TALKING_POINTS = [
  "Rates have been moving, but the good news is that lenders are actively working with buyers to find programs that fit their budget. Let's talk about what payment range makes sense for you.",
  "Inventory is slowly improving in many parts of the country, which means there may be more options for buyers than there were earlier in the year — this could be a good window.",
  "Even in a higher-rate environment, many buyers are finding that owning still makes financial sense long-term. Your lender can walk you through a full cost comparison.",
];

export async function generateTalkingPoints(summary: string): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !summary) return FALLBACK_TALKING_POINTS;

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content:
            'You are helping real estate agents explain housing market trends to clients. Based on the housing market summary below, generate exactly 3 short talking points agents can use with buyers or sellers. Requirements: conversational tone, easy to explain, nationally relevant, do not reference specific cities, do not suggest comparing lenders. Return ONLY a JSON array of 3 strings, no other text.',
        },
        {
          role: 'user',
          content: summary,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return parsed.slice(0, 3).map(String);
    }
    return FALLBACK_TALKING_POINTS;
  } catch {
    return FALLBACK_TALKING_POINTS;
  }
}
