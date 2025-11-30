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

const pmmsSources = [
  { url: 'https://www.freddiemac.com/pmms/docs/pmms30_history.csv', loanType: '30-year fixed' },
  { url: 'https://www.freddiemac.com/pmms/docs/pmms15_history.csv', loanType: '15-year fixed' },
];

function formatDataDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function fetchPmmsCsvRate(url: string) {
  const response = await fetch(url, { next: { revalidate: 3600 } });
  if (!response.ok) throw new Error('PMMS CSV unavailable');

  const csv = await response.text();
  const rows = csv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const lastRow = rows[rows.length - 1];
  const [date, averageRate] = lastRow.split(',').map((entry) => entry.trim());

  if (!date || !averageRate) throw new Error('PMMS CSV missing fields');

  const formattedRate = `${Number.parseFloat(averageRate).toFixed(2)}%`;
  const dataDate = formatDataDate(date) ?? date;

  return { rate: formattedRate, dataDate };
}

async function fetchFreddieMacRates(): Promise<RateSourceResult> {
  const rates: AverageRate[] = [];
  let dataDate: string | undefined;

  for (const source of pmmsSources) {
    try {
      const { rate, dataDate: date } = await fetchPmmsCsvRate(source.url);
      rates.push({ loanType: source.loanType, averageRate: rate, change: '—' });
      dataDate = dataDate ?? date;
    } catch (error) {
      console.error('PMMS source failed', source.url, error);
    }
  }

  if (!rates.length) {
    throw new Error('Unable to parse PMMS rates');
  }

  return { rates, dataDate };
}

async function fetchBankrateRates(): Promise<RateSourceResult> {
  const response = await fetch('https://www.bankrate.com/mortgages/mortgage-rates/', {
    next: { revalidate: 3600 },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ReferralCRM/1.0; +https://referralcrm.com)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error('Bankrate page unavailable');
  }

  const html = await response.text();

  const rates: AverageRate[] = [];

  const captureFromJson = () => {
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
    if (!nextDataMatch?.[1]) return;
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const collected: AverageRate[] = [];

      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }

        const entry = value as Record<string, unknown>;
        const label = (entry.productName || entry.loanType || entry.name) as string | undefined;
        const rateValue = (entry.interestRate || entry.rate || entry.avgRate || entry.averageRate) as
          | string
          | number
          | undefined;

        const addEntry = (loanTypeLabel: string, rateCandidate: string | number | undefined) => {
          if (!rateCandidate) return;
          const numeric = Number.parseFloat(String(rateCandidate));
          if (Number.isNaN(numeric)) return;
          collected.push({ loanType: loanTypeLabel, averageRate: `${numeric.toFixed(2)}%`, change: '—' });
        };

        if (label && /FHA/i.test(label)) addEntry('FHA 30-year', rateValue);
        if (label && /VA/i.test(label)) addEntry('VA 30-year', rateValue);
        if (label && /Jumbo/i.test(label)) addEntry('Jumbo 30-year', rateValue);
        if (label && /(ARM|Adjustable)/i.test(label)) addEntry('5/6 ARM', rateValue);

        Object.values(entry).forEach(visit);
      };

      visit(data);
      return collected;
    } catch (error) {
      console.error('Bankrate NEXT_DATA parse failed', error);
      return undefined;
    }
  };

  const jsonRates = captureFromJson();
  if (jsonRates?.length) {
    rates.push(...jsonRates);
  }

  const extractRate = (label: string) => {
    const pattern = new RegExp(`${label}[^0-9]*([0-9]+\\.[0-9]+)%`, 'i');
    const match = html.match(pattern);
    return match?.[1] ? `${match[1]}%` : undefined;
  };

  const addRate = (loanType: string, label: string) => {
    if (rates.find((rate) => rate.loanType === loanType)) return;
    const rate = extractRate(label);
    if (rate) {
      rates.push({ loanType, averageRate: rate, change: '—' });
    }
  };

  addRate('FHA 30-year', 'FHA mortgage rate');
  addRate('VA 30-year', 'VA mortgage rate');
  addRate('Jumbo 30-year', 'Jumbo mortgage rate');
  addRate('5/6 ARM', 'ARM');

  const dataDateMatch = html.match(/Rates last updated[^A-Za-z]*(\w+ \d{1,2}, \d{4})/i);
  const dataDate = dataDateMatch?.[1];

  if (!rates.length) {
    throw new Error('Unable to parse Bankrate rates');
  }

  return { rates, dataDate };
}

export async function GET() {
  try {
    const [pmmsResult, bankrateResult] = await Promise.allSettled([
      fetchFreddieMacRates(),
      fetchBankrateRates(),
    ]);

    const pmmsRates = pmmsResult.status === 'fulfilled' ? pmmsResult.value : null;
    const bankrateRates = bankrateResult.status === 'fulfilled' ? bankrateResult.value : null;

    const rateSources: AverageRate[] = [
      ...(pmmsRates?.rates ?? []),
      ...(bankrateRates?.rates ?? []),
    ];

    const rateDataDate =
      bankrateRates?.dataDate ||
      pmmsRates?.dataDate ||
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (!process.env.OPENAI_API_KEY) {
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: rateSources.length ? rateSources : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
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
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: rateSources.length ? rateSources : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
        },
      });
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: rateSources.length ? rateSources : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
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
      const mergedFallback = {
        ...fallbackBrief,
        averageRates: rateSources.length ? rateSources : fallbackBrief.averageRates,
        dataDate: rateDataDate,
      };

      return NextResponse.json(mergedFallback, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600',
        },
      });
    }

    const parsed = briefSchema.safeParse(parsedContent);
    const brief = parsed.success ? parsed.data : fallbackBrief;

    const mergedBrief = {
      ...brief,
      averageRates: rateSources.length ? rateSources : brief.averageRates,
      dataDate: rateDataDate,
    };

    return NextResponse.json(mergedBrief, {
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
