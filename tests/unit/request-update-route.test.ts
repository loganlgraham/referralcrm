import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { logReferralActivity } from '@/lib/server/activities';
import { sendTransactionalEmail } from '@/lib/email';
import { getCurrentSession } from '@/lib/auth';
import { getAppOrigin } from '@/lib/server/app-origin';

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
    ObjectId: {
      isValid: jest.fn(() => true),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(),
  requireAdmin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}));

jest.mock('@/models/agent', () => ({
  Agent: {
    find: jest.fn(),
  },
}));

jest.mock('@/lib/email', () => ({
  isTransactionalEmailConfigured: jest.fn(() => true),
  sendTransactionalEmail: jest.fn(),
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/server/app-origin', () => ({
  getAppOrigin: jest.fn(() => 'https://app.test'),
}));

let postHandler: typeof import('@/app/api/referrals/[id]/request-update/route').POST;

const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedReferralFindByIdAndUpdate = Referral.findByIdAndUpdate as jest.Mock;
const mockedAgentFind = Agent.find as jest.Mock;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<typeof sendTransactionalEmail>;
const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedGetAppOrigin = getAppOrigin as jest.MockedFunction<typeof getAppOrigin>;

const referralLean = {
  _id: 'ref-1',
  borrower: {
    name: 'Buyer One',
    email: 'buyer@example.com',
    phone: '303-555-0100',
  },
  status: 'Under Contract',
  statusLastUpdated: new Date('2026-01-01T12:00:00.000Z'),
  loanFileNumber: 'LF-1',
};

function chainReferralLean(doc: typeof referralLean) {
  const lean = jest.fn().mockResolvedValue(doc);
  const chain: { populate: jest.Mock; lean: jest.Mock } = {
    populate: jest.fn(),
    lean,
  };
  chain.populate.mockImplementation(() => chain);
  return chain;
}

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

describe('POST /api/referrals/[id]/request-update', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/referrals/[id]/request-update/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', name: 'Admin' },
    } as any);
    mockedGetAppOrigin.mockReturnValue('https://app.test');
    mockedReferralFindById.mockReturnValue(chainReferralLean(referralLean));
    mockedAgentFind.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'agent-1', name: 'Alice Agent', email: 'alice@example.com' },
        ]),
      }),
    });
  });

  it('does not log activity or update referral when all emails fail to send', async () => {
    mockedSendTransactionalEmail.mockResolvedValue(false);

    const response = await postHandler(makeRequest({ agentIds: ['agent-1'] }) as any, {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedReferralFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(mockedLogReferralActivity).not.toHaveBeenCalled();
    const body = (response as any).body as { timestamp: string | null };
    expect(body.timestamp).toBeNull();
  });

  it('logs activity and updates referral only when at least one email sends', async () => {
    mockedSendTransactionalEmail.mockResolvedValue(true);

    const response = await postHandler(makeRequest({ agentIds: ['agent-1'] }) as any, {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedReferralFindByIdAndUpdate).toHaveBeenCalled();
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: 'ref-1',
        channel: 'email',
        content: 'Update request sent to Alice Agent',
        actorRole: 'admin',
        actorId: 'admin-1',
      })
    );
    const body = (response as any).body as { timestamp: string | null };
    expect(body.timestamp).not.toBeNull();
  });
});
