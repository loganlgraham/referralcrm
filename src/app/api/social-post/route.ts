import { NextResponse } from 'next/server';

import { generateSocialPost } from '@/lib/socialPost';
import { fetchRssNews } from '@/lib/rss';
import { generateMarketSummary } from '@/lib/aiSummary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const articles = await fetchRssNews();
    const headlines = articles.map((a) => a.title).filter(Boolean);
    const briefRes = await fetch(
      `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/daily-market-brief`
    ).then((r) => r.json() as Promise<{ brief?: string }>);

    const context = briefRes.brief ?? (await generateMarketSummary(headlines));
    const post = await generateSocialPost(context);

    return NextResponse.json({ post }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate social post' },
      { status: 500 }
    );
  }
}
