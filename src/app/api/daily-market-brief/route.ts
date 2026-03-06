import { NextResponse } from 'next/server';
import OpenAI from 'openai';

import { fetchRssNews } from '@/lib/rss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FALLBACK_BRIEF =
  'Mortgage rates remain relatively stable as markets react to recent economic data. Housing inventory has gradually increased, giving buyers more options than earlier in the year. Demand remains steady despite affordability pressures as the housing market continues adjusting to current conditions. Agents should focus on buyer readiness, payment planning, and staying close to clients who have been on the sidelines.';

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { brief: FALLBACK_BRIEF },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' },
      }
    );
  }

  try {
    const articles = await fetchRssNews();
    const headlines = articles.map((a) => a.title).filter(Boolean);

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You are a housing market analyst writing a daily briefing for real estate agents. Based on the current housing and mortgage news headlines below, write a 3–4 sentence national market briefing. Focus on mortgage rate environment, housing supply, buyer demand, and actionable context for agents. Keep it nationally relevant, do not reference specific cities, and do not suggest comparing lenders. Return only the briefing text, no headers, no bullet points.',
        },
        {
          role: 'user',
          content:
            headlines.length > 0
              ? `Today's headlines:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
              : 'Generate a general national housing market briefing for today.',
        },
      ],
    });

    const brief = completion.choices[0]?.message?.content?.trim() ?? FALLBACK_BRIEF;

    return NextResponse.json(
      { brief },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' },
      }
    );
  } catch {
    return NextResponse.json(
      { brief: FALLBACK_BRIEF },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600' },
      }
    );
  }
}
