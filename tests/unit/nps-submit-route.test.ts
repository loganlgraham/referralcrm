import { connectMongo } from '@/lib/mongoose';
import { NPSToken } from '@/models/nps-token';
import { logReferralActivity } from '@/lib/server/activities';
import { updateNPSScore } from '@/lib/server/nps';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { Referral } from '@/models/referral';
import { createAdminNotifications } from '@/lib/server/notifications';

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

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/models/nps-token', () => ({
  NPSToken: {
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/server/nps', () => ({
  updateNPSScore: jest.fn(),
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(),
  },
}));

jest.mock('@/models/agent', () => ({
  Agent: {
    findById: jest.fn(),
  },
}));

jest.mock('@/models/lender', () => ({
  LenderMC: {
    findById: jest.fn(),
  },
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

let postHandler: typeof import('@/app/api/nps/submit/route').POST;

const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedNPSTokenFindOne = NPSToken.findOne as jest.Mock;
const mockedNPSTokenFindByIdAndUpdate = NPSToken.findByIdAndUpdate as jest.Mock;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedUpdateNPSScore = updateNPSScore as jest.MockedFunction<typeof updateNPSScore>;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedAgentFindById = Agent.findById as jest.Mock;
const mockedLenderFindById = LenderMC.findById as jest.Mock;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

describe('POST /api/nps/submit', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/nps/submit/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedNPSTokenFindByIdAndUpdate.mockResolvedValue({});
    mockedUpdateNPSScore.mockResolvedValue(undefined);
    mockedReferralFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ borrower: { name: 'Borrower' } }),
      }),
    });
    mockedAgentFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ name: 'Agent Rated' }),
      }),
    });
    mockedLenderFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ name: 'MC Rated' }),
      }),
    });
    mockedCreateAdminNotifications.mockResolvedValue(undefined);
    mockedLogReferralActivity.mockResolvedValue(undefined);
  });

  it('logs referral activity for agent survey submission', async () => {
    mockedNPSTokenFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'tok-1',
        type: 'agent',
        referralId: 'ref-1',
        targetId: 'agent-1',
        submitted: false,
        expiresAt: new Date(Date.now() + 86400000),
      }),
    });

    const response = await postHandler(
      makeRequest({ token: 't1', score: 9 })
    );

    expect(response.status).toBe(200);
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: 'ref-1',
        actorRole: 'system',
        actorId: null,
        channel: 'update',
        content: 'Satisfaction rating received for agent Agent Rated: 9/10.',
      })
    );
  });

  it('logs referral activity for lender survey submission', async () => {
    mockedNPSTokenFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'tok-2',
        type: 'lender',
        referralId: 'ref-2',
        targetId: 'lender-1',
        submitted: false,
        expiresAt: new Date(Date.now() + 86400000),
      }),
    });

    const response = await postHandler(
      makeRequest({ token: 't2', score: 8 })
    );

    expect(response.status).toBe(200);
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: 'ref-2',
        actorRole: 'system',
        actorId: null,
        channel: 'update',
        content: 'Satisfaction rating received for mortgage consultant MC Rated: 8/10.',
      })
    );
  });
});
