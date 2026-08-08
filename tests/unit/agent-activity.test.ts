import { Types } from 'mongoose';

import { getAgentActivityEntries, recordAgentLoginEvent } from '@/lib/server/agent-activity';
import { Activity } from '@/models/activity';
import { Agent } from '@/models/agent';
import { AgentLoginEvent } from '@/models/agent-login-event';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(async () => undefined),
}));

jest.mock('@/models/activity', () => ({ Activity: { find: jest.fn() } }));
jest.mock('@/models/agent', () => ({ Agent: { findById: jest.fn(), findOne: jest.fn() } }));
jest.mock('@/models/agent-login-event', () => ({
  AgentLoginEvent: { find: jest.fn(), create: jest.fn() },
}));
jest.mock('@/models/referral', () => ({ Referral: { find: jest.fn() } }));
jest.mock('@/models/user', () => ({ User: { findById: jest.fn(), findOne: jest.fn() } }));

const agentId = new Types.ObjectId();
const userId = new Types.ObjectId();
const referralId = new Types.ObjectId();

function leanChain<T>(value: T) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  };
}

function listQuery<T>(value: T) {
  const query = {
    sort: jest.fn(),
    select: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
  };
  query.sort.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

describe('agent activity aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('combines only agent-authored referral activity and logins newest first', async () => {
    (Agent.findById as jest.Mock).mockReturnValue(
      leanChain({ _id: agentId, userId, email: 'agent@example.com' })
    );
    (User.findById as jest.Mock).mockReturnValue(
      leanChain({ _id: userId, lastLoginAt: new Date('2026-07-01T12:00:00.000Z') })
    );
    (Activity.find as jest.Mock).mockReturnValue(
      listQuery([
        {
          _id: new Types.ObjectId(),
          referralId,
          channel: 'note',
          content: 'Agent added a client update',
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
        },
      ])
    );
    (AgentLoginEvent.find as jest.Mock).mockReturnValue(
      listQuery([
        {
          _id: new Types.ObjectId(),
          loggedInAt: new Date('2026-08-02T12:00:00.000Z'),
        },
      ])
    );
    (Referral.find as jest.Mock).mockReturnValue(
      leanChain([
        {
          _id: referralId,
          borrower: { name: 'Taylor Buyer' },
          loanFileNumber: '12345',
        },
      ])
    );

    const result = await getAgentActivityEntries(agentId.toString(), 5);

    expect(Activity.find).toHaveBeenCalledWith({
      actor: 'Agent',
      actorId: { $in: [agentId, userId] },
    });
    expect(result).toHaveLength(2);
    expect(result?.[0]).toMatchObject({ action: 'login', content: 'Logged in to the CRM' });
    expect(result?.[1]).toMatchObject({
      action: 'note',
      referral: { borrowerName: 'Taylor Buyer', loanFileNumber: '12345' },
    });
  });

  it('records login history only for linked agent users', async () => {
    (User.findOne as jest.Mock).mockReturnValue(
      leanChain({ _id: userId, email: 'agent@example.com', role: 'agent' })
    );
    (Agent.findOne as jest.Mock).mockReturnValue(leanChain({ _id: agentId }));

    await recordAgentLoginEvent({ id: userId.toString(), email: 'agent@example.com' });

    expect(AgentLoginEvent.create).toHaveBeenCalledWith({
      agentId,
      userId,
      loggedInAt: expect.any(Date),
    });
  });

  it('does not record login history for non-agent users', async () => {
    (User.findOne as jest.Mock).mockReturnValue(
      leanChain({ _id: userId, email: 'admin@example.com', role: 'admin' })
    );

    await recordAgentLoginEvent({ id: userId.toString(), email: 'admin@example.com' });

    expect(Agent.findOne).not.toHaveBeenCalled();
    expect(AgentLoginEvent.create).not.toHaveBeenCalled();
  });
});
