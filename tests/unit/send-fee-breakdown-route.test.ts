import { Types } from 'mongoose';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { FeeBreakdownVerification } from '@/models/fee-breakdown-verification';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { loadFeeBreakdownAttachments, FeeBreakdownDocumentError } from '@/lib/server/fee-breakdown-documents';
import { logReferralActivity } from '@/lib/server/activities';

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

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(),
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock('@/models/referral', () => ({
  Referral: {},
}));

jest.mock('@/models/agent', () => ({
  Agent: {},
}));

jest.mock('@/models/fee-breakdown-verification', () => ({
  FeeBreakdownVerification: {
    create: jest.fn(),
    deleteOne: jest.fn(),
    updateMany: jest.fn(),
  },
}));

jest.mock('@/lib/email', () => ({
  isTransactionalEmailConfigured: jest.fn(),
  sendTransactionalEmail: jest.fn(),
}));

jest.mock('@/lib/server/fee-breakdown-documents', () => ({
  FeeBreakdownDocumentError: class FeeBreakdownDocumentError extends Error {},
  loadFeeBreakdownAttachments: jest.fn(),
}));

jest.mock('@/lib/referral-links', () => ({
  buildReferralLink: jest.fn(() => 'https://referrio.app/referrals/ref-1'),
  getReferralAppBaseUrl: jest.fn(() => 'https://referrio.app'),
}));

jest.mock('@/lib/server/cc-recipients', () => ({
  getReferralNotificationRecipients: jest.fn(() => ['ops@example.com']),
  buildCcList: jest.fn((defaults: string[], extras: string[]) => [...defaults, ...extras]),
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/server/audit', () => ({
  resolveAuditActorId: jest.fn(() => 'admin-1'),
}));

let postHandler: typeof import('@/app/api/payments/[id]/send-fee-breakdown/route').POST;

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedPaymentFindById = Payment.findById as jest.Mock;
const mockedPaymentFindOneAndUpdate = Payment.findOneAndUpdate as jest.Mock;
const mockedPaymentFindByIdAndUpdate = Payment.findByIdAndUpdate as jest.Mock;
const mockedPaymentUpdateOne = Payment.updateOne as jest.Mock;
const mockedVerificationCreate = FeeBreakdownVerification.create as jest.Mock;
const mockedVerificationUpdateMany = FeeBreakdownVerification.updateMany as jest.Mock;
const mockedVerificationDeleteOne = FeeBreakdownVerification.deleteOne as jest.Mock;
const mockedEmailConfigured = isTransactionalEmailConfigured as jest.MockedFunction<typeof isTransactionalEmailConfigured>;
const mockedSendEmail = sendTransactionalEmail as jest.MockedFunction<typeof sendTransactionalEmail>;
const mockedLoadAttachments = loadFeeBreakdownAttachments as jest.MockedFunction<typeof loadFeeBreakdownAttachments>;
const mockedLogActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;

const paymentId = new Types.ObjectId();
const referralId = new Types.ObjectId();
const agentId = new Types.ObjectId();

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    _id: paymentId,
    closingDate: new Date('2026-12-01T12:00:00Z'),
    agentId: {
      _id: agentId,
      name: 'Sam Agent',
      email: 'sam@example.com',
      ahaDesignation: 'AHA_OOS',
    },
    referralId: {
      _id: referralId,
      borrower: { name: 'Jamie Lee' },
      propertyAddress: '123 Main St',
      propertyCity: 'Aurora',
      propertyState: 'CO',
      loanFileNumber: '12345678901',
    },
    contractPriceCents: 45000000,
    commissionBasisPoints: 300,
    commissionFlatFeeCents: null,
    referralFeeBasisPoints: 2500,
    side: 'buy',
    usedAfc: true,
    propertyAddress: '123 Main St',
    propertyCity: 'Aurora',
    propertyState: 'CO',
    feeBreakdownEmailSentAt: null,
    ...overrides,
  };
}

function mockPaymentLookup(payment = makePayment()) {
  const query = {
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(payment),
  };
  mockedPaymentFindById.mockReturnValue(query);
  return query;
}

