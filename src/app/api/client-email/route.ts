import { NextResponse } from 'next/server';

import { generateClientEmail } from '@/lib/clientEmail';
import { generateTalkingPoints } from '@/lib/agentTalkingPoints';
import { generateMarketSummary } from '@/lib/aiSummary';
import { fetchRssNews } from '@/lib/rss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const articles = await fetchRssNews();
    const headlines = articles.map((a) => a.title).filter(Boolean);
    const summary = await generateMarketSummary(headlines);
    const talkingPoints = await generateTalkingPoints(summary);
    const email = await generateClientEmail(summary, talkingPoints);

    return NextResponse.json({ email }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate client email' },
      { status: 500 }
    );
  }
}
