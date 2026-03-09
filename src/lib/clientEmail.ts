import OpenAI from 'openai';

export type ClientEmail = {
  subject: string;
  body: string;
};

const FALLBACK_EMAIL: ClientEmail = {
  subject: 'A Quick Housing Market Update for You',
  body: `Hi [Client Name],\n\nI wanted to share a brief update on the housing market as we continue working together.\n\nMortgage rates and housing conditions are always shifting, and staying informed helps us make the best decisions at the right time. The national market is seeing gradual changes in inventory and buyer activity, which creates both opportunities and considerations depending on your goals.\n\nHere are a few key points worth knowing:\n\n- Inventory levels are shifting in many markets, which may create more options for buyers\n- Payment planning is key — your lender can help model out what different rate scenarios mean for your monthly budget\n- Market conditions can vary, and timing decisions based on your personal situation is always more important than trying to time the market perfectly\n\nLet's talk soon about how the current environment affects your specific situation. I'm here to help you navigate it.\n\nWarm regards,\n[Your Name]`,
};

export async function generateClientEmail(
  brief: string,
  talkingPoints: string[]
): Promise<ClientEmail> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !brief) return FALLBACK_EMAIL;

  const client = new OpenAI({ apiKey });

  const context = `Daily Market Brief:\n${brief}\n\nKey Talking Points:\n${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content:
            'Write a short client-friendly email summarizing the housing market update below. Tone should be professional but approachable. Avoid specific local markets. Do not reference comparing lenders. Keep the email concise and informative. Use [Client Name] and [Your Name] as placeholders. Return ONLY a JSON object with keys "subject" (string) and "body" (string, with \\n for line breaks). No markdown, no code fences.',
        },
        {
          role: 'user',
          content: context,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
      return { subject: parsed.subject, body: parsed.body };
    }
    return FALLBACK_EMAIL;
  } catch {
    return FALLBACK_EMAIL;
  }
}
