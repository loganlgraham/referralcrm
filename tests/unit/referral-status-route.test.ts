import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { logReferralActivity } from '@/lib/server/activities';
import { createAdminNotifications } from '@/lib/server/notifications';

let postHandler: typeof import('@/app/api/referrals/[id]/status/route').POST;

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

jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(),
  },
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    findOne: jest.fn(),
    updateMany: jest.fn(),
    exists: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('@/lib/rbac', () => ({
  canManageReferral: jest.fn(() => true),
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/server/audit', () => ({
  resolveAuditActorId: jest.fn(() => 'actor-1'),
}));

jest.mock('@/utils/location', () => ({
  inferStateFromPostalCode: jest.fn(async () => null),
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

jest.mock('@/lib/server/update-request-response', () => ({
  maybeNotifyAdminsOnUpdateRequestResponse: jest.fn(),
}));

jest.mock('@/lib/server/admin-task-reconciler', () => ({
  generateAndReconcileAdminTasks: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/server/auto-update-reminders', () => ({
  hasAhaOosAgentAttached: jest.fn(() => false),
}));

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedPaymentFindOne = Payment.findOne as jest.Mock;
const mockedPaymentUpdateMany = Payment.updateMany as jest.Mock;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

const makeReferralDoc = () => {
  const referralDoc: any = {
    _id: { toString: () => 'ref-1' },
    status: 'Active Lead',
    statusLastUpdated: new Date('2026-03-01T10:00:00.000Z'),
    deletedAt: null,
    assignedAgent: { userId: 'agent-1', ahaDesignation: 'AHA' },
    buySideAgent: null,
    sellSideAgent: null,
    lender: null,
    org: 'org-1',
    origin: 'admin',
    audit: [],
    sla: {},
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
  };

  referralDoc.populate = jest.fn().mockReturnValue(referralDoc);
  return referralDoc;
};

const makeLatestDealDoc = () => ({
  _id: { toString: () => 'pay-1' },
  status: 'under_contract',
  terminatedReason: null,
  expectedAmountCents: 0,
  receivedAmountCents: 0,
  agentAttribution: 'AHA',
  usedAfc: false,
  usedAssignedAgent: true,
  createdAt: new Date('2026-03-10T10:00:00.000Z'),
  updatedAt: new Date('2026-03-10T10:00:00.000Z'),
  save: jest.fn().mockResolvedValue(undefined),
  toObject() {
    return { ...this };
  },
});

describe('Referral status route deal-only updates', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/referrals/[id]/status/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'agent', name: 'Agent User', email: 'agent@example.com' },
    } as any);
  });

  it('keeps referral status unchanged but updates latest deal to closed for agent table source', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);

    const latestDeal = makeLatestDealDoc();
    mockedPaymentFindOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(latestDeal),
    });

    const response: any = await postHandler(makeRequest({ status: 'Closed', source: 'referral_table' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Active Lead');
    expect(referralDoc.status).toBe('Active Lead');
    expect(referralDoc.save).not.toHaveBeenCalled();
    expect(mockedPaymentUpdateMany).not.toHaveBeenCalled();
    expect(latestDeal.status).toBe('closed');
    expect(latestDeal.save).toHaveBeenCalled();
    expect(mockedLogReferralActivity).not.toHaveBeenCalled();
  });

  it('passes terminatedReason to latest deal and keeps referral status unchanged', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);

    const latestDeal = makeLatestDealDoc();
    mockedPaymentFindOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(latestDeal),
    });

    const response: any = await postHandler(
      makeRequest({
        status: 'Terminated',
        source: 'referral_table',
        terminatedReason: 'inspection',
      }),
      { params: { id: 'ref-1' } }
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Active Lead');
    expect(referralDoc.status).toBe('Active Lead');
    expect(referralDoc.save).not.toHaveBeenCalled();
    expect(latestDeal.status).toBe('terminated');
    expect(latestDeal.terminatedReason).toBe('inspection');
    expect(latestDeal.save).toHaveBeenCalled();
  });

  it('notifies admins when an agent persists a referral status change', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockedPaymentFindOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    });

    const response: any = await postHandler(makeRequest({ status: 'Lost' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).toHaveBeenCalled();
  });

  it('does not notify admins when an admin persists a referral status change', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User', email: 'admin@example.com' },
    } as any);
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockedPaymentFindOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    });

    const response: any = await postHandler(makeRequest({ status: 'Lost' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
  });

  it('notifies admins when an MC persists a referral status change', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'mc-1', role: 'mc', name: 'MC User', email: 'mc@example.com' },
    } as any);
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockedPaymentFindOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    });

    const response: any = await postHandler(makeRequest({ status: 'Lost' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).toHaveBeenCalled();
  });
});