function makeRequest(options: { cron?: boolean; body?: Record<string, unknown> } = {}) {
  return {
    headers: {
      get: jest.fn((name: string) => {
        if (name.toLowerCase() === 'authorization' && options.cron) {
          return 'Bearer test-cron-secret';
        }
        return null;
      }),
    },
    json: jest.fn().mockResolvedValue(options.body ?? {}),
  } as any;
}

describe('POST /api/payments/[id]/send-fee-breakdown', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/payments/[id]/send-fee-breakdown/route'));
  });

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
    mockedConnectMongo.mockResolvedValue({} as Awaited<ReturnType<typeof connectMongo>>);
    mockedGetCurrentSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } } as any);
    mockedEmailConfigured.mockReturnValue(true);
    mockPaymentLookup();
    mockedPaymentFindOneAndUpdate.mockResolvedValue(makePayment());
    mockedPaymentFindByIdAndUpdate.mockResolvedValue({});
    mockedPaymentUpdateOne.mockResolvedValue({});
    mockedVerificationCreate.mockResolvedValue({ _id: new Types.ObjectId() });
    mockedVerificationUpdateMany.mockResolvedValue({});
    mockedVerificationDeleteOne.mockResolvedValue({});
    mockedSendEmail.mockResolvedValue(true);
    mockedLogActivity.mockResolvedValue(undefined);
    mockedLoadAttachments.mockResolvedValue([
      { filename: 'AHA Commission Wiring Instructions.pdf', content: Buffer.from('%PDF-1.7\nwiring\n') },
      { filename: 'AHA W9 2026.pdf', content: Buffer.from('%PDF-1.7\nw9\n') },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sends manual fee breakdown emails with the exact MongoDB attachment payloads', async () => {
    const response = await postHandler(makeRequest(), { params: { id: paymentId.toString() } });

    expect(response.status).toBe(200);
    expect(mockedPaymentFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail.mock.calls[0][0].attachments).toEqual([
      { filename: 'AHA Commission Wiring Instructions.pdf', content: Buffer.from('%PDF-1.7\nwiring\n') },
      { filename: 'AHA W9 2026.pdf', content: Buffer.from('%PDF-1.7\nw9\n') },
    ]);
    expect(mockedPaymentFindByIdAndUpdate).toHaveBeenCalledWith(
      paymentId.toString(),
      expect.objectContaining({
        feeBreakdownVerificationStatus: 'pending',
        feeBreakdownVerifiedAt: null,
      })
    );
  });

  it('sends cron-triggered fee breakdown emails with the same attachments after claiming the payment', async () => {
    mockedGetCurrentSession.mockResolvedValue(null);

    const response = await postHandler(makeRequest({ cron: true }), {
      params: { id: paymentId.toString() },
    });

    expect(response.status).toBe(200);
    expect(mockedPaymentFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: paymentId.toString(), feeReminderClosingDate: { $ne: expect.any(Date) } }),
      expect.objectContaining({
        $set: expect.objectContaining({
          feeReminderClosingDate: expect.any(Date),
        }),
      })
    );
    expect(mockedSendEmail.mock.calls[0][0].subject).toMatch(/American Home Agents Referral Fee/);
    expect(mockedSendEmail.mock.calls[0][0].text).not.toMatch(/getting .* under contract/i);
    expect(mockedSendEmail.mock.calls[0][0].attachments?.map((attachment) => attachment.filename)).toEqual([
      'AHA Commission Wiring Instructions.pdf',
      'AHA W9 2026.pdf',
    ]);
  });

  it('does not send or mark sent when attachments are missing or corrupt', async () => {
    mockedLoadAttachments.mockRejectedValue(
      new FeeBreakdownDocumentError('Fee breakdown attachment is missing: AHA W9 2026.pdf')
    );

    const response = await postHandler(makeRequest({ cron: true }), {
      params: { id: paymentId.toString() },
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'Fee breakdown attachments unavailable',
      details: 'Fee breakdown attachment is missing: AHA W9 2026.pdf',
    });
    expect(mockedPaymentFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockedVerificationCreate).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedPaymentFindByIdAndUpdate).not.toHaveBeenCalled();
  });
});
