import OpenAI from 'openai';

const FALLBACK_POST =
  "The housing market continues to evolve, and staying informed is one of the best things buyers and sellers can do right now. Inventory, rates, and demand are all shifting in ways that create real opportunities for those who are prepared. If you're thinking about making a move, let's connect — navigating today's market is exactly what I'm here to help you do. #RealEstate #HousingMarket #HomeBuying";

export async function generateSocialPost(brief: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !brief) return FALLBACK_POST;

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content:
            'Write a short professional social media post summarizing the housing market update below. The tone should help a real estate agent demonstrate expertise and provide value to their network. Keep it nationally relevant, avoid referencing specific cities, and do not mention comparing lenders. Limit to 3–5 sentences and include light professional tone suitable for LinkedIn. End with 2–3 relevant hashtags. Return only the post text, no extra explanation.',
        },
        {
          role: 'user',
          content: brief,
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? FALLBACK_POST;
  } catch {
    return FALLBACK_POST;
  }
}
