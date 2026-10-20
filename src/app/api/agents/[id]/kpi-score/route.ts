import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { GET as getDashboardResponse } from '@/app/api/dashboard/route';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { markDashboardRequestAsInternalAdmin } from '@/lib/server/dashboard-internal-request';
import { Agent } from '@/models/agent';

interface Params {
  params: { id: string };
}

type RankedAgent = {
  id: string;
  score: number;
  rank: number;
  qualified: boolean;
  referralCount: number;
};

type DashboardScoreResponse = {
  timeframe?: { label?: string };
  agent?: {
    ahaLeaderboards?: { rankedAgents?: RankedAgent[] };
    ahaOosLeaderboards?: { rankedAgents?: RankedAgent[] };
  };
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return new NextResponse('Not found', { status: 404 });
  }

  await connectMongo();
  const agent = await Agent.findById(params.id)
    .select('userId ahaDesignation includeInMetrics')
    .lean<{
      userId?: Types.ObjectId | null;
      ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
      includeInMetrics?: boolean | null;
    } | null>();
  if (!agent) {
    return new NextResponse('Not found', { status: 404 });
  }

  const role = session.user.role;
  const canView =
    role === 'admin' ||
    role === 'mc' ||
    (role === 'agent' && agent.userId?.toString() === session.user.id);
  if (!canView) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (
    agent.includeInMetrics === false ||
    (agent.ahaDesignation !== 'AHA' && agent.ahaDesignation !== 'AHA_OOS')
  ) {
    return NextResponse.json({ score: null, reason: 'not_ranked', timeframeLabel: 'This Month' });
  }

  const dashboardUrl = new URL('/api/dashboard', request.nextUrl.origin);
  dashboardUrl.searchParams.set('timeframe', 'month');
  dashboardUrl.searchParams.set('network', agent.ahaDesignation);
  const dashboardRequest = markDashboardRequestAsInternalAdmin(
    new NextRequest(dashboardUrl, { method: 'GET' })
  );
  const dashboardResponse = await getDashboardResponse(dashboardRequest);
  if (!dashboardResponse.ok) {
    return new NextResponse('Unable to calculate KPI score', { status: 500 });
  }

  const payload = (await dashboardResponse.json()) as DashboardScoreResponse;
  const rankedAgents =
    agent.ahaDesignation === 'AHA'
      ? payload.agent?.ahaLeaderboards?.rankedAgents
      : payload.agent?.ahaOosLeaderboards?.rankedAgents;
  const score = rankedAgents?.find((entry) => entry.id === params.id) ?? null;

  return NextResponse.json({
    score: score?.score ?? null,
    rank: score?.rank ?? null,
    qualified: score?.qualified ?? false,
    referralCount: score?.referralCount ?? 0,
    timeframeLabel: payload.timeframe?.label ?? 'This Month',
    reason: score ? null : 'no_data',
  });
}
