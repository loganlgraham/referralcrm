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
    const [talkingPoints, briefRes] = await Promise.all([
      generateTalkingPoints(summary),
      fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/daily-market-brief`).then(
        (r) => r.json() as Promise<{ brief?: string }>
      ),
    ]);

    const brief = briefRes.brief ?? summary;
    const email = await generateClientEmail(brief, talkingPoints);

    return NextResponse.json({ email }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate client email' },
      { status: 500 }
    );
  }
}
