import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const requestSchema = z.object({
  description: z.string().trim().min(1).max(600),
});

const responseSchema = z.object({
  zipCodes: z.array(z.string().trim()).optional(),
  locations: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        zipCodes: z.array(z.string().trim()).optional(),
      })
    )
    .optional(),
});

const MAX_ZIP_CODES = 50;

const systemPrompt = `You translate coverage descriptions into structured U.S. location coverage.
Return JSON with a "locations" array. Each entry must have:
- "label": the primary city, town, or county name that best summarizes the coverage (e.g. "Austin, TX" or "Travis County, TX").
- "zipCodes": an array of unique five-digit ZIP codes that fall within that coverage area.
Also include a top-level "zipCodes" array that contains every unique ZIP code mentioned across all locations. If a location does not map cleanly to specific ZIP codes, omit it instead of guessing.`;

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
    const candidateLocations = parsedContent.success ? parsedContent.data.locations ?? [] : [];
    const normalizedLocations = candidateLocations
      .map((location) => {
        const label = location.label?.trim();
        if (!label) {
          return null;
        }

        const zipCodes = Array.isArray(location.zipCodes) ? location.zipCodes : [];
        const normalizedZipCodes = Array.from(
          new Set(
            zipCodes
              .map((zip) => normalizeZipCode(zip))
              .filter((zip: string | null): zip is string => Boolean(zip))
          )
        );

        if (normalizedZipCodes.length === 0) {
          return null;
        }

        return { label, zipCodes: normalizedZipCodes };
      })
      .filter((location): location is { label: string; zipCodes: string[] } => Boolean(location));

    const candidateZipCodes = parsedContent.success ? parsedContent.data.zipCodes ?? [] : [];
    const combinedZipCodes = normalizedLocations.flatMap((location) => location.zipCodes);
    const allZipCodes = [...candidateZipCodes, ...combinedZipCodes];
    const uniqueZipCodes = Array.from(
      new Set(
        allZipCodes
          .map((zip) => normalizeZipCode(zip))
          .filter((zip: string | null): zip is string => Boolean(zip))
          .slice(0, MAX_ZIP_CODES)
      )
    );

    return NextResponse.json({ zipCodes: uniqueZipCodes, locations: normalizedLocations });
  } catch (error) {
    console.error('ZIP code generation error', error);
    return NextResponse.json(
      { error: 'Unable to generate ZIP codes right now.' },
      { status: 500 }
    );
  }
}
