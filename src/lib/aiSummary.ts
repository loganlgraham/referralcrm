import OpenAI from 'openai';

const FALLBACK_SUMMARY =
  'The U.S. housing market continues to navigate an environment of higher mortgage rates, with buyers and sellers adjusting to current affordability conditions. Housing inventory levels are gradually shifting, creating opportunities in select price tiers as demand remains relatively stable. Agents should focus on buyer education around payment expectations and overall market direction rather than specific rate levels.';

export async function generateMarketSummary(headlines: string[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || headlines.length === 0) return FALLBACK_SUMMARY;

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You are a housing market analyst writing a short briefing for real estate agents and mortgage professionals. Summarize the current U.S. housing and mortgage market trends in 2–3 concise sentences based on these headlines. Focus on mortgage rates, housing supply, buyer demand, and overall market direction. Keep the summary neutral and nationally relevant. Do not reference specific cities or local markets.',
        },
        {
          role: 'user',
          content: `Headlines:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? FALLBACK_SUMMARY;
  } catch {
    return FALLBACK_SUMMARY;
  }
}
