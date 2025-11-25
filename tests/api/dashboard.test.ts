import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { GET } from '@/app/api/dashboard/route';
import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

type MockedFn<T = unknown> = jest.Mock<T>;

jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn() }));
jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/models/payment', () => ({ Payment: { aggregate: jest.fn() } }));
jest.mock('@/models/referral', () => ({ Referral: { find: jest.fn() } }));
jest.mock('@/models/lender', () => ({ LenderMC: { find: jest.fn() } }));
jest.mock('@/models/agent', () => ({ Agent: { find: jest.fn(), findOne: jest.fn() } }));

describe('Dashboard API attach rates', () => {
  const mockConnectMongo = connectMongo as MockedFn;
  const mockGetCurrentSession = getCurrentSession as MockedFn;
  const mockPaymentAggregate = Payment.aggregate as MockedFn;
  const mockReferralFind = Referral.find as MockedFn;
  const mockAgentFind = Agent.find as MockedFn;
  const mockAgentFindOne = Agent.findOne as MockedFn;
  const mockLenderFind = LenderMC.find as MockedFn;

  const buildRequest = () => new NextRequest('http://localhost:3000/api/dashboard');

  const buildReferralQuery = (referrals: unknown[]) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(referrals)
  });

  const buildSelectableQuery = (result: unknown[]) => ({
    select: jest.fn().mockResolvedValue(result)
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectMongo.mockResolvedValue(undefined);
    mockGetCurrentSession.mockResolvedValue({ user: { id: 'user-1', role: 'admin' } });
    mockReferralFind.mockReturnValue(buildReferralQuery([]));
    mockAgentFind.mockReturnValue(buildSelectableQuery([]));
    mockAgentFindOne.mockResolvedValue(null);
    mockLenderFind.mockReturnValue(buildSelectableQuery([]));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('derives attach buckets from assigned agent designation when used', async () => {
    const now = new Date();
    const ahaAgentId = new Types.ObjectId();
    const ahaOosAgentId = new Types.ObjectId();

    const ahaReferral = { _id: new Types.ObjectId(), createdAt: now, ahaBucket: 'AHA' as const };
    const ahaOosReferral = { _id: new Types.ObjectId(), createdAt: now, ahaBucket: 'AHA_OOS' as const };

    mockReferralFind.mockReturnValue(buildReferralQuery([ahaReferral, ahaOosReferral]));

    mockPaymentAggregate
      .mockResolvedValueOnce([
        {
          _id: new Types.ObjectId(),
          status: 'paid',
          updatedAt: now,
          paidDate: now,
          usedAssignedAgent: true,
          assignedAgent: { _id: ahaAgentId, ahaDesignation: 'AHA' },
          referral: { ...ahaReferral, assignedAgent: ahaAgentId }
        },
        {
          _id: new Types.ObjectId(),
          status: 'paid',
          updatedAt: now,
          paidDate: now,
          usedAssignedAgent: true,
          assignedAgent: { _id: ahaOosAgentId, ahaDesignation: 'AHA_OOS' },
          referral: { ...ahaOosReferral, assignedAgent: ahaOosAgentId }
        }
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(buildRequest());
    const payload = await response.json();

    expect(payload.main.summary.ahaAttachRate).toBe(100);
    expect(payload.main.summary.ahaOosAttachRate).toBe(100);
  });

  it('falls back to referral bucket when no agent designation exists', async () => {
    const now = new Date();
    const fallbackReferralAha = { _id: new Types.ObjectId(), createdAt: now, ahaBucket: 'AHA' as const };
    const fallbackReferralAhaOos = { _id: new Types.ObjectId(), createdAt: now, ahaBucket: 'AHA_OOS' as const };

    mockReferralFind.mockReturnValue(buildReferralQuery([fallbackReferralAha, fallbackReferralAhaOos]));

    mockPaymentAggregate
      .mockResolvedValueOnce([
        {
          _id: new Types.ObjectId(),
          status: 'paid',
          updatedAt: now,
          paidDate: now,
          usedAssignedAgent: true,
          assignedAgent: { _id: new Types.ObjectId(), ahaDesignation: null },
          referral: { ...fallbackReferralAha }
        },
        {
          _id: new Types.ObjectId(),
          status: 'paid',
          updatedAt: now,
          paidDate: now,
          usedAssignedAgent: false,
          assignedAgent: { _id: new Types.ObjectId(), ahaDesignation: null },
          referral: { ...fallbackReferralAhaOos }
        }
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(buildRequest());
    const payload = await response.json();

    expect(payload.main.summary.ahaAttachRate).toBe(100);
    expect(payload.main.summary.ahaOosAttachRate).toBe(0);
  });

  it('sums total volume closed from contract prices', async () => {
    const now = new Date();

    const referralA = {
      _id: new Types.ObjectId(),
      createdAt: now,
      origin: 'admin' as const,
      sla: {}
    };
    const referralB = {
      _id: new Types.ObjectId(),
      createdAt: now,
      origin: 'admin' as const,
      sla: {}
    };

    mockReferralFind.mockReturnValue(buildReferralQuery([referralA, referralB]));

    mockPaymentAggregate
      .mockResolvedValueOnce([
        {
          _id: new Types.ObjectId(),
          status: 'closed',
          updatedAt: now,
          contractPriceCents: 25000000,
          agentAttribution: 'AHA',
          usedAssignedAgent: true,
          referral: referralA
        },
        {
          _id: new Types.ObjectId(),
          status: 'paid',
          updatedAt: now,
          paidDate: now,
          contractPriceCents: 15000000,
          agentAttribution: 'AHA',
          usedAssignedAgent: true,
          referral: referralB
        }
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(buildRequest());
    const payload = await response.json();

    expect(payload.main.summary.totalVolumeClosedCents).toBe(40000000);
  });

  it('averages closed to paid days from admin SLA durations', async () => {
    const now = new Date('2024-06-15T12:00:00Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);

    const adminReferralWithSla = {
      _id: new Types.ObjectId(),
      createdAt: now,
      origin: 'admin' as const,
      sla: { closedToPaidMinutes: 2880 }
    };

    const adminReferralInProgress = {
      _id: new Types.ObjectId(),
      createdAt: now,
      origin: 'admin' as const,
      sla: { lastClosedAt: new Date('2024-06-10T12:00:00Z') }
    };

    const mcReferral = {
      _id: new Types.ObjectId(),
      createdAt: now,
      origin: 'mc' as const,
      sla: { closedToPaidMinutes: 1440 }
    };

    mockReferralFind.mockReturnValue(
      buildReferralQuery([adminReferralWithSla, adminReferralInProgress, mcReferral])
    );

    mockPaymentAggregate
      .mockResolvedValueOnce([
        {
          _id: new Types.ObjectId(),
          status: 'paid',
          updatedAt: now,
          paidDate: now,
          agentAttribution: 'AHA',
          usedAssignedAgent: true,
          referral: adminReferralWithSla
        },
        {
          _id: new Types.ObjectId(),
          status: 'closed',
          updatedAt: now,
          agentAttribution: 'AHA',
          usedAssignedAgent: true,
          referral: adminReferralInProgress
        }
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(buildRequest());
    const payload = await response.json();

    expect(payload.main.summary.averageDaysClosedToPaid).toBeCloseTo(3.5, 5);
  });
});
