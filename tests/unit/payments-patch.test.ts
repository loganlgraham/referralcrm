import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { createNPSToken } from '@/lib/server/nps';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { createAdminNotifications } from '@/lib/server/notifications';
import { getReferralAppBaseUrl } from '@/lib/referral-links';
import { logReferralActivity } from '@/lib/server/activities';

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
    findById: jest.fn(),
  },
}));

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: jest.fn(),
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
const mockedAgentFindById = Agent.findById as jest.Mock;
const mockedCreateNPSToken = createNPSToken as jest.MockedFunction<typeof createNPSToken>;
const mockedIsTransactionalEmailConfigured = isTransactionalEmailConfigured as jest.MockedFunction<
  typeof isTransactionalEmailConfigured
>;
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<typeof sendTransactionalEmail>;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;
const mockedGetReferralAppBaseUrl = getReferralAppBaseUrl as jest.MockedFunction<typeof getReferralAppBaseUrl>;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
let referralDoc: any;

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
    mockedGetReferralAppBaseUrl.mockReturnValue('https://app.test');
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
    referralDoc = {
      _id: { toString: () => 'ref-1' },
      populate: jest.fn().mockReturnThis(),
      save: jest.fn().mockResolvedValue(undefined),
      markModified: jest.fn(),
      origin: 'admin',
      status: 'Under Contract',
      borrower: {
        name: 'Referral One',
        firstName: 'Referral',
        email: 'borrower@example.com',
      },
      assignedAgent: {
        _id: { toString: () => 'agent-1' },
        name: 'Assigned Agent',
        email: 'agent@example.com',
      },
      sla: {},
      audit: [],
      autoUpdateRemindersEnabled: false,
    };
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockedAgentFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ name: 'Assigned Agent Full' }),
      }),
    });
    mockedCreateNPSToken.mockResolvedValue('nps-token-1');
    mockedIsTransactionalEmailConfigured.mockReturnValue(false);
    mockedSendTransactionalEmail.mockResolvedValue(undefined as any);
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

  it('does not notify admins for admin-driven deal status changes', async () => {
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
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
  });

  it('notifies admins when an admin moves a deal to under contract', async () => {
    mockedPaymentFindById.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      referralId: 'ref-1',
      status: 'past_inspection',
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
    mockedPaymentFindByIdAndUpdate.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      status: 'under_contract',
      usedAssignedAgent: true,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:01:00.000Z'),
      closingDate: null,
    });

    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'under_contract',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status_change',
        content: expect.stringContaining('Under Contract'),
      })
    );
  });

  it('notifies admins for agent-driven deal status changes', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'agent-1', role: 'agent', name: 'Agent User' },
    } as any);
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

  it('notifies admins for MC-driven deal status changes', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'mc-1', role: 'mc', name: 'MC User' },
    } as any);
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

  it('does not send agent close email when usedAfc is false', async () => {
    mockedIsTransactionalEmailConfigured.mockReturnValueOnce(true);
    mockedSendTransactionalEmail.mockResolvedValue(true);
    mockedPaymentFindByIdAndUpdate.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      status: 'closed',
      usedAssignedAgent: true,
      usedAfc: false,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:01:00.000Z'),
      closingDate: new Date('2026-03-05T10:01:00.000Z'),
    });

    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'closed',
        sendClosedEmails: true,
        usedAfc: false,
      })
    );

    expect(response.status).toBe(200);
    expect(mockedSendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['borrower@example.com'],
        subject: 'Congrats on Your New Home!',
      })
    );
    expect(mockedSendTransactionalEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['agent@example.com'],
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        content: 'Satisfaction rating survey emailed to borrower for feedback on Assigned Agent Full.',
      })
    );
  });

  it('does not send agent close email when updated payment omits usedAfc', async () => {
    mockedIsTransactionalEmailConfigured.mockReturnValueOnce(true);
    mockedSendTransactionalEmail.mockResolvedValue(true);
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
        sendClosedEmails: true,
      })
    );

    expect(response.status).toBe(200);
    expect(mockedSendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['borrower@example.com'],
        subject: 'Congrats on Your New Home!',
      })
    );
    expect(mockedSendTransactionalEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['agent@example.com'],
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        content: 'Satisfaction rating survey emailed to borrower for feedback on Assigned Agent Full.',
      })
    );
  });

  it('still sends agent close email when usedAfc is true', async () => {
    mockedIsTransactionalEmailConfigured.mockReturnValueOnce(true);
    mockedSendTransactionalEmail.mockResolvedValue(true);
    mockedCreateNPSToken.mockResolvedValueOnce('nps-agent-token');
    mockedPaymentFindByIdAndUpdate.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      status: 'closed',
      usedAssignedAgent: true,
      usedAfc: true,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:01:00.000Z'),
      closingDate: new Date('2026-03-05T10:01:00.000Z'),
    });

    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'closed',
        sendClosedEmails: true,
        usedAfc: true,
      })
    );

    expect(response.status).toBe(200);
    expect(mockedSendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['borrower@example.com'],
        subject: 'Congrats on Your New Home!',
      })
    );
    expect(mockedSendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['agent@example.com'],
        subject: 'Congratulations on Your Closed Deal!',
      })
    );
    expect(mockedCreateNPSToken).toHaveBeenCalledTimes(1);
    const agentEmailCall = mockedSendTransactionalEmail.mock.calls.find(
      (call) => call[0]?.to?.includes?.('agent@example.com')
    );
    expect(agentEmailCall?.[0]?.html).toBeDefined();
    expect(String(agentEmailCall?.[0]?.html)).not.toContain('/nps/lender');
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        content: 'Satisfaction rating survey emailed to borrower for feedback on Assigned Agent Full.',
      })
    );
  });

  it('includes MC NPS link in agent close email when lender is set and usedAfc is true', async () => {
    referralDoc.lender = {
      _id: { toString: () => 'lender-1' },
      name: 'MC One',
      email: 'mc@example.com',
    };
    mockedIsTransactionalEmailConfigured.mockReturnValueOnce(true);
    mockedSendTransactionalEmail.mockResolvedValue(true);
    mockedCreateNPSToken.mockResolvedValueOnce('nps-agent-token').mockResolvedValueOnce('nps-lender-token');
    mockedPaymentFindByIdAndUpdate.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      status: 'closed',
      usedAssignedAgent: true,
      usedAfc: true,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:01:00.000Z'),
      closingDate: new Date('2026-03-05T10:01:00.000Z'),
    });

    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'closed',
        sendClosedEmails: true,
        usedAfc: true,
      })
    );

    expect(response.status).toBe(200);
    expect(mockedCreateNPSToken).toHaveBeenCalledTimes(2);
    expect(mockedCreateNPSToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'lender',
        targetId: 'lender-1',
        recipientEmail: 'agent@example.com',
      })
    );
    const agentEmailCall = mockedSendTransactionalEmail.mock.calls.find(
      (call) => call[0]?.to?.includes?.('agent@example.com')
    );
    expect(String(agentEmailCall?.[0]?.html)).toContain(
      'https://app.test/nps/lender?token=nps-lender-token'
    );
    expect(String(agentEmailCall?.[0]?.text)).toContain('/nps/lender?token=nps-lender-token');
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        content: 'Satisfaction rating survey emailed to borrower for feedback on Assigned Agent Full.',
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        content: 'Satisfaction rating survey emailed to agent for feedback on MC One.',
      })
    );
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

  it('reactivates a terminated referral back to Active Lead when deal leaves terminated', async () => {
    mockedPaymentFindById.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      referralId: 'ref-1',
      status: 'terminated',
      expectedAmountCents: 50000,
      receivedAmountCents: 0,
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
    referralDoc.status = 'Terminated';
    mockedPaymentFindByIdAndUpdate.mockResolvedValueOnce({
      _id: { toString: () => 'pay-1' },
      status: 'under_contract',
      usedAssignedAgent: true,
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
      updatedAt: new Date('2026-03-05T10:02:00.000Z'),
      closingDate: null,
    });

    const response = await patchHandler(
      makeRequest({
        id: 'pay-1',
        status: 'under_contract',
      })
    );

    expect(response.status).toBe(200);
    expect(referralDoc.status).toBe('Active Lead');
    expect(referralDoc.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'status',
          previousValue: 'Terminated',
          newValue: 'Active Lead',
        }),
      ])
    );
  });
});
