import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const requestSchema = z.object({
  description: z.string().trim().min(1).max(600),
});

const responseSchema = z.object({
  zipCodes: z.array(z.string().trim()).optional(),
});

const MAX_ZIP_CODES = 50;

const systemPrompt = `You translate location descriptions into United States postal ZIP codes.
Return JSON with a "zipCodes" array of unique five-digit ZIP code strings that best represent the described coverage area.
Only include ZIP codes that actually serve the locations. If you are unsure, return an empty array.`;

const normalizeZipCode = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) {
    return null;
  }
  return digits.slice(0, 5);
};

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'ZIP code generation is not configured.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json({ error: 'A description of the coverage area is required.' }, { status: 400 });
  }

  const { description } = parsedRequest.data;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'zip_code_suggestions',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                zipCodes: {
                  type: 'array',
                  items: {
                    type: 'string',
                    pattern: '^\\d{5}$',
                  },
                  maxItems: MAX_ZIP_CODES,
                },
              },
              required: ['zipCodes'],
            },
          },
        },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({ description }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error('ZIP code generation failed', payload);
      return NextResponse.json(
        { error: 'Unable to generate ZIP codes right now.' },
        { status: response.status }
      );
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ zipCodes: [] });
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch (error) {
      console.error('ZIP code generation parse error', error);
      return NextResponse.json({ zipCodes: [] });
    }

    const parsedContent = responseSchema.safeParse(candidate);
    const candidateZipCodes = parsedContent.success ? parsedContent.data.zipCodes ?? [] : [];
    const uniqueZipCodes = Array.from(
      new Set(
        candidateZipCodes
          .map((zip) => normalizeZipCode(zip))
          .filter((zip): zip is string => Boolean(zip))
          .slice(0, MAX_ZIP_CODES)
      )
    );

    return NextResponse.json({ zipCodes: uniqueZipCodes });
  } catch (error) {
    console.error('ZIP code generation error', error);
    return NextResponse.json(
      { error: 'Unable to generate ZIP codes right now.' },
      { status: 500 }
    );
  }
}
