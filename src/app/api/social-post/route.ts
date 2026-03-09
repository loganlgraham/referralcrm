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
    const summary = await generateMarketSummary(headlines);
    const post = await generateSocialPost(summary);

    return NextResponse.json({ post }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate social post' },
      { status: 500 }
    );
  }
}
