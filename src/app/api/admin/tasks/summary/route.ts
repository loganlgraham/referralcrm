import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { getAdminTaskSummary } from '@/lib/server/admin-task-summary';
import { parseTaskNetwork } from '@/lib/task-network';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as {
      status?: number;
      message?: string;
    };
    return new NextResponse(message, { status });
  }

  const network = parseTaskNetwork(new URL(request.url).searchParams.get('network'));
  const summary = await getAdminTaskSummary(network);
  return NextResponse.json(summary, { headers: NO_CACHE_HEADERS });
}
