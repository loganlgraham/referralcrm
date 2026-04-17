import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';

const referralFindMock = jest.fn();
const referralAggregateMock = jest.fn();
const paymentDistinctMock = jest.fn();
const agentFindMock = jest.fn();
const lenderFindMock = jest.fn();

jest.mock('@/models/referral', () => ({
  Referral: {
    find: (...args: unknown[]) => referralFindMock(...args),
    aggregate: (...args: unknown[]) => referralAggregateMock(...args)
  }
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    distinct: (...args: unknown[]) => paymentDistinctMock(...args)
  }
}));

jest.mock('@/models/agent', () => ({
  Agent: {
    find: (...args: unknown[]) => agentFindMock(...args)
  }
}));

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: (...args: unknown[]) => lenderFindMock(...args)
  }
}));

const buildLeanQuery = <T,>(value: T) => ({
  select: () => ({
    lean: () => Promise.resolve(value)
  }),
  lean: () => Promise.resolve(value)
});

const originalFetch = global.fetch;

describe('buildDashboardReport', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    referralFindMock.mockReturnValue(buildLeanQuery([]));
    referralAggregateMock.mockResolvedValue([]);
    paymentDistinctMock.mockResolvedValue([]);
    agentFindMock.mockReturnValue(buildLeanQuery([]));
    lenderFindMock.mockReturnValue(buildLeanQuery([]));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockDashboardResponse = (overrides: Record<string, unknown> = {}) => {
    const payload = {
      main: {
        summary: {
          totalReferrals: 53,
          dealsClosed: 4,
          dealsClosedInTimeframe: 4,
          dealsUnderContract: 6,
          closeRate: 7.5,
          activePipeline: 41,
          expectedRevenueCents: 4_620_800,
          realizedRevenueCents: 1_200_000,
          afcAttachRate: 80,
          afcDealsLost: 1,
          ahaAttachRate: 50,
          ahaDealsLost: 2,
          ahaOosAttachRate: 33,
          ahaOosDealsLost: 1
        },
        funnel: { stages: [{ status: 'New Lead', count: 5 }] },
        revenueByState: [
          { label: 'CO', value: 800_000 },
          { label: 'GA', value: 200_000 },
          { label: 'Unknown', value: 0 }
        ],
        trends: { revenue: [{ key: 'w1', label: 'Apr 1', value: 1_200_000 }] },
        terminatedDeals: { breakdown: [{ label: 'Inspection', value: 3 }], totalLostReferralFeeCents: 90_000 }
      },
      ...overrides
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
      text: async () => ''
    }) as unknown as typeof fetch;
  };

  it('drops "Unknown" and zero-revenue rows from the geography section', async () => {
    mockDashboardResponse();
    const { buildDashboardReport } = await import('@/lib/server/dashboard-report');

    const report = await buildDashboardReport({
      reportName: 'Test',
      reportTimeframe: 'This month',
      metrics: ['geography'],
      origin: 'http://localhost:3000',
      auth: { kind: 'cookie', cookie: '' }
    });

    const section = report.sections.find((s) => s.id === 'geography');
    expect(section).toBeDefined();
    expect(section?.rows.map((r) => r.label)).toEqual(['CO', 'GA']);
    expect(section?.rows[0].value).toBe('$8,000');
  });

  it('buckets referrals by network with Unpaired/AHA/AHA OOS/AFC', async () => {
    mockDashboardResponse();
    const agentAhaId = new Types.ObjectId();
    const agentOosId = new Types.ObjectId();
    const agentAfcId = new Types.ObjectId();

    referralFindMock.mockReturnValueOnce(
      buildLeanQuery([
        // Unpaired (no lender)
        { _id: new Types.ObjectId(), lender: null, ahaBucket: null, org: 'AFC', assignedAgent: null },
        // Paired + AHA agent
        { _id: new Types.ObjectId(), lender: new Types.ObjectId(), ahaBucket: null, org: 'AHA', assignedAgent: agentAhaId },
        // Paired + AHA_OOS agent
        { _id: new Types.ObjectId(), lender: new Types.ObjectId(), ahaBucket: null, org: 'AHA', assignedAgent: agentOosId },
        // Paired + AFC fallback (no AHA designation)
        { _id: new Types.ObjectId(), lender: new Types.ObjectId(), ahaBucket: null, org: 'AFC', assignedAgent: agentAfcId },
        // Paired + ahaBucket signal even without agent
        { _id: new Types.ObjectId(), lender: new Types.ObjectId(), ahaBucket: 'AHA_OOS', org: 'AFC', assignedAgent: null }
      ])
    );

    agentFindMock.mockReturnValueOnce(
      buildLeanQuery([
        { _id: agentAhaId, ahaDesignation: 'AHA' },
        { _id: agentOosId, ahaDesignation: 'AHA_OOS' },
        { _id: agentAfcId, ahaDesignation: null }
      ])
    );

    const { buildDashboardReport } = await import('@/lib/server/dashboard-report');

    const report = await buildDashboardReport({
      reportName: 'Test',
      reportTimeframe: 'This month',
      metrics: ['network'],
      origin: 'http://localhost:3000',
      auth: { kind: 'cookie', cookie: '' }
    });

    const section = report.sections.find((s) => s.id === 'network');
    expect(section).toBeDefined();
    const rows = Object.fromEntries((section?.rows ?? []).map((row) => [row.label, row.value]));
    expect(rows).toEqual({
      AHA: '1',
      'AHA OOS': '2',
      AFC: '1',
      Unpaired: '1'
    });
  });

  it('lists mortgage consultants with their transfer counts', async () => {
    mockDashboardResponse();
    const lenderAId = new Types.ObjectId();
    const lenderBId = new Types.ObjectId();

    referralAggregateMock.mockResolvedValueOnce([
      { _id: lenderAId, total: 7 },
      { _id: lenderBId, total: 3 }
    ]);

    lenderFindMock.mockReturnValueOnce(
      buildLeanQuery([
        { _id: lenderAId, name: 'Karim L' },
        { _id: lenderBId, name: 'Umed Y' }
      ])
    );

    const { buildDashboardReport } = await import('@/lib/server/dashboard-report');

    const report = await buildDashboardReport({
      reportName: 'Test',
      reportTimeframe: 'This month',
      metrics: ['preApprovals'],
      origin: 'http://localhost:3000',
      auth: { kind: 'cookie', cookie: '' }
    });

    const section = report.sections.find((s) => s.id === 'preApprovals');
    expect(section?.rows).toEqual([
      { label: 'Karim L', value: '7 transfers' },
      { label: 'Umed Y', value: '3 transfers' }
    ]);
  });

  it('summary section uses canonical KPIs and includes Under Contract count', async () => {
    mockDashboardResponse();
    paymentDistinctMock.mockResolvedValueOnce([new Types.ObjectId(), new Types.ObjectId()]);

    const { buildDashboardReport } = await import('@/lib/server/dashboard-report');

    const report = await buildDashboardReport({
      reportName: 'Test',
      reportTimeframe: 'This month',
      metrics: ['summary'],
      origin: 'http://localhost:3000',
      auth: { kind: 'cookie', cookie: '' }
    });

    const summary = report.sections.find((s) => s.id === 'summary');
    const rows = Object.fromEntries((summary?.rows ?? []).map((row) => [row.label, row.value]));
    expect(rows['Total referrals']).toBe('53');
    expect(rows['Deals closed (in period)']).toBe('4');
    expect(rows['Referrals that entered Under Contract']).toBe('2');
    expect(rows['Close rate']).toBe('7.5%');
    expect(rows['Revenue received']).toBe('$12,000');
    expect(rows['Expected revenue (outstanding)']).toBe('$46,208');
  });
});
