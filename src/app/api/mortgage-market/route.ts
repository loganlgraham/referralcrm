import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type AverageRate = {
  loanType: string;
  averageRate: string;
  change: string;
};

type RateSourceResult = {
  rates: AverageRate[];
  dataDate?: string;
};

const today = new Date().toISOString().slice(0, 10);

const apiNinjasCachePath = '/tmp/api-ninjas-mortgage-rates.json';
const fallbackApiKey = 'TSM1KIhd4UFMkpQat+SHnA==wVYsHgZ6Hz7YxKFB';

const apiNinjasNumber = z.preprocess((value) => {
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}, z.number().optional());

const apiNinjasObjectSchema = z.object({
  date: z.string().optional(),
  last_updated: z.string().optional(),
  thirty_year_fixed: apiNinjasNumber,
  fifteen_year_fixed: apiNinjasNumber,
  thirty_year_fha: apiNinjasNumber,
  thirty_year_va: apiNinjasNumber,
  thirty_year_jumbo: apiNinjasNumber,
  five_one_arm: apiNinjasNumber,
});

const apiNinjasArraySchema = z
  .array(
    z.object({
      product: z.string(),
      rate: apiNinjasNumber,
      type: z.string().optional(),
      term: z.string().optional(),
      date: z.string().optional(),
    })
  )
  .min(1);

type ApiNinjasObjectPayload = z.infer<typeof apiNinjasObjectSchema>;
type ApiNinjasArrayPayload = z.infer<typeof apiNinjasArraySchema>;
type ApiNinjasPayload = ApiNinjasObjectPayload | ApiNinjasArrayPayload;

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

const fallbackRates: AverageRate[] = [
  { loanType: '30-year fixed', averageRate: '—', change: '—' },
  { loanType: '15-year fixed', averageRate: '—', change: '—' },
  { loanType: 'FHA 30-year', averageRate: '—', change: '—' },
  { loanType: 'VA 30-year', averageRate: '—', change: '—' },
  { loanType: 'Jumbo 30-year', averageRate: '—', change: '—' },
  { loanType: '5/6 ARM', averageRate: '—', change: '—' },
];

const fallbackBrief = {
  headline: 'Mortgage market check-in',
  summary:
    'Give agents a quick, confidence-building script: a rate pulse, why it moved, what to tell active clients, and the one action to take today.',
  rateSignals: [
    'Lead with the “why” behind today’s move (inflation prints, bond rally, or Fed commentary) and how it shapes lock/float calls.',
    'Flag notable spread moves (jumbo vs. conforming, ARM vs. fixed) so agents can steer shoppers toward the best-fit product.',
  ],
  coachingAngles: [
    'Share a 2-sentence talk track for buyers: price sensitivity, payment check, and when to lock.',
    'Prompt sellers to consider rate buydowns or concessions to widen the buyer pool.',
    'Ask every prospect if they want a lender warm intro today; make it frictionless.',
  ],
  borrowerAdvice: [
    'Verify max monthly payment comfort, down payment, and timeline before looping in the lender.',
    'Remind borrowers to gather income docs and assets so the lender can quote confidently.',
    'Give a simple “if rates move +/– 0.25%, your payment changes about $15 per $100k” rule of thumb.',
  ],
  caution: [
    'This feed is informational only. Encourage borrowers to confirm pricing and eligibility with licensed lenders.',
    'Avoid quoting rate guarantees; anchor on payment ranges and pre-approval speed.',
  ],
  averageRates: fallbackRates,
  dataDate: today,
};

export const dynamic = 'force-dynamic';

async function readApiNinjasCache(allowStale = false) {
  try {
    const raw = await fs.readFile(apiNinjasCachePath, 'utf8');
    const parsed = JSON.parse(raw) as { date: string; rates: AverageRate[]; dataDate?: string };
    if ((allowStale || parsed.date === today) && parsed.rates?.length) {
      return { rates: parsed.rates, dataDate: parsed.dataDate } as RateSourceResult;
    }
  } catch (error) {
    console.error('ApiNinjas cache read failed', error);
  }
  return null;
}

async function writeApiNinjasCache(payload: RateSourceResult) {
  try {
    await fs.writeFile(
      apiNinjasCachePath,
      JSON.stringify({ date: today, rates: payload.rates, dataDate: payload.dataDate || today }),
      'utf8'
    );
  } catch (error) {
    console.error('ApiNinjas cache write failed', error);
  }
}

