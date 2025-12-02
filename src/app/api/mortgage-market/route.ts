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
const formattedToday = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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

const apiNinjasWeeklySchema = z
  .array(
    z.object({
      week: z.string().optional(),
      data: z
        .object({
          frm_30: apiNinjasNumber,
          frm_15: apiNinjasNumber.optional(),
          fha_30: apiNinjasNumber.optional(),
          va_30: apiNinjasNumber.optional(),
          jumbo_30: apiNinjasNumber.optional(),
          arm_5_1: apiNinjasNumber.optional(),
          week: z.string().optional(),
        })
        .passthrough(),
    })
  )
  .min(1);

type ApiNinjasObjectPayload = z.infer<typeof apiNinjasObjectSchema>;
type ApiNinjasArrayPayload = z.infer<typeof apiNinjasArraySchema>;
type ApiNinjasWeeklyPayload = z.infer<typeof apiNinjasWeeklySchema>;
type ApiNinjasPayload = ApiNinjasObjectPayload | ApiNinjasArrayPayload | ApiNinjasWeeklyPayload;

const briefSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  headlineStories: z
    .array(
      z.object({
        headline: z.string().min(1),
        takeaway: z.string().min(1),
        source: z.string().optional(),
      })
    )
    .optional(),
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
  lastUpdated: z.string().default(formattedToday),
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
    'Agent script for today: “Rates are trending steady. Use the table below as your quote anchor and set expectations that lenders may price a touch differently.”',
  headlineStories: [
    {
      headline: 'Awaiting live market headlines',
      takeaway: 'Tap refresh to pull fresh news. If headlines are unavailable, share what you’re hearing locally about buyer demand and lender pricing.',
    },
  ],
  rateSignals: [
    '30-year fixed and 15-year fixed rates are hovering near recent averages—stable footing for buyers comparing payments.',
    'Government-backed (FHA/VA) options typically price below conventional 30-year rates, helping payment-sensitive buyers qualify.',
    'Jumbo pricing is close to conforming quotes in many cases; ask lenders for both when buyers are near county limits.',
  ],
  coachingAngles: [
    'Agree on a “comfortable payment” today and green-light a lock if quotes land near that target.',
    'Offer a 10-minute buyer huddle to align on payment, closing timeline, and what triggers a lock decision.',
    'Invite weekend shoppers to get documents in order now so the lender can issue an updated approval quickly.',
  ],
  borrowerAdvice: [
    'Share a recent pay stub and asset snapshot with your lender—fast docs keep you ready to lock when pricing looks good.',
    'Expect small differences between lenders; getting a backup quote can sharpen pricing and confidence.',
    'Talk in payments, not just rates: every 0.25% move shifts payment roughly $15 per $100k financed.',
  ],
  caution: ['Educational only—agents should not promise specific rates or terms. Always defer to the lender for pricing.'],
  averageRates: fallbackRates,
  dataDate: formattedToday,
  lastUpdated: formattedToday,
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
    const weeklyRow = (data as ApiNinjasWeeklyPayload)[0];
    if (weeklyRow?.data) {
      const rates: AverageRate[] = [];
      const fieldMap: { key: keyof typeof weeklyRow.data; loanType: string }[] = [
        { key: 'frm_30', loanType: '30-year fixed' },
        { key: 'frm_15', loanType: '15-year fixed' },
        { key: 'fha_30', loanType: 'FHA 30-year' },
        { key: 'va_30', loanType: 'VA 30-year' },
        { key: 'jumbo_30', loanType: 'Jumbo 30-year' },
        { key: 'arm_5_1', loanType: '5/6 ARM' },
      ];

      for (const field of fieldMap) {
        const value = weeklyRow.data[field.key];
        if (typeof value !== 'number' || Number.isNaN(value)) continue;
        rates.push({ loanType: field.loanType, averageRate: `${value.toFixed(2)}%`, change: '—' });
      }

      if (!rates.length) {
        throw new Error('ApiNinjas response missing rate values');
      }

      const rawDate = weeklyRow.data.week || weeklyRow.week;
      const formattedDate = rawDate ? formatDataDate(rawDate) || rawDate : today;

      return { rates, dataDate: formattedDate };
    }

    const products = (data as ApiNinjasArrayPayload).filter((row): row is ApiNinjasArrayPayload[number] => 'product' in row);
    const rates: AverageRate[] = [];
    const map = [
      { match: /30\s*year\s*fixed/i, loanType: '30-year fixed' },
      { match: /15\s*year\s*fixed/i, loanType: '15-year fixed' },
      { match: /fha/i, loanType: 'FHA 30-year' },
      { match: /va/i, loanType: 'VA 30-year' },
      { match: /jumbo/i, loanType: 'Jumbo 30-year' },
      { match: /arm/i, loanType: '5/6 ARM' },
    ];

    for (const row of products) {
      if (typeof row.rate !== 'number' || Number.isNaN(row.rate)) continue;
      const match = map.find((entry) => entry.match.test(row.product));
      const loanType = match?.loanType ?? row.product;
      rates.push({ loanType, averageRate: `${row.rate.toFixed(2)}%`, change: '—' });
    }

    if (!rates.length) {
      throw new Error('ApiNinjas response missing rate values');
    }

    const rowDate = products.find((row) => row.date)?.date;
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

    const parsedWeekly = apiNinjasWeeklySchema.safeParse(payload);
    if (parsedWeekly.success) {
      const result = parseApiNinjasRates(parsedWeekly.data);
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

function deriveRateSignals(rates: AverageRate[], dataDate: string): string[] {
  if (!rates.length) return fallbackBrief.rateSignals;

  const asOf = dataDate ? `as of ${dataDate}` : 'today';
  const parseRate = (value: string) => {
    const parsed = Number.parseFloat(value.replace('%', ''));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const thirty = rates.find((r) => /30-year fixed/i.test(r.loanType));
  const fifteen = rates.find((r) => /15-year fixed/i.test(r.loanType));
  const gov = rates.filter((r) => /(FHA|VA)/i.test(r.loanType));
  const jumbo = rates.find((r) => /Jumbo/i.test(r.loanType));

  const messages: string[] = [];

  if (thirty) {
    messages.push(`30-year fixed is around ${thirty.averageRate} ${asOf}. Use it as your payment anchor in buyer calls.`);
  }

  if (fifteen) {
    const fifteenVal = parseRate(fifteen.averageRate);
    const thirtyVal = thirty ? parseRate(thirty.averageRate) : null;
    if (fifteenVal && thirtyVal) {
      const spread = (thirtyVal - fifteenVal).toFixed(2);
      messages.push(`15-year fixed is lower by ~${spread}% versus 30-year. Position it for buyers with aggressive payoff goals.`);
    } else {
      messages.push(`15-year fixed is posting near ${fifteen.averageRate}; use for buyers prioritizing faster payoff.`);
    }
  }

  if (gov.length) {
    const govMin = gov
      .map((r) => parseRate(r.averageRate))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)[0];
    const thirtyVal = thirty ? parseRate(thirty.averageRate) : null;
    if (govMin) {
      const spread = thirtyVal ? (thirtyVal - govMin).toFixed(2) : '0.25';
      messages.push(`FHA/VA quotes are often below conventional by ~${spread}%. Mention this for payment-sensitive buyers.`);
    }
  }

  if (jumbo && thirty) {
    const jumboVal = parseRate(jumbo.averageRate);
    const thirtyVal = parseRate(thirty.averageRate);
    if (jumboVal && thirtyVal) {
      const spread = (jumboVal - thirtyVal).toFixed(2);
      messages.push(
        `Jumbo vs conforming: spread is about ${spread}% ${asOf}. If buyers are near county limits, ask lenders for both.`
      );
    }
  }

  if (!messages.length) return fallbackBrief.rateSignals;
  return messages.slice(0, 4);
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

    const rateSignals = deriveRateSignals(combinedRates.length ? combinedRates : fallbackRates, rateDataDate);

    if (!process.env.OPENAI_API_KEY) {
      const mergedFallback = {
        ...fallbackBrief,
        rateSignals,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
        lastUpdated: formattedToday,
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
                headlineStories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      headline: { type: 'string' },
                      takeaway: { type: 'string' },
                      source: { type: 'string' },
                    },
                    required: ['headline', 'takeaway'],
                  },
                  minItems: 0,
                },
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
                lastUpdated: { type: 'string' },
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
            content: `You are a US mortgage market strategist. Audience: residential real estate agents (not mortgage brokers or loan officers). Write concise, confident talking points they can deliver to buyers and sellers. Use today's date (${today}). Avoid refinance-only angles unless tied to a move. Avoid legal or pricing guarantees. Favor actionable coaching steps an agent can say or do in the next 12 hours.`,
          },
          {
            role: 'user',
            content:
              'Create a succinct mortgage market brief for agents. Include: a punchy headline, 2-3 bullet rate/liquidity signals tied to lock/float guidance, 2-3 coaching angles (scripts or actions for buyers/sellers/prospects), 3 borrower-facing talking points, up to 2 current mortgage/real-estate headlines with short takeaways (only if you are confident; otherwise leave empty), and any cautions. Keep it under 140 words. Keep the focus on purchase conversations, not refinance pitches. Do not invent headlines—omit them if unsure.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error('Mortgage market insights OpenAI error', payload);
      const mergedFallback = {
        ...fallbackBrief,
        rateSignals,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
        lastUpdated: formattedToday,
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
        rateSignals,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
        lastUpdated: formattedToday,
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
        rateSignals,
        averageRates: combinedRates.length ? combinedRates : fallbackBrief.averageRates,
        dataDate: rateDataDate,
        lastUpdated: formattedToday,
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
      rateSignals: rateSignals.length ? rateSignals : brief.rateSignals,
      headlineStories: brief.headlineStories ?? fallbackBrief.headlineStories,
      lastUpdated: formattedToday,
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
          lastUpdated: formattedToday,
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
        lastUpdated: formattedToday,
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
