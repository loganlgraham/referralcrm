import { connectMongo } from '@/lib/mongoose';
import { FeeBreakdownVerification } from '@/models/fee-breakdown-verification';
import { Payment } from '@/models/payment';
import { logReferralActivity } from '@/lib/server/activities';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { User } from '@/models/user';
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

jest.mock('@/models/fee-breakdown-verification', () => ({
  FeeBreakdownVerification: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    updateOne: jest.fn(),
  },
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/email', () => ({
  isTransactionalEmailConfigured: jest.fn(),
  sendTransactionalEmail: jest.fn(),
}));

jest.mock('@/lib/server/cc-recipients', () => ({
  getReferralNotificationRecipients: jest.fn(() => ['coordinator@example.com']),
  buildCcList: jest.fn((defaults: string[], extras: string[]) => [...defaults, ...extras]),
}));

jest.mock('@/models/user', () => ({
  User: {
    find: jest.fn(),
  },
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

let postHandler: typeof import('@/app/api/fee-verification/submit/route').POST;

const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedFindOne = FeeBreakdownVerification.findOne as jest.Mock;
const mockedVerificationUpdate = FeeBreakdownVerification.updateOne as jest.Mock;
const mockedPaymentUpdate = Payment.updateOne as jest.Mock;
const mockedLogActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedEmailConfigured = isTransactionalEmailConfigured as jest.MockedFunction<
  typeof isTransactionalEmailConfigured
>;
const mockedSendEmail = sendTransactionalEmail as jest.MockedFunction<typeof sendTransactionalEmail>;
const mockedUserFind = User.find as jest.Mock;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

const makeVerification = (overrides: Record<string, unknown> = {}) => ({
  _id: 'ver-1',
  paymentId: 'pay-1',
  referralId: 'ref-1',
  recipientEmail: 'sam@example.com',
  recipientName: 'Sam Agent',
  borrowerName: 'Jamie Lee',
  propertyAddress: '123 Main St',
  snapshot: {
    contractPriceCents: 45000000,
    commissionBasisPoints: 250,
    commissionFlatFeeCents: null,
    referralFeeBasisPoints: 2500,
    closingDate: new Date('2026-11-15T12:00:00Z'),
  },
  status: 'pending',
  expiresAt: new Date(Date.now() + 86400000),
  ...overrides,
});

const mockFindOne = (value: unknown) => {
  mockedFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(value) });
};

describe('POST /api/fee-verification/submit', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/fee-verification/submit/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedVerificationUpdate.mockResolvedValue({});
    mockedPaymentUpdate.mockResolvedValue({});
    mockedLogActivity.mockResolvedValue(undefined as any);
    mockedEmailConfigured.mockReturnValue(true);
    mockedSendEmail.mockResolvedValue(true);
    mockedCreateAdminNotifications.mockResolvedValue(undefined);
    mockedUserFind.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ email: 'Admin1@example.com' }, { email: 'admin2@example.com' }, {}]),
      }),
    });
  });

  it('confirms the numbers without notifying the team', async () => {
    mockFindOne(makeVerification());

    const response = await postHandler(makeRequest({ token: 't1', action: 'confirm' }));

    expect(response.status).toBe(200);
    expect(mockedPaymentUpdate).toHaveBeenCalledWith(
      { _id: 'pay-1' },
      { $set: expect.objectContaining({ feeBreakdownVerificationStatus: 'confirmed' }) }
    );
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: 'ref-1',
        actorRole: 'agent',
        content: 'Sam Agent confirmed the fee breakdown numbers look correct.',
      })
    );
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fee_breakdown_confirmed',
        referralId: 'ref-1',
        content: 'Sam Agent confirmed the fee breakdown numbers for Jamie Lee.',
      })
    );
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it('records a report with corrections and emails the coordinator', async () => {
    mockFindOne(makeVerification());

    const response = await postHandler(
      makeRequest({
        token: 't1',
        action: 'report',
        corrections: [{ field: 'commission', correctValue: '3%' }],
        note: 'Seller is paying 3%',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedVerificationUpdate).toHaveBeenCalledWith(
      { _id: 'ver-1' },
      {
        $set: expect.objectContaining({
          status: 'disputed',
          corrections: [{ field: 'commission', correctValue: '3%' }],
          note: 'Seller is paying 3%',
        }),
      }
    );
    expect(mockedPaymentUpdate).toHaveBeenCalledWith(
      { _id: 'pay-1' },
      { $set: expect.objectContaining({ feeBreakdownVerificationStatus: 'disputed' }) }
    );
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'Sam Agent reported the fee breakdown numbers look off: Agent commission should be 3%. Note: Seller is paying 3%',
      })
    );
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    const payload = mockedSendEmail.mock.calls[0][0];
    expect(payload.to).toEqual(['kristen.truong@americanhomeagents.com']);
    expect(payload.cc).toEqual(['admin1@example.com', 'admin2@example.com', 'coordinator@example.com']);
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fee_breakdown_disputed',
        content: 'Sam Agent challenged the fee breakdown numbers for Jamie Lee. Review the deal.',
      })
    );
    expect(payload.subject).toBe('Agent flagged fee breakdown numbers - Jamie Lee');
    expect(payload.text).toContain('Emailed: 2.50% ($11,250.00)');
    expect(payload.text).toContain('Agent says: 3%');
  });

  it('rejects a report with no corrections or note', async () => {
    mockFindOne(makeVerification());

    const response = await postHandler(makeRequest({ token: 't1', action: 'report', corrections: [] }));

    expect(response.status).toBe(400);
    expect(mockedVerificationUpdate).not.toHaveBeenCalled();
  });

  it('rejects expired links', async () => {
    mockFindOne(makeVerification({ expiresAt: new Date(Date.now() - 1000) }));

    const response = await postHandler(makeRequest({ token: 't1', action: 'confirm' }));

    expect(response.status).toBe(410);
    expect(mockedPaymentUpdate).not.toHaveBeenCalled();
  });

  it('rejects links replaced by a newer email', async () => {
    mockFindOne(makeVerification({ status: 'superseded' }));

    const response = await postHandler(makeRequest({ token: 't1', action: 'confirm' }));

    expect(response.status).toBe(409);
    expect(mockedPaymentUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown tokens', async () => {
    mockFindOne(null);

    const response = await postHandler(makeRequest({ token: 'nope', action: 'confirm' }));

    expect(response.status).toBe(404);
  });
});
