import { NextResponse } from 'next/server';
import { z } from 'zod';

const scalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const requestSchema = z.object({
  entity: z.string().min(1),
  headers: z.array(z.string().min(1)).min(1),
  rows: z.array(z.record(scalarValue)).min(1).max(50)
});

const assistantResponseSchema = z.object({
  mappingSuggestions: z.record(z.string()).optional(),
  rowIssues: z
    .array(
      z.object({
        rowIndex: z.number().nonnegative(),
        message: z.string().min(1)
      })
    )
    .optional(),
  standardizedRows: z.array(z.record(scalarValue)).optional(),
  notes: z.array(z.string()).optional()
});

const DEFAULT_RESPONSE = {
  mappingSuggestions: {} as Record<string, string>,
  rowIssues: [] as { rowIndex: number; message: string }[],
  standardizedRows: [] as Record<string, string>[],
  notes: [] as string[]
};

const toStringValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
};

const systemPrompt = `You are an import assistant for a CRM platform.
Given an entity type, a list of column headers, and sample rows from an uploaded spreadsheet,
return JSON that:
- Suggests the best CRM field for each column header when possible.
- Flags any sample rows that appear malformed, incomplete, or inconsistent with the entity type.
- Provides standardized versions of the sample rows with formatted phone numbers (E.164) and
  normalized addresses (title case street, city, state abbreviations, ZIP codes).
- Adds short actionable notes about assumptions or recommendations.
Only return JSON that matches the provided schema.`;

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Import assistant is not configured.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request.', details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const { entity, headers, rows } = parsedBody.data;
  const sampleRows = rows.map((row) => {
    const normalized: Record<string, string> = {};
    headers.forEach((header) => {
      normalized[header] = toStringValue(row[header]);
    });
    return normalized;
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'import_assistant_response',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mappingSuggestions: {
                  type: 'object',
                  additionalProperties: { type: 'string' }
                },
                rowIssues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      rowIndex: { type: 'integer', minimum: 0 },
                      message: { type: 'string' }
                    },
                    required: ['rowIndex', 'message']
                  }
                },
                standardizedRows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: { type: 'string' }
                  }
                },
                notes: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: [],
              additionalProperties: false
            }
          }
        },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              entity,
              headers,
              sampleRows
            })
          }
        ]
      })
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      console.error('Import assistant OpenAI error', errorPayload);
      return NextResponse.json(
        { error: 'Unable to generate assistant insights.' },
        { status: response.status }
      );
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(DEFAULT_RESPONSE);
    }

    const candidate = JSON.parse(content);
    const assistantData = assistantResponseSchema.safeParse(candidate);

    if (!assistantData.success) {
      return NextResponse.json(DEFAULT_RESPONSE);
    }

    const data = assistantData.data;

    const normalizedIssues = (data.rowIssues ?? []).map((issue) => ({
      rowIndex: Math.max(0, Math.min(Math.round(issue.rowIndex), sampleRows.length - 1)),
      message: issue.message
    }));

    const normalizedStandardizedRows = (data.standardizedRows ?? [])
      .slice(0, sampleRows.length)
      .map((row, index) => {
        const normalized: Record<string, string> = {};
        headers.forEach((header) => {
          const value = Object.prototype.hasOwnProperty.call(row, header)
            ? row[header]
            : sampleRows[index][header];
          normalized[header] = toStringValue(value);
        });
        return normalized;
      });

    return NextResponse.json({
      mappingSuggestions: data.mappingSuggestions ?? {},
      rowIssues: normalizedIssues,
      standardizedRows: normalizedStandardizedRows,
      notes: data.notes ?? []
    });
  } catch (error) {
    console.error('Import assistant error', error);
    return NextResponse.json(
      { error: 'Unable to generate assistant insights.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
