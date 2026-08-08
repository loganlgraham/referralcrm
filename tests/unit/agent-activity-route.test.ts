/** @jest-environment node */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';

import { GET } from '@/app/api/agents/[id]/activity/route';
import { getCurrentSession } from '@/lib/auth';
import { getAgentActivityEntries } from '@/lib/server/agent-activity';
import { Agent } from '@/models/agent';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn(async () => undefined) }));
jest.mock('@/lib/server/agent-activity', () => ({ getAgentActivityEntries: jest.fn() }));
jest.mock('@/models/agent', () => ({ Agent: { findById: jest.fn() } }));

const mockSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockGetEntries = getAgentActivityEntries as jest.MockedFunction<typeof getAgentActivityEntries>;
const mockFindById = Agent.findById as jest.Mock;
const agentId = new Types.ObjectId().toString();

function agentChain(userId: Types.ObjectId) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ name: 'Agent Example', userId }),
    }),
  };
}

describe('agent activity route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: 'admin-id', role: 'admin', email: 'admin@example.com' },
    } as never);
    mockFindById.mockReturnValue(agentChain(new Types.ObjectId()));
    mockGetEntries.mockResolvedValue([
      {
        id: 'activity-1',
        action: 'login',
        content: 'Logged in to the CRM',
        createdAt: '2026-08-01T14:00:00.000Z',
        referral: null,
      },
    ]);
  });

  it('returns only the five-entry page payload', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/agents/${agentId}/activity`),
      { params: { id: agentId } }
    );

    expect(response.status).toBe(200);
    expect(mockGetEntries).toHaveBeenCalledWith(agentId, 5);
  });

  it('returns the all-time CSV download with escaped values', async () => {
    mockGetEntries.mockResolvedValue([
      {
        id: 'activity-1',
        action: 'note',
        content: 'Called, then wrote "follow up"',
        createdAt: '2026-08-01T14:00:00.000Z',
        referral: {
          id: 'referral-1',
          borrowerName: 'Taylor Buyer',
          loanFileNumber: '12345',
        },
      },
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/agents/${agentId}/activity?format=csv`),
      { params: { id: agentId } }
    );
    const body = await response.text();

    expect(mockGetEntries).toHaveBeenCalledWith(agentId, undefined);
    expect(response.headers.get('content-disposition')).toContain('agent-example-activity-log.csv');
    expect(body).toContain('"Called, then wrote ""follow up"""');
    expect(body).toContain('"Taylor Buyer","12345","referral-1"');
  });

  it('prevents an agent from downloading another agent’s activity', async () => {
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: new Types.ObjectId().toString(), role: 'agent', email: 'agent@example.com' },
    } as never);

    const response = await GET(
      new NextRequest(`http://localhost/api/agents/${agentId}/activity?format=csv`),
      { params: { id: agentId } }
    );

    expect(response.status).toBe(403);
    expect(mockGetEntries).not.toHaveBeenCalled();
  });
});
