import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
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

jest.mock('@/models/agent', () => ({
  Agent: {
    findOne: jest.fn(),
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

jest.mock('@/lib/server/nps', () => ({
  createNPSToken: jest.fn(),
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
const mockedPaymentExists = Payment.exists as jest.Mock;
const mockedPaymentUpdateMany = Payment.updateMany as jest.Mock;
const mockedPaymentCreate = Payment.create as jest.Mock;
const mockedAgentFindOne = Agent.findOne as jest.Mock;
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

/** Matches Payment.findOne().sort().select().lean(), .sort().lean(), and await .sort() */
function mockPaymentFindOneChain(latestDealForAwaitOnSort: unknown) {
  mockedPaymentFindOne.mockReturnValue({
    sort: jest.fn(() => {
      const afterSort: Record<string, unknown> = {
        select: jest.fn(() => ({
          lean: jest.fn(() => Promise.resolve(null)),
        })),
        lean: jest.fn(() => Promise.resolve(null)),
      };
      afterSort.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(latestDealForAwaitOnSort).then(onFulfilled, onRejected);
      afterSort.catch = (onRejected: (e: unknown) => unknown) =>
        Promise.resolve(latestDealForAwaitOnSort).catch(onRejected);
      return afterSort;
    }),
  });
}

const mockCurrentAgent = (agentId: string | null) => {
  mockedAgentFindOne.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(agentId ? { _id: agentId } : null),
    }),
  });
};

describe('Referral status route table-driven deal status sync', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/referrals/[id]/status/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'agent', name: 'Agent User', email: 'agent@example.com' },
    } as any);
    mockCurrentAgent('agent-db-1');
    mockedPaymentExists.mockResolvedValue(true);
  });

  it('persists referral status and updates latest deal to closed for agent table source', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);

    const latestDeal = makeLatestDealDoc();
    mockPaymentFindOneChain(latestDeal);

    const response: any = await postHandler(makeRequest({ status: 'Closed', source: 'referral_table' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Closed');
    expect(referralDoc.buyStatus).toBe('Closed');
    expect(referralDoc.status).toBe('Closed');
    expect(referralDoc.save).toHaveBeenCalled();
    expect(mockedPaymentUpdateMany).not.toHaveBeenCalled();
    expect(mockedPaymentFindOne).toHaveBeenCalledWith({
      referralId: referralDoc._id,
      usedAssignedAgent: true,
      agentAttribution: { $ne: 'OUTSIDE_AGENT' },
      agentId: 'agent-db-1',
      side: 'buy',
    });
    expect(latestDeal.status).toBe('closed');
    expect(latestDeal.save).toHaveBeenCalled();
    expect(mockedLogReferralActivity).toHaveBeenCalled();
  });

  it('passes terminatedReason to latest deal and persists referral status', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);

    const latestDeal = makeLatestDealDoc();
    mockPaymentFindOneChain(latestDeal);

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
    expect(referralDoc.buyStatus).toBe('Terminated');
    expect(referralDoc.status).toBe('Terminated');
    expect(referralDoc.save).toHaveBeenCalled();
    expect(latestDeal.status).toBe('terminated');
    expect(latestDeal.terminatedReason).toBe('inspection');
    expect(latestDeal.save).toHaveBeenCalled();
  });

  it('updates only the current agent-owned deal when multiple deals exist', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);

    const agentOwnedDeal = { ...makeLatestDealDoc(), _id: { toString: () => 'pay-agent' } };
    const otherAgentDeal = { ...makeLatestDealDoc(), _id: { toString: () => 'pay-other' } };
    mockedPaymentFindOne.mockImplementation((query: any) => {
      const deal = query.agentId === 'agent-db-1' ? agentOwnedDeal : otherAgentDeal;
      return {
        sort: jest.fn(() => {
          const afterSort: Record<string, unknown> = {
            select: jest.fn(() => ({
              lean: jest.fn(() => Promise.resolve(null)),
            })),
            lean: jest.fn(() => Promise.resolve(null)),
          };
          afterSort.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(deal).then(onFulfilled);
          afterSort.catch = (onRejected: (e: unknown) => unknown) => Promise.resolve(deal).catch(onRejected);
          return afterSort;
        }),
      };
    });

    const response: any = await postHandler(makeRequest({ status: 'Closed', source: 'referral_table' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(agentOwnedDeal.status).toBe('closed');
    expect(agentOwnedDeal.save).toHaveBeenCalled();
    expect(otherAgentDeal.status).toBe('under_contract');
    expect(otherAgentDeal.save).not.toHaveBeenCalled();
  });

  it('returns an error when close is requested and agent has no mapped agent record', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockCurrentAgent(null);

    const latestDeal = makeLatestDealDoc();

    const response: any = await postHandler(makeRequest({ status: 'Closed', source: 'referral_table' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(409);
    expect(mockedPaymentFindOne).not.toHaveBeenCalled();
    expect(response.body.currentStatus).toBe('Closed');
    expect(response.body.error.message).toContain('agent profile could not be resolved');
    expect(latestDeal.status).toBe('under_contract');
    expect(latestDeal.save).not.toHaveBeenCalled();
  });

  it('moves referral to Lost and returns error when only unassigned/outside-agent deal is found', async () => {
    const referralDoc = makeReferralDoc();
    mockedReferralFindById.mockReturnValue(referralDoc);

    const unassignedDeal = {
      ...makeLatestDealDoc(),
      usedAssignedAgent: false,
      agentAttribution: 'OUTSIDE_AGENT',
    };

    mockedPaymentFindOne.mockImplementation((query: any) => {
      const responseForAwait =
        Array.isArray(query?.$or) && query.$or.length > 0 ? unassignedDeal : null;
      return {
        sort: jest.fn(() => {
          const afterSort: Record<string, unknown> = {
            select: jest.fn(() => ({
              lean: jest.fn(() => Promise.resolve(null)),
            })),
            lean: jest.fn(() => Promise.resolve(null)),
          };
          afterSort.then = (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve(responseForAwait).then(onFulfilled);
          afterSort.catch = (onRejected: (e: unknown) => unknown) =>
            Promise.resolve(responseForAwait).catch(onRejected);
          return afterSort;
        }),
      };
    });

    const response: any = await postHandler(makeRequest({ status: 'Closed', source: 'referral_table' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(409);
    expect(response.body.currentStatus).toBe('Lost');
    expect(response.body.error.code).toBe('deal_unassigned');
    expect(referralDoc.buyStatus).toBe('Lost');
    expect(referralDoc.status).toBe('Lost');
    expect(referralDoc.save).toHaveBeenCalled();
  });

  it('notifies admins when an agent persists a referral status change', async () => {
    const referralDoc = makeReferralDoc();
    referralDoc.clientType = 'Buyer';
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockPaymentFindOneChain(null);

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
    referralDoc.clientType = 'Buyer';
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockPaymentFindOneChain(null);

    const response: any = await postHandler(makeRequest({ status: 'Lost' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
  });

  it('allows admin to set referral status to Closed', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User', email: 'admin@example.com' },
    } as any);
    const referralDoc = makeReferralDoc();
    referralDoc.clientType = 'Buyer';
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockPaymentFindOneChain(null);

    const response: any = await postHandler(makeRequest({ status: 'Closed', source: 'referral_detail' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Closed');
    expect(referralDoc.buyStatus).toBe('Closed');
    expect(referralDoc.status).toBe('Closed');
    expect(referralDoc.save).toHaveBeenCalled();
  });

  it('allows admin to set referral status to Terminated', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User', email: 'admin@example.com' },
    } as any);
    const referralDoc = makeReferralDoc();
    referralDoc.clientType = 'Buyer';
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockPaymentFindOneChain(null);

    const response: any = await postHandler(
      makeRequest({ status: 'Terminated', source: 'referral_detail', terminatedReason: 'inspection' }),
      { params: { id: 'ref-1' } }
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Terminated');
    expect(referralDoc.buyStatus).toBe('Terminated');
    expect(referralDoc.status).toBe('Terminated');
    expect(referralDoc.save).toHaveBeenCalled();
  });

  it('notifies admins when an admin moves a referral to Under Contract', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'admin', name: 'Admin User', email: 'admin@example.com' },
    } as any);
    const referralDoc = makeReferralDoc();
    referralDoc.borrower = { name: 'Jane Borrower' };
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockedPaymentUpdateMany.mockResolvedValue({ acknowledged: true });
    mockPaymentFindOneChain(null);
    mockedPaymentCreate.mockResolvedValue({
      _id: { toString: () => 'pay-created-1' },
      status: 'under_contract',
      expectedAmountCents: 1000,
      toObject: () => ({ _id: 'pay-created-1', status: 'under_contract', expectedAmountCents: 1000 }),
    });

    const response: any = await postHandler(
      makeRequest({
        status: 'Under Contract',
        source: 'referral_table',
        side: 'buy',
        contractDetails: {
          propertyAddress: '123 Main St',
          propertyCity: 'Denver',
          propertyState: 'CO',
          propertyPostalCode: '80014',
          contractPrice: 450000,
          agentCommissionPercentage: 3,
          referralFeePercentage: 25,
          dealSide: 'buy',
        },
        createNewDeal: false,
      }),
      { params: { id: 'ref-1' } }
    );

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status_change',
        borrowerName: 'Jane Borrower',
        content: expect.stringContaining('Under Contract'),
      })
    );
  });

  it('notifies admins when an MC persists a referral status change', async () => {
    mockedGetCurrentSession.mockResolvedValueOnce({
      user: { id: 'mc-1', role: 'mc', name: 'MC User', email: 'mc@example.com' },
    } as any);
    const referralDoc = makeReferralDoc();
    referralDoc.clientType = 'Buyer';
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockPaymentFindOneChain(null);

    const response: any = await postHandler(makeRequest({ status: 'Lost' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(mockedCreateAdminNotifications).toHaveBeenCalled();
  });

  it('creates a side-scoped under-contract deal using the side agent', async () => {
    const referralDoc = makeReferralDoc();
    referralDoc.buySideAgent = { _id: 'buy-agent-db' };
    referralDoc.sellSideAgent = { _id: 'sell-agent-db' };
    mockedReferralFindById.mockReturnValue(referralDoc);
    mockedPaymentUpdateMany.mockResolvedValue({ acknowledged: true });
    mockPaymentFindOneChain(null);
    mockedPaymentCreate.mockResolvedValue({
      _id: { toString: () => 'pay-created-1' },
      status: 'under_contract',
      expectedAmountCents: 1000,
      toObject: () => ({ _id: 'pay-created-1', status: 'under_contract', expectedAmountCents: 1000 }),
    });

    const response: any = await postHandler(
      makeRequest({
        status: 'Under Contract',
        source: 'referral_table',
        side: 'sell',
        contractDetails: {
          propertyAddress: '123 Main St',
          propertyCity: 'Denver',
          propertyState: 'CO',
          propertyPostalCode: '80014',
          contractPrice: 450000,
          agentCommissionPercentage: 3,
          referralFeePercentage: 25,
          dealSide: 'sell',
        },
        createNewDeal: false,
      }),
      { params: { id: 'ref-1' } }
    );

    expect(response.status).toBe(200);
    expect(mockedPaymentUpdateMany).toHaveBeenCalledWith(
      { referralId: referralDoc._id, status: 'under_contract', side: 'sell' },
      expect.any(Object)
    );
    expect(mockedPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'sell',
        agentId: 'sell-agent-db',
      })
    );
  });
});
