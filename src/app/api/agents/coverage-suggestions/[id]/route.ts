import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { CoverageSuggestion } from '@/models/coverage-suggestion';

interface Params {
  params: { id: string };
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();
  await CoverageSuggestion.findByIdAndDelete(params.id);
  return new NextResponse(null, { status: 204 });
}

