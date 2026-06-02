import { Types } from 'mongoose';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { Activity } from '@/models/activity';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';
import { computeAgentMetrics, EMPTY_AGENT_METRICS } from '@/lib/server/agent-metrics';
import { getAgentProfile } from '@/lib/server/people';

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(),
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/lib/server/agent-metrics', () => {
  const actual = jest.requireActual('@/lib/server/agent-metrics') as typeof import('@/lib/server/agent-metrics');
  return {
    ...actual,
    computeAgentMetrics: jest.fn(),
  };
});

jest.mock('@/models/agent', () => ({
  Agent: { findById: jest.fn() },
}));

jest.mock('@/models/referral', () => ({
  Referral: { find: jest.fn() },
}));

jest.mock('@/models/payment', () => ({
  Payment: { find: jest.fn() },
}));

jest.mock('@/models/activity', () => ({
  Activity: { findOne: jest.fn() },
}));

jest.mock('@/models/user', () => ({
  User: { findById: jest.fn(), findOne: jest.fn() },
}));

const mockGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockComputeAgentMetrics = computeAgentMetrics as jest.MockedFunction<typeof computeAgentMetrics>;
const mockAgentFindById = Agent.findById as jest.Mock;
const mockActivityFindOne = Activity.findOne as jest.Mock;
const mockPaymentFind = Payment.find as jest.Mock;
const mockReferralFind = Referral.find as jest.Mock;
const mockUserFindById = User.findById as jest.Mock;
const mockUserFindOne = User.findOne as jest.Mock;

function chainLean<T>(result: T) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(result),
    }),
  };
}

function chainActivityFindOne<T>(result: T) {
  return {
    sort: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(result),
      }),
    }),
  };
}

function chainPaymentFind<T>(result: T) {
  return {
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(result),
        }),
      }),
    }),
  };
}

