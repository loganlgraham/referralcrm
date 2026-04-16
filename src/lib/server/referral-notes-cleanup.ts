const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const NOTE_CLEANUP_MODEL = 'gpt-4o-mini';

const noteCleanupSystemPrompt = `You are a professional writing assistant for a real estate referral platform.
Your job is to clean up and improve notes that will be included in an email to a real estate agent about a new client referral.

Guidelines:
- Keep the message professional, friendly, and concise
- Fix any grammar, spelling, or punctuation errors
- Improve clarity and readability
- Preserve the original intent and all important information
- Do not add information that wasn't in the original
- Keep it brief - these are notes, not a full message
- Return ONLY the cleaned up notes text, no explanations or formatting`;

interface CleanupOptions {
  allowFallbackToOriginal?: boolean;
}

export async function cleanReferralNotes(
  notes: string,
  options: CleanupOptions = {}
): Promise<string> {
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) {
    return '';
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return options.allowFallbackToOriginal ? trimmedNotes : '';
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: NOTE_CLEANUP_MODEL,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: noteCleanupSystemPrompt },
          { role: 'user', content: trimmedNotes }
        ]
      })
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      console.error('Note cleanup OpenAI error', errorPayload);
      return options.allowFallbackToOriginal ? trimmedNotes : '';
    }

    const payload = await response.json();
    const cleanedNotes = payload?.choices?.[0]?.message?.content?.trim();
    if (!cleanedNotes) {
      return options.allowFallbackToOriginal ? trimmedNotes : '';
    }

    return cleanedNotes;
  } catch (error) {
    console.error('Note cleanup error', error);
    return options.allowFallbackToOriginal ? trimmedNotes : '';
  }
}
