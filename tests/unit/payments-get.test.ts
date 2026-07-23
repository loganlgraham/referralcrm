import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

let getHandler: typeof import('@/app/api/payments/route').GET;

jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    body: unknown;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }

  return {
    NextRequest: class {},
    NextResponse: MockNextResponse,
  };
});

jest.mock('mongoose', () => ({
  Types: {
    ObjectId: class MockObjectId {
      private readonly value: string;

      constructor(value?: string) {
        this.value = value ?? 'mock-object-id';
      }

      toString() {
        return this.value;
      }

      static isValid() {
        return true;
      }
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(),
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/models/agent', () => ({
  Agent: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    find: jest.fn(),
  },
}));

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: jest.fn(),
  },
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    find: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
  },
}));

jest.mock('@/models/user', () => ({
  User: {
    find: jest.fn(),
  },
}));

jest.mock('@/lib/email', () => ({
  isTransactionalEmailConfigured: jest.fn(() => false),
  sendTransactionalEmail: jest.fn(),
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/server/audit', () => ({
  resolveAuditActorId: jest.fn(),
}));

jest.mock('@/lib/referral-links', () => ({
  buildReferralLink: jest.fn(),
  getReferralAppBaseUrl: jest.fn(),
}));

jest.mock('@/lib/server/nps', () => ({
  createNPSToken: jest.fn(),
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedAgentFindOne = Agent.findOne as jest.Mock;
const mockedReferralFind = Referral.find as jest.Mock;
const mockedPaymentFind = Payment.find as jest.Mock;
const mockedPaymentCountDocuments = Payment.countDocuments as jest.Mock;
const mockedPaymentAggregate = Payment.aggregate as jest.Mock;

const makeFindQuery = <T>(result: T[]) => {
  const query = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
  return query;
};

const makeRequest = (query: string) =>
  ({
    url: `http://localhost/api/payments${query ? `?${query}` : ''}`,
  } as any);

describe('Payments GET role visibility', () => {
  beforeAll(async () => {
    ({ GET: getHandler } = await import('@/app/api/payments/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedPaymentCountDocuments.mockResolvedValue(0);
    mockedPaymentAggregate.mockResolvedValue([{ receivedRevenueCents: 0 }]);
    mockedPaymentFind.mockReturnValue(makeFindQuery([]));
    mockedReferralFind.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'ref-1' }]),
    });
  });

  it('forces usedAssignedAgent=true for agent requests even when usedAgent=false is requested', async () => {
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'agent', name: 'Agent One' },
    } as any);
    mockedAgentFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'agent-1' }),
    });

    const response = await getHandler(makeRequest('usedAgent=false'));

    expect(response.status).toBe(200);
    expect(mockedReferralFind).toHaveBeenCalledWith({ assignedAgent: 'agent-1' });
    expect(mockedPaymentFind).toHaveBeenCalledWith(
      expect.objectContaining({
        usedAssignedAgent: true,
        referralId: { $in: ['ref-1'] },
      })
    );
    expect(mockedPaymentFind).not.toHaveBeenCalledWith(
      expect.objectContaining({ usedAssignedAgent: false })
    );
  });

  it('returns no deals for agent when they have no assigned referrals', async () => {
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'agent', name: 'Agent One' },
    } as any);
    mockedAgentFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'agent-1' }),
    });
    mockedReferralFind.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const response = await getHandler(makeRequest(''));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        items: [],
        total: 0,
      })
    );
    expect(mockedPaymentFind).not.toHaveBeenCalled();
  });

  it('keeps admin usedAgent filter behavior unchanged', async () => {
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User' },
    } as any);

    const response = await getHandler(makeRequest('usedAgent=false'));

    expect(response.status).toBe(200);
    expect(mockedPaymentFind).toHaveBeenCalledWith(
      expect.objectContaining({
        usedAssignedAgent: false,
      })
    );
    expect(mockedReferralFind).not.toHaveBeenCalled();
  });

  it('returns admin revenue summary fields for expected and received only', async () => {
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User' },
    } as any);
    // The route computes both figures in a single combined aggregation.
    mockedPaymentAggregate.mockResolvedValueOnce([
      { expectedRevenueCents: 4000, receivedRevenueCents: 2500 },
    ]);

    const response = await getHandler(makeRequest(''));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        summary: {
          expectedRevenueCents: 4000,
          receivedRevenueCents: 2500,
        },
      })
    );
    expect(response.body.summary).not.toHaveProperty('totalRevenueCents');
  });
});
