import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { createAdminNotifications } from '@/lib/server/notifications';

let patchHandler: typeof import('@/app/api/payments/route').PATCH;

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
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(),
  },
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateMany: jest.fn(),
  },
}));

jest.mock('@/models/agent', () => ({
  Agent: {
    findOne: jest.fn(),
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

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

jest.mock('@/lib/referral-links', () => ({
  buildReferralLink: jest.fn(),
  getReferralAppBaseUrl: jest.fn(),
}));

jest.mock('@/lib/server/nps', () => ({
  createNPSToken: jest.fn(),
}));

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedPaymentFindById = Payment.findById as jest.Mock;
const mockedPaymentFindByIdAndUpdate = Payment.findByIdAndUpdate as jest.Mock;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

describe('Payments PATCH outside-agent normalization', () => {
  beforeAll(async () => {
    ({ PATCH: patchHandler } = await import('@/app/api/payments/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User' },
    } as any);
    mockedPaymentFindById.mockResolvedValue({
      _id: { toString: () => 'pay-1' },
      referralId: 'ref-1',
      status: 'under_contract',
      expectedAmountCents: 50000,
      receivedAmountCents: 10000,
      commissionBasisPoints: 300,
      referralFeeBasisPoints: 25,
      usedAssignedAgent: true,
      agentAttribution: 'AHA',
      side: 'buy',
      usedAfc: true,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:00:00.000Z'),
      closingDate: null,
    });
    mockedReferralFindById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      save: jest.fn().mockResolvedValue(undefined),
      markModified: jest.fn(),
      origin: 'admin',
      status: 'Under Contract',
      sla: {},
      audit: [],
      autoUpdateRemindersEnabled: false,
    });
    mockedPaymentFindByIdAndUpdate.mockResolvedValue({
      _id: { toString: () => 'pay-1' },
      status: 'under_contract',
      usedAssignedAgent: false,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:01:00.000Z'),
      closingDate: null,
    });
  });

  it('nulls fee basis points and zeroes amounts when usedAssignedAgent becomes false', async () => {
    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        usedAssignedAgent: false,
        commissionBasisPoints: 300,
        referralFeeBasisPoints: 25,
        expectedAmountCents: 50000,
        receivedAmountCents: 10000,
      })
    );

    expect(response.status).toBe(200);
    expect(mockedPaymentFindByIdAndUpdate).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({
        usedAssignedAgent: false,
        commissionBasisPoints: null,
        referralFeeBasisPoints: null,
        expectedAmountCents: 0,
        receivedAmountCents: 0,
      }),
      { new: true }
    );
  });

  it('notifies admins when deal status changes', async () => {
    mockedPaymentFindByIdAndUpdate.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      status: 'closed',
      usedAssignedAgent: true,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:01:00.000Z'),
      closingDate: new Date('2026-03-05T10:01:00.000Z'),
    });

    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'closed',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).toHaveBeenCalled();
  });

  it('rejects terminated status updates without terminatedReason', async () => {
    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'terminated',
      })
    );

    expect(response.status).toBe(422);
    expect(mockedPaymentFindByIdAndUpdate).not.toHaveBeenCalled();
  });
});