function parseApiNinjasRates(data: ApiNinjasPayload): RateSourceResult {
  if (Array.isArray(data)) {
    const rates: AverageRate[] = [];
    const map = [
      { match: /30\s*year\s*fixed/i, loanType: '30-year fixed' },
      { match: /15\s*year\s*fixed/i, loanType: '15-year fixed' },
      { match: /fha/i, loanType: 'FHA 30-year' },
      { match: /va/i, loanType: 'VA 30-year' },
      { match: /jumbo/i, loanType: 'Jumbo 30-year' },
      { match: /arm/i, loanType: '5/6 ARM' },
    ];

    for (const row of data) {
      if (typeof row.rate !== 'number' || Number.isNaN(row.rate)) continue;
      const match = map.find((entry) => entry.match.test(row.product));
      const loanType = match?.loanType ?? row.product;
      rates.push({ loanType, averageRate: `${row.rate.toFixed(2)}%`, change: '—' });
    }

    if (!rates.length) {
      throw new Error('ApiNinjas response missing rate values');
    }

    const rowDate = data.find((row) => row.date)?.date;
    const formattedDate = rowDate ? formatDataDate(rowDate) || rowDate : today;

    return { rates, dataDate: formattedDate };
  }

  const map: { key: keyof ApiNinjasObjectPayload; loanType: string }[] = [
    { key: 'thirty_year_fixed', loanType: '30-year fixed' },
    { key: 'fifteen_year_fixed', loanType: '15-year fixed' },
    { key: 'thirty_year_fha', loanType: 'FHA 30-year' },
    { key: 'thirty_year_va', loanType: 'VA 30-year' },
    { key: 'thirty_year_jumbo', loanType: 'Jumbo 30-year' },
    { key: 'five_one_arm', loanType: '5/6 ARM' },
  ];

  const rates: AverageRate[] = [];

  for (const entry of map) {
    const value = data[entry.key];
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    rates.push({ loanType: entry.loanType, averageRate: `${value.toFixed(2)}%`, change: '—' });
  }

  if (!rates.length) {
    throw new Error('ApiNinjas response missing rate values');
  }

  const rawDate = data.last_updated || data.date;
  const formattedDate = rawDate ? formatDataDate(rawDate) || rawDate : today;

  return { rates, dataDate: formattedDate };
}

async function fetchApiNinjasRates(): Promise<RateSourceResult> {
  const cached = await readApiNinjasCache();
  if (cached) return cached;

  const apiKey = process.env.API_NINJAS_API_KEY || fallbackApiKey;
  const fallbackStale = await readApiNinjasCache(true);

  if (!apiKey) {
    if (fallbackStale) return fallbackStale;
    throw new Error('ApiNinjas API key missing');
  }

  try {
    const response = await fetch('https://api.api-ninjas.com/v1/mortgagerate', {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      if (fallbackStale) return fallbackStale;
      throw new Error(`ApiNinjas mortgage rate request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const parsedObject = apiNinjasObjectSchema.safeParse(payload);
    if (parsedObject.success) {
      const result = parseApiNinjasRates(parsedObject.data);
      await writeApiNinjasCache(result);
      return result;
    }

    const parsedArray = apiNinjasArraySchema.safeParse(payload);
    if (parsedArray.success) {
      const result = parseApiNinjasRates(parsedArray.data);
      await writeApiNinjasCache(result);
      return result;
    }

    if (fallbackStale) return fallbackStale;
    throw new Error('ApiNinjas mortgage rate payload invalid');
  } catch (error) {
    console.error('ApiNinjas fetch failed', error);
    if (fallbackStale) return fallbackStale;
    return { rates: fallbackRates, dataDate: today };
  }
}

function formatDataDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export async function GET() {
  try {
    const apiNinjasRates = await fetchApiNinjasRates();

    const combinedRates: AverageRate[] = [];
    for (const rate of apiNinjasRates?.rates ?? []) {
      if (combinedRates.find((existing) => existing.loanType === rate.loanType)) continue;
      combinedRates.push(rate);
    }

    const rateDataDate =
      apiNinjasRates?.dataDate ||
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (!process.env.OPENAI_API_KEY) {
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      });
    }

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
            content: `You are a US mortgage market strategist. Write concise, confident talking points for real estate agents to use with their referrals. Use today's date (${today}). Avoid giving legal or pricing guarantees. Favor actionable coaching steps that an agent can say or do in the next 12 hours.`,
          },
          {
            role: 'user',
            content:
              'Create a succinct mortgage market brief for agents. Include: a punchy headline, 2-3 bullet rate/liquidity signals tied to lock/float guidance, 2-3 coaching angles (scripts or actions for buyers/sellers/prospects), 3 borrower-facing talking points, and any cautions. Keep it under 120 words.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error('Mortgage market insights OpenAI error', payload);
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      });
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      });
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      console.error('Mortgage market insights parse error', error);
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      });
    }

    const parsed = briefSchema.safeParse(parsedContent);
    const brief = parsed.success ? parsed.data : fallbackBrief;

    const mergedBrief = {
      ...brief,
      averageRates: combinedRates.length ? combinedRates : brief.averageRates,
      dataDate: rateDataDate,
    };

    return NextResponse.json(mergedBrief, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Mortgage market insights unexpected error', error);
    const stale = await readApiNinjasCache(true);
    if (stale?.rates?.length) {
      return NextResponse.json(
        {
          ...fallbackBrief,
          averageRates: stale.rates,
          dataDate: stale.dataDate || fallbackBrief.dataDate,
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
          },
        }
      );
    }

    return NextResponse.json(
      {
        ...fallbackBrief,
        dataDate: fallbackBrief.dataDate,
        averageRates: fallbackBrief.averageRates,
        error: 'Live mortgage rates are temporarily unavailable.',
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
        },
      }
    );
  }
}
