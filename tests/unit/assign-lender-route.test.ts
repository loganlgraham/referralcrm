import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { LenderMC } from '@/models/lender';
import { logReferralActivity } from '@/lib/server/activities';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';

let postHandler: typeof import('@/app/api/referrals/[id]/assign-lender/route').POST;

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

jest.mock('@/models/lender', () => ({
  LenderMC: {
    findById: jest.fn(),
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

jest.mock('@/lib/email', () => ({
  isTransactionalEmailConfigured: jest.fn(() => false),
  sendTransactionalEmail: jest.fn(),
}));

jest.mock('@/lib/server/admin-task-reconciler', () => ({
  generateAndReconcileAdminTasks: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/referral-links', () => ({
  buildReferralLink: jest.fn((id: string) => `https://app.test/referrals/${id}`),
}));

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedLenderFindById = LenderMC.findById as jest.Mock;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedGenerateAndReconcileAdminTasks = generateAndReconcileAdminTasks as jest.MockedFunction<
  typeof generateAndReconcileAdminTasks
>;
const mockedIsTransactionalEmailConfigured = isTransactionalEmailConfigured as jest.MockedFunction<
  typeof isTransactionalEmailConfigured
>;
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<
  typeof sendTransactionalEmail
>;

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  } as any);

const makeReferralDoc = (overrides: Record<string, unknown> = {}) => {
  const referralDoc: any = {
    _id: { toString: () => 'ref-1' },
    status: 'New Lead',
    buyStatus: 'New Lead',
    sellStatus: 'New Lead',
    clientType: 'Buyer',
    dealSide: 'buy',
    statusLastUpdated: new Date('2026-03-01T10:00:00.000Z'),
    deletedAt: null,
    assignedAgent: {
      userId: 'agent-1',
      name: 'Agent One',
      email: 'agent@example.com',
      phone: '303-555-0100',
      ahaDesignation: 'AHA',
    },
    buySideAgent: null,
    sellSideAgent: null,
    lender: null,
    org: 'AFC',
    origin: 'agent',
    borrower: { name: 'Buyer One', email: 'buyer@example.com', phone: '303-555-0200' },
    audit: [],
    sla: {},
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
    ...overrides,
  };

  referralDoc.populate = jest.fn().mockReturnValue(referralDoc);
  return referralDoc;
};

function mockReferralFindById(doc: ReturnType<typeof makeReferralDoc>) {
  mockedReferralFindById.mockReturnValue(doc);
}

function mockLenderLookup(lenderId: string, data: { name?: string; email?: string; phone?: string } | null) {
  mockedLenderFindById.mockImplementation((id: string) => {
    const lean = jest.fn().mockResolvedValue(
      data && String(id) === String(lenderId)
        ? { _id: id, ...data }
        : data
          ? null
          : null
    );
    return {
      select: jest.fn().mockReturnValue({ lean }),
    };
  });
}

describe('POST /api/referrals/[id]/assign-lender', () => {
  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/referrals/[id]/assign-lender/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', name: 'Admin' },
    } as any);
    mockedIsTransactionalEmailConfigured.mockReturnValue(false);
    mockedGenerateAndReconcileAdminTasks.mockResolvedValue(undefined as any);
    mockLenderLookup('lender-1', {
      name: 'MC One',
      email: 'mc@example.com',
      phone: '303-555-0300',
    });
  });

  it('advances agent-origin New Lead referrals to Paired and sets lastPairedAt', async () => {
    const referral = makeReferralDoc();
    mockReferralFindById(referral);

    const response = await postHandler(makeRequest({ lenderId: 'lender-1' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'ref-1', status: 'Paired' });
    expect(referral.status).toBe('Paired');
    expect(referral.buyStatus).toBe('Paired');
    expect(referral.sla.lastPairedAt).toBeInstanceOf(Date);
    expect(referral.audit.some((entry: { field?: string; newValue?: string }) => entry.field === 'status' && entry.newValue === 'Paired')).toBe(
      true
    );
    expect(mockedGenerateAndReconcileAdminTasks).toHaveBeenCalledWith({
      referralId: 'ref-1',
      trigger: 'referral.status_changed',
      actorId: 'admin-1',
    });
    expect(mockedLogReferralActivity).toHaveBeenCalled();
  });

  it('sets both side statuses to Paired for Both clientType', async () => {
    const referral = makeReferralDoc({
      clientType: 'Both',
      buyStatus: 'New Lead',
      sellStatus: 'New Lead',
    });
    mockReferralFindById(referral);

    const response = await postHandler(makeRequest({ lenderId: 'lender-1' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(referral.buyStatus).toBe('Paired');
    expect(referral.sellStatus).toBe('Paired');
    expect(referral.status).toBe('Paired');
  });

  it('does not change status for non-agent origin referrals', async () => {
    const referral = makeReferralDoc({
      origin: 'admin',
      status: 'New Lead',
      buyStatus: 'New Lead',
    });
    mockReferralFindById(referral);

    const response = await postHandler(makeRequest({ lenderId: 'lender-1' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'ref-1', status: 'New Lead' });
    expect(referral.status).toBe('New Lead');
    expect(referral.sla.lastPairedAt).toBeUndefined();
    expect(mockedGenerateAndReconcileAdminTasks).not.toHaveBeenCalled();
  });

  it('does not regress status when already past New Lead', async () => {
    const referral = makeReferralDoc({
      origin: 'agent',
      status: 'In Communication',
      buyStatus: 'In Communication',
    });
    mockReferralFindById(referral);

    const response = await postHandler(makeRequest({ lenderId: 'lender-1' }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(referral.status).toBe('In Communication');
    expect(referral.buyStatus).toBe('In Communication');
    expect(referral.sla.lastPairedAt).toBeUndefined();
    expect(mockedGenerateAndReconcileAdminTasks).not.toHaveBeenCalled();
  });

  it('does not advance when confirming the same lender assignment', async () => {
    const existingLenderId = 'lender-1';
    const referral = makeReferralDoc({
      origin: 'agent',
      status: 'New Lead',
      buyStatus: 'New Lead',
      lender: { _id: { toString: () => existingLenderId }, name: 'MC One' },
    });
    mockReferralFindById(referral);

    const response = await postHandler(makeRequest({ lenderId: existingLenderId }), {
      params: { id: 'ref-1' },
    });

    expect(response.status).toBe(200);
    expect(referral.status).toBe('New Lead');
    expect(mockedGenerateAndReconcileAdminTasks).not.toHaveBeenCalled();
    expect(mockedSendTransactionalEmail).not.toHaveBeenCalled();
  });
});
