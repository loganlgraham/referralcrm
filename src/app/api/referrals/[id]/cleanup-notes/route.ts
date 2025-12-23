import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';

interface Params {
  params: { id: string };
}

const requestSchema = z.object({
  notes: z.string().min(1).max(2000),
});

const systemPrompt = `You are a professional writing assistant for a real estate referral platform.
Your job is to clean up and improve notes that will be included in an email to a real estate agent about a new client referral.

Guidelines:
- Keep the message professional, friendly, and concise
- Fix any grammar, spelling, or punctuation errors
- Improve clarity and readability
- Preserve the original intent and all important information
- Do not add information that wasn't in the original
- Keep it brief - these are notes, not a full message
- Return ONLY the cleaned up notes text, no explanations or formatting`;

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const allowedRoles = new Set(['admin', 'manager']);
  if (!allowedRoles.has(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Note cleanup is not configured.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { notes } = parsed.data;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: notes },
        ],
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      console.error('Note cleanup OpenAI error', errorPayload);
      return NextResponse.json(
        { error: 'Failed to clean up notes.' },
        { status: 502 }
      );
    }

    const payload = await response.json();
    const cleanedNotes = payload?.choices?.[0]?.message?.content?.trim();

    if (!cleanedNotes) {
      return NextResponse.json(
        { error: 'No response from cleanup service.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ cleanedNotes });
  } catch (error) {
    console.error('Note cleanup error', error);
    return NextResponse.json(
      { error: 'Failed to clean up notes.' },
      { status: 500 }
    );
  }
}

