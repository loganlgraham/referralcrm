import { NextResponse } from 'next/server';

import { generateMarketSummary } from '@/lib/aiSummary';
import { fetchRssNews } from '@/lib/rss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const articles = await fetchRssNews();
    const headlines = articles.map((a) => a.title).filter(Boolean);
    const summary = await generateMarketSummary(headlines);

    return NextResponse.json(
      { summary },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=1800',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { summary: '' },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
        },
      }
    );
  }
}
