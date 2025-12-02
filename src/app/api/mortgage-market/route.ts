import { NextResponse } from 'next/server';

const today = new Date();
const formattedToday = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fallbackBrief = {
  headline: 'Mortgage market snapshot',
  summary: 'Agent-ready talking points: use the live widget for today\'s quotes, set expectations on lender variance, and speak in payments.',
  headlineStories: [
    {
      headline: 'Refresh to pull current mortgage headlines',
      takeaway: 'Share local color you\'re hearing from your preferred lender on pricing or overlays.',
    },
  ],
  rateSignals: [
    'Use the live widget for today\'s rate anchor—position quotes as lender-specific and subject to change.',
    'Talk payment instead of rate. Each 0.25% shift is roughly $15/mo per $100k financed.',
    'Lock guidance comes from the lender you\'re working with; help buyers prep docs so they can move fast.',
  ],
  coachingAngles: [
    'Open the widget with buyers on calls and frame quotes as lender-specific snapshots.',
    'Ask your lender partner for today\'s payment on a target price so you can speak confidently in showings.',
    'Invite buyers to a quick Q&A on timing, payments, and lock readiness this week.',
  ],
  borrowerAdvice: [
    'Use the widget as a ballpark, then ask your lender for today\'s exact quote and payment.',
    'Have income and asset docs ready so your lender can lock quickly if the payment works.',
    'Compare quotes across lenders if payment is tight—pricing can vary by lender and borrower profile.',
  ],
  caution: ['Informational only—exact quotes and eligibility must come from the lender you\'re working with.'],
  averageRates: [],
  dataDate: formattedToday,
  lastUpdated: formattedToday,
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
        },
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
                rateSignals: { type: 'array', items: { type: 'string' }, minItems: 1 },
                coachingAngles: { type: 'array', items: { type: 'string' }, minItems: 1 },
                borrowerAdvice: { type: 'array', items: { type: 'string' }, minItems: 1 },
                caution: { type: 'array', items: { type: 'string' }, minItems: 0 },
                averageRates: { type: 'array', items: { type: 'string' }, minItems: 0 },
              },
              required: ['headline', 'summary', 'rateSignals', 'coachingAngles', 'borrowerAdvice'],
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: `You are a US mortgage market strategist. Audience: residential real estate agents. Avoid quoting specific rates—tell them to use the Mortgage News Daily widget for live numbers. Keep messaging purchase-focused and defer pricing to the lender they work with. Date: ${formattedToday}.`,
          },
          {
            role: 'user',
            content:
              'Create a succinct mortgage market brief for agents. Include: a punchy headline, 2-3 rate/market signals referencing the live widget for numbers, 2-3 coaching angles (scripts or actions for buyers/sellers/prospects), 3 borrower-facing talking points, up to 2 current mortgage/real-estate headlines with short takeaways (only if confident; otherwise omit), and any cautions. Keep it under 140 words. Keep the focus on purchase conversations, not refinance pitches.',
          },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
        },
      });
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
        },
      });
    }

    const parsed = JSON.parse(content);
    const mergedBrief = {
      ...fallbackBrief,
      ...parsed,
      dataDate: formattedToday,
      lastUpdated: formattedToday,
      averageRates: [],
    };

    return NextResponse.json(mergedBrief, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Mortgage market insights error', error);
    return NextResponse.json(fallbackBrief, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
      },
    });
  }
}
