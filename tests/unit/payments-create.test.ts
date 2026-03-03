import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

let postHandler: typeof import('@/app/api/payments/route').POST;

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
    create: jest.fn(),
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

jest.mock('@/lib/referral-links', () => ({
  buildReferralLink: jest.fn(),
  getReferralAppBaseUrl: jest.fn(),
}));

jest.mock('@/lib/server/nps', () => ({
  createNPSToken: jest.fn(),
}));

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedPaymentCreate = Payment.create as jest.Mock;
const mockedPaymentUpdateMany = Payment.updateMany as jest.Mock;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedResolveAuditActorId = resolveAuditActorId as jest.MockedFunction<typeof resolveAuditActorId>;

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

const makeReferralDoc = (overrides: Partial<Record<string, unknown>> = {}) => ({
  _id: { toString: () => 'ref123' },
  origin: 'admin',
  dealSide: 'buy',
  assignedAgent: null,
  status: 'Under Contract',
  statusLastUpdated: null,
  referralFeeDueCents: 50000,
  estPurchasePriceCents: 40000000,
  audit: [],
  propertyAddress: '',
  propertyCity: '',
  propertyState: '',
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('Payments POST outside-agent handling', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/payments/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'admin', name: 'Admin User' },
    } as any);
    mockedResolveAuditActorId.mockReturnValue('audit-actor-1' as any);
    mockedPaymentCreate.mockResolvedValue({
      _id: { toString: () => 'pay-1' },
      createdAt: new Date('2026-03-03T12:00:00.000Z'),
      expectedAmountCents: 0,
      receivedAmountCents: 0,
      status: 'under_contract',
    });
    mockedPaymentUpdateMany.mockResolvedValue({ acknowledged: true });
  });

  it('forces zero owed values and marks referral Lost for outside-agent create', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockResolvedValue(referralDoc);

    const response = await postHandler(
      makeRequest({
        referralId: '507f1f77bcf86cd799439011',
        status: 'under_contract',
        expectedAmountCents: 250000,
        receivedAmountCents: 120000,
        netReferralFeePaidCents: 10000,
        usedAssignedAgent: false,
        usedAfc: true,
      })
    );

    expect(response.status).toBe(201);
    expect(mockedPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAmountCents: 0,
        receivedAmountCents: 0,
        netReferralFeePaidCents: 0,
        usedAssignedAgent: false,
        agentAttribution: 'OUTSIDE_AGENT',
      })
    );
    expect(mockedPaymentUpdateMany).toHaveBeenCalledWith(
      { referralId: referralDoc._id },
      { $set: { expectedAmountCents: 0, receivedAmountCents: 0 } }
    );
    expect(referralDoc.status).toBe('Lost');
    expect(referralDoc.save).toHaveBeenCalled();
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: 'ref123',
        channel: 'status',
      })
    );
  });

  it('keeps normal fee behavior when assigned agent is used', async () => {
    const referralDoc = makeReferralDoc({
      status: 'Under Contract',
    });
    mockedReferralFindById.mockResolvedValue(referralDoc);

    const response = await postHandler(
      makeRequest({
        referralId: '507f1f77bcf86cd799439011',
        status: 'under_contract',
        expectedAmountCents: 190000,
        receivedAmountCents: 25000,
        usedAssignedAgent: true,
        usedAfc: true,
      })
    );

    expect(response.status).toBe(201);
    expect(mockedPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAmountCents: 190000,
        receivedAmountCents: 25000,
        usedAssignedAgent: true,
      })
    );
    expect(referralDoc.status).toBe('Under Contract');
    expect(mockedPaymentUpdateMany).not.toHaveBeenCalled();
    expect(mockedLogReferralActivity).not.toHaveBeenCalled();
  });
});
