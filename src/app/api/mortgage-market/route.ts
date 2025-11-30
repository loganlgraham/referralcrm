import { NextResponse } from 'next/server';
import { z } from 'zod';

const today = new Date().toISOString().slice(0, 10);

const briefSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  rateSignals: z.array(z.string().min(1)).min(1),
  coachingAngles: z.array(z.string().min(1)).min(1),
  borrowerAdvice: z.array(z.string().min(1)).min(1),
  caution: z.array(z.string().min(1)).default([]),
  averageRates: z
    .array(
      z.object({
        loanType: z.string().min(1),
        averageRate: z.string().min(1),
        change: z.string().min(1),
      })
    )
    .default([]),
  dataDate: z.string().default(today),
});

const fallbackBrief = {
  headline: 'Mortgage market check-in',
  summary: 'Tap “Refresh insights” to generate a daily coaching brief for agents.',
  rateSignals: [
    'Include today’s context on rate moves and the likely driver (inflation, jobs, bonds, or Fed signals).',
  ],
  coachingAngles: [
    'Offer a concise rate outlook, lock/float guidance, and next steps with the lender partner.',
  ],
  borrowerAdvice: [
    'Clarify budget, documents, and decision timeline before sending to the lender.',
  ],
  caution: ['This feed is informational only. Encourage borrowers to confirm pricing and eligibility with licensed lenders.'],
  averageRates: [
    { loanType: '30-year fixed', averageRate: '6.95%', change: '-0.02%' },
    { loanType: '15-year fixed', averageRate: '6.25%', change: '-0.01%' },
    { loanType: 'FHA 30-year', averageRate: '6.75%', change: '-0.02%' },
    { loanType: 'VA 30-year', averageRate: '6.60%', change: '-0.01%' },
    { loanType: 'Jumbo 30-year', averageRate: '6.80%', change: '0.00%' },
    { loanType: '5/6 ARM', averageRate: '6.35%', change: '+0.01%' },
  ],
  dataDate: today,
};

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(fallbackBrief, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
      },
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'mortgage_market_brief',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                headline: { type: 'string' },
                summary: { type: 'string' },
                rateSignals: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 1,
                },
                coachingAngles: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 1,
                },
                borrowerAdvice: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 1,
                },
                caution: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 0,
                },
                averageRates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      loanType: { type: 'string' },
                      averageRate: { type: 'string' },
                      change: { type: 'string' },
                    },
                    required: ['loanType', 'averageRate', 'change'],
                  },
                  minItems: 1,
                },
                dataDate: { type: 'string' },
              },
              required: [
                'headline',
                'summary',
                'rateSignals',
                'coachingAngles',
                'borrowerAdvice',
                'averageRates',
              ],
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: `You are a US mortgage market strategist. Write concise, confident talking points for real estate agents to use with their referrals. Use today's date (${today}). Avoid giving legal or pricing guarantees.`,
          },
          {
            role: 'user',
            content:
              'Summarize the mortgage market in a short brief: a headline, 2-3 bullet rate or liquidity signals, 2-3 coaching angles for agents, 3 borrower-facing talking points, and any cautions to share. Keep it under 120 words.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error('Mortgage market insights OpenAI error', payload);
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
        },
      });
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
        },
      });
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      console.error('Mortgage market insights parse error', error);
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
        },
      });
    }

    const parsed = briefSchema.safeParse(parsedContent);
    const brief = parsed.success ? parsed.data : fallbackBrief;

    return NextResponse.json(brief, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Mortgage market insights unexpected error', error);
    return NextResponse.json(fallbackBrief, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
      },
    });
  }
}
