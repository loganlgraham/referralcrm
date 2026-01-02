import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { ReferralMetadata } from '@/models/referral-metadata';

export async function GET() {
  try {
    await requireAdmin();
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unauthorized' }, { status: error.status || 401 });
  }

  await connectMongo();

  try {
    const [sources, endorsers] = await Promise.all([
      ReferralMetadata.find({ type: 'source' })
        .sort({ lastUsedAt: -1, usageCount: -1 })
        .limit(50)
        .select('value')
        .lean(),
      ReferralMetadata.find({ type: 'endorser' })
        .sort({ lastUsedAt: -1, usageCount: -1 })
        .limit(50)
        .select('value')
        .lean()
    ]);

    return NextResponse.json({
      sources: sources.map((item) => item.value),
      endorsers: endorsers.map((item) => item.value)
    });
  } catch (error) {
    console.error('Failed to fetch referral metadata', error);
    return NextResponse.json({ error: 'Failed to fetch metadata' }, { status: 500 });
  }
}
