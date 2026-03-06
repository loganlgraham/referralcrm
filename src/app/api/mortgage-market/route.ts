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

    const systemPrompt = `You are a US mortgage market strategist writing a daily brief for residential real estate agents.
Today is ${formattedToday}.

Search the web for today's top mortgage and housing market news. Then produce a JSON object with EXACTLY these keys:
- headline: string — a punchy 8-12 word summary of today's rate/market story
- summary: string — 2 sentences: what's happening and why agents should care
- headlineStories: array of 3 objects, each with { headline: string, takeaway: string, source: string } — real news stories you found, with headline (the actual story title), a one-sentence agent-specific takeaway, and the publication name as source
- rateSignals: array of 3 strings — rate/market signals referencing the live Mortgage News Daily widget for exact numbers (never quote specific rates yourself)
- coachingAngles: array of 3 strings — specific scripts or actions agents can use TODAY based on the news stories you found. Each tip must directly reference something from the headlines (e.g. "Given that [news thing], tell buyers...")
- borrowerAdvice: array of 3 strings — plain-language talking points agents can use word-for-word with buyers
- caution: array of 1 string — a brief disclaimer

Rules:
- Never quote a specific interest rate number
- Keep focus on purchase market (not refinance)
- Coaching angles must be grounded in the actual news you found, not generic
- Return ONLY the raw JSON object. No markdown, no code fences, no extra text.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-search-preview',
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Search for today's (${formattedToday}) top 3 mortgage/housing news stories, then write the mortgage market brief JSON as instructed. Ground the coaching angles in what you found.`,
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

    // Strip any accidental markdown code fences before parsing
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(fallbackBrief, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
        },
      });
    }

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
