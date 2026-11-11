import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { subHours, subMonths } from 'date-fns';

/** Mongoose-style query: every builder method chains, and awaiting it resolves to `value`. */
const chainableQuery = (value: unknown) => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'sort', 'lean', 'populate', 'limit', 'skip', 'exec']) {
    query[method] = () => query;
  }
  query.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(onFulfilled, onRejected);
  return query;
};

let terminatedPaymentsFixture: unknown[] = [];

const isTerminatedPipeline = (pipeline: unknown) =>
  Array.isArray(pipeline) &&
  pipeline.some(
    (stage) =>
      typeof stage === 'object' &&
      stage !== null &&
      (stage as { $match?: { status?: unknown } }).$match?.status === 'terminated'
  );

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(() => Promise.resolve())
}));

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(() =>
    Promise.resolve({ user: { id: 'admin-1', role: 'admin', name: 'Admin', email: 'admin@example.com' } })
  )
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    find: jest.fn(() => chainableQuery([])),
    aggregate: jest.fn(() => chainableQuery([]))
  }
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    find: jest.fn(() => chainableQuery([])),
    distinct: jest.fn(() => chainableQuery([])),
    aggregate: jest.fn((pipeline: unknown) =>
      chainableQuery(isTerminatedPipeline(pipeline) ? terminatedPaymentsFixture : [])
    )
  }
}));

jest.mock('@/models/agent', () => ({
  Agent: {
    find: jest.fn(() => chainableQuery([])),
    findOne: jest.fn(() => chainableQuery(null))
  }
}));

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: jest.fn(() => chainableQuery([])),
    findOne: jest.fn(() => chainableQuery(null))
  }
}));

jest.mock('@/models/pre-approval-metric', () => ({
  PreApprovalMetric: { find: jest.fn(() => chainableQuery([])) }
}));

jest.mock('@/models/activity', () => ({
  Activity: { aggregate: jest.fn(() => chainableQuery([])) }
}));

jest.mock('@/models/admin-task', () => ({
  ...(jest.requireActual('@/models/admin-task') as Record<string, unknown>),
  AdminTask: { find: jest.fn(() => chainableQuery([])) }
}));

const now = new Date();
const olderInvoiceDate = subMonths(now, 4);

const makeTerminatedPayment = (overrides: Record<string, unknown>, referralOverrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  referralId: new Types.ObjectId(),
  status: 'terminated',
  side: 'buy',
  expectedAmountCents: 0,
  receivedAmountCents: 0,
  usedAssignedAgent: true,
  agentAttribution: 'AHA',
  terminatedReason: 'financing',
  createdAt: subMonths(now, 5),
  updatedAt: now,
  referral: {
    _id: new Types.ObjectId(),
    createdAt: subMonths(now, 6),
    origin: 'admin',
    clientType: 'Buyer',
    referralFeeDueCents: 0,
    ...referralOverrides
  },
  ...overrides
});

const dealsById = {
  adminTerminatedToday: makeTerminatedPayment({
    terminatedAt: now,
    terminatedExpectedAmountCents: 412_500,
    // Older invoice date must not push a deal terminated today out of the current range.
    invoiceDate: olderInvoiceDate,
    terminatedReason: 'inspection'
  }),
  agentTerminatedToday: makeTerminatedPayment({
    terminatedAt: subHours(now, 1),
    terminatedExpectedAmountCents: 375_000
  }),
  legitimateZeroFee: makeTerminatedPayment(
    {
      terminatedAt: subHours(now, 2),
      terminatedExpectedAmountCents: 0,
      contractPriceCents: 50_000_000,
      commissionBasisPoints: 300,
      referralFeeBasisPoints: 2500
    },
    { referralFeeDueCents: 999_999 }
  ),
  legacyWithDealInputs: makeTerminatedPayment({
    invoiceDate: now,
    contractPriceCents: 40_000_000,
    commissionBasisPoints: 300,
    referralFeeBasisPoints: 2500
  }),
  legacyBothSidesReferralFeeOnly: makeTerminatedPayment(
    { invoiceDate: now, side: 'sell' },
    { clientType: 'Both', referralFeeDueCents: 500_000 }
  ),
  terminatedLastPeriod: makeTerminatedPayment({
    terminatedAt: subMonths(now, 4),
    terminatedExpectedAmountCents: 111_111,
    invoiceDate: now
  })
};

const expectedLostFeeById = new Map<string, number>([
  [dealsById.adminTerminatedToday._id.toString(), 412_500],
  [dealsById.agentTerminatedToday._id.toString(), 375_000],
  [dealsById.legitimateZeroFee._id.toString(), 0],
  [dealsById.legacyWithDealInputs._id.toString(), 300_000],
  [dealsById.legacyBothSidesReferralFeeOnly._id.toString(), 0]
]);
const expectedTotalCents = 1_087_500;

describe('Terminated Deals card lost referral fees', () => {
  const originalVercel = process.env.VERCEL;

  beforeAll(() => {
    terminatedPaymentsFixture = Object.values(dealsById);
  });

  afterAll(() => {
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
  });

  it('/api/dashboard reports each saved lost fee and a card total equal to their sum', async () => {
    const { GET } = await import('@/app/api/dashboard/route');
    const response = await GET(new NextRequest('http://localhost/api/dashboard?timeframe=month'));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      main: {
        terminatedDeals: {
          totalLostReferralFeeCents: number;
          totalDeals: number;
          deals: Array<{ id: string; lostReferralFeeCents: number }>;
        };
      };
    };
    const card = body.main.terminatedDeals;

    const actualById = new Map(card.deals.map((deal) => [deal.id, deal.lostReferralFeeCents]));
    expect(actualById).toEqual(expectedLostFeeById);
    expect(actualById.has(dealsById.terminatedLastPeriod._id.toString())).toBe(false);
    expect(card.totalDeals).toBe(expectedLostFeeById.size);
    expect(card.totalLostReferralFeeCents).toBe(expectedTotalCents);
    expect(card.totalLostReferralFeeCents).toBe(
      card.deals.reduce((sum, deal) => sum + deal.lostReferralFeeCents, 0)
    );
  });

  it('dashboard report shows the same corrected lost-fee total', async () => {
    process.env.VERCEL = '1';
    const { buildDashboardReport } = await import('@/lib/server/dashboard-report');

    const report = await buildDashboardReport({
      reportName: 'Terminations',
      reportTimeframe: 'This month',
      metrics: ['termination'],
      origin: 'http://localhost:3000',
      auth: { kind: 'cookie', cookie: '' }
    });

    const section = report.sections.find((s) => s.id === 'termination');
    expect(section?.rows).toEqual(
      expect.arrayContaining([{ label: 'Lost referral fees (total)', value: '$10,875' }])
    );
  });
});
