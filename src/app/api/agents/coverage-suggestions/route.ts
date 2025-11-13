import { Types } from 'mongoose';
import { NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { CoverageSuggestion } from '@/models/coverage-suggestion';
import { sortCoverageSuggestions } from '@/lib/server/coverage-suggestions';

export async function GET(): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await connectMongo();
  const suggestions = await CoverageSuggestion.find<{ _id: Types.ObjectId; value: string }>()
    .select('value')
    .lean();
  const sorted = sortCoverageSuggestions(suggestions);
  return NextResponse.json({ suggestions: sorted });
}