describe('getAgentProfile linked User / lastLoggedOnAt', () => {
  const agentId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const loginAt = new Date('2026-01-04T18:00:00.000Z');

  const agentLeanDoc = {
    _id: agentId,
    name: 'Linked Agent',
    email: '  Agent@Example.com  ',
    userId: null as Types.ObjectId | null,
    welcomeEmailSentAt: null as Date | null,
    phone: '',
    licenseNumber: '',
    brokerage: '',
    statesLicensed: [] as string[],
    zipCoverage: [] as string[],
    coverageLocations: [] as { label: string; zipCodes: string[] }[],
    npsScore: null as number | null,
    notes: [] as unknown[],
    specialties: [] as string[],
    languages: [] as string[],
    ahaDesignation: null as null,
    source: '',
    active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSession.mockResolvedValue({
      expires: '',
      user: { id: 'admin-id', role: 'admin', email: 'admin@referrio.app' },
    } as unknown as Awaited<ReturnType<typeof getCurrentSession>>);
    (connectMongo as jest.Mock).mockResolvedValue(undefined);
    mockComputeAgentMetrics.mockResolvedValue(
      new Map([[agentId.toString(), { ...EMPTY_AGENT_METRICS, npsScore: null }]]),
    );

    mockAgentFindById.mockImplementation(() => chainLean(agentLeanDoc));
    mockReferralFind.mockImplementation(() =>
      chainLean([] as unknown[]),
    );
    mockActivityFindOne.mockImplementation(() =>
      chainActivityFindOne<{ createdAt?: Date | string | null } | null>(null),
    );
    mockPaymentFind.mockImplementation(() =>
      chainPaymentFind([] as unknown[]),
    );
    mockUserFindById.mockImplementation(() =>
      chainLean<{ createdAt?: Date; lastLoginAt?: Date | null } | null>(null),
    );
    mockUserFindOne.mockImplementation(() =>
      chainLean<{ createdAt?: Date; lastLoginAt?: Date | null } | null>(null),
    );
  });

  it('resolves User by normalized email when agent.userId is missing and sets lastLoggedOnAt', async () => {
    mockUserFindOne.mockImplementation(() =>
      chainLean({
        createdAt: new Date('2026-01-01'),
        lastLoginAt: loginAt,
      }),
    );

    const profile = await getAgentProfile(agentId.toString());

    expect(profile).not.toBeNull();
    expect(profile!.lastLoggedOnAt).toBe(loginAt.toISOString());
    expect(profile!.signupStatus?.hasSignedUp).toBe(true);
    expect(mockUserFindOne).toHaveBeenCalledWith({ email: 'agent@example.com' });
    expect(mockUserFindById).not.toHaveBeenCalled();
  });

  it('does not call User.findOne when agent.userId resolves to a linked user', async () => {
    const docWithUser = { ...agentLeanDoc, userId };
    mockAgentFindById.mockImplementation(() => chainLean(docWithUser));
    mockUserFindById.mockImplementation(() =>
      chainLean({
        createdAt: new Date('2026-01-01'),
        lastLoginAt: loginAt,
      }),
    );

    const profile = await getAgentProfile(agentId.toString());

    expect(profile!.lastLoggedOnAt).toBe(loginAt.toISOString());
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });

  it('falls back to email lookup when User.findById(userId) returns null', async () => {
    const docWithStaleUserRef = { ...agentLeanDoc, userId };
    mockAgentFindById.mockImplementation(() => chainLean(docWithStaleUserRef));
    mockUserFindById.mockImplementation(() =>
      chainLean<{ createdAt?: Date; lastLoginAt?: Date | null } | null>(null),
    );
    mockUserFindOne.mockImplementation(() =>
      chainLean({
        createdAt: new Date('2026-01-01'),
        lastLoginAt: loginAt,
      }),
    );

    const profile = await getAgentProfile(agentId.toString());

    expect(profile!.lastLoggedOnAt).toBe(loginAt.toISOString());
    expect(profile!.signupStatus?.hasSignedUp).toBe(true);
    expect(mockUserFindOne).toHaveBeenCalledWith({ email: 'agent@example.com' });
  });

  it('includes only side-specific deals attributable to the viewed agent', async () => {
    const buyReferralId = new Types.ObjectId();
    const sellReferralId = new Types.ObjectId();
    const otherAgentId = new Types.ObjectId();
    mockReferralFind.mockImplementation(() =>
      chainLean([
        {
          _id: buyReferralId,
          borrower: { name: 'Buy Client' },
          loanFileNumber: 'BUY-1',
          propertyAddress: '1 Buy St',
          assignedAgent: otherAgentId,
          buySideAgent: agentId,
          sellSideAgent: otherAgentId,
        },
        {
          _id: sellReferralId,
          borrower: { name: 'Sell Client' },
          loanFileNumber: 'SELL-1',
          propertyAddress: '1 Sell St',
          assignedAgent: otherAgentId,
          buySideAgent: otherAgentId,
          sellSideAgent: agentId,
        },
      ]),
    );
    mockPaymentFind.mockImplementation(() =>
      chainPaymentFind([
        {
          _id: new Types.ObjectId(),
          referralId: buyReferralId,
          status: 'paid',
          expectedAmountCents: 10000,
          receivedAmountCents: 10000,
          usedAfc: true,
          usedAssignedAgent: true,
          side: 'buy',
          agentId: null,
          updatedAt: new Date('2026-01-05T00:00:00.000Z'),
        },
        {
          _id: new Types.ObjectId(),
          referralId: buyReferralId,
          status: 'paid',
          expectedAmountCents: 20000,
          receivedAmountCents: 20000,
          usedAfc: true,
          usedAssignedAgent: true,
          side: 'sell',
          agentId: null,
          updatedAt: new Date('2026-01-06T00:00:00.000Z'),
        },
        {
          _id: new Types.ObjectId(),
          referralId: sellReferralId,
          status: 'closed',
          expectedAmountCents: 30000,
          receivedAmountCents: 0,
          usedAfc: false,
          usedAssignedAgent: true,
          side: 'sell',
          agentId: null,
          updatedAt: new Date('2026-01-07T00:00:00.000Z'),
        },
      ]),
    );

    const profile = await getAgentProfile(agentId.toString());

    expect(profile?.deals).toHaveLength(2);
    expect(profile?.deals.map((deal) => deal.borrowerName)).toEqual(['Buy Client', 'Sell Client']);
  });
});
