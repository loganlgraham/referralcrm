/** @jest-environment node */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';

import { GET } from '@/app/api/agents/[id]/kpi-score/route';
import { GET as getDashboardResponse } from '@/app/api/dashboard/route';
import { getCurrentSession } from '@/lib/auth';
import { Agent } from '@/models/agent';

jest.mock('@/app/api/dashboard/route', () => ({ GET: jest.fn() }));
jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn(async () => undefined) }));
jest.mock('@/lib/server/dashboard-internal-request', () => ({
  markDashboardRequestAsInternalAdmin: jest.fn((request) => request),
}));
jest.mock('@/models/agent', () => ({ Agent: { findById: jest.fn() } }));

const mockSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockDashboard = getDashboardResponse as jest.MockedFunction<typeof getDashboardResponse>;
const mockFindById = Agent.findById as jest.Mock;
const agentId = new Types.ObjectId().toString();

function agentChain(agent: Record<string, unknown>) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(agent),
    }),
  };
}

describe('agent KPI score route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: 'admin-id', role: 'admin', email: 'admin@example.com' },
    } as never);
    mockFindById.mockReturnValue(
      agentChain({
        userId: new Types.ObjectId(),
        ahaDesignation: 'AHA',
        includeInMetrics: true,
      })
    );
    mockDashboard.mockResolvedValue(
      Response.json({
        timeframe: { label: 'This Month' },
        agent: {
          ahaLeaderboards: {
            rankedAgents: [
              { id: agentId, score: 87.5, rank: 2, qualified: true, referralCount: 4 },
            ],
          },
          ahaOosLeaderboards: { rankedAgents: [] },
        },
      }) as never
    );
  });

  it('returns the same current-month score and rank as the dashboard leaderboard', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/agents/${agentId}/kpi-score`),
      { params: { id: agentId } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      score: 87.5,
      rank: 2,
      qualified: true,
      referralCount: 4,
      timeframeLabel: 'This Month',
    });
  });

  it('returns not ranked without running the dashboard for AGIT agents', async () => {
    mockFindById.mockReturnValue(
      agentChain({
        userId: new Types.ObjectId(),
        ahaDesignation: 'AGIT',
        includeInMetrics: true,
      })
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/agents/${agentId}/kpi-score`),
      { params: { id: agentId } }
    );

    await expect(response.json()).resolves.toMatchObject({ score: null, reason: 'not_ranked' });
    expect(mockDashboard).not.toHaveBeenCalled();
  });
});
