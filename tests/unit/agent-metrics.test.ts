import { Types } from 'mongoose';

import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { computeAgentMetrics } from '@/lib/server/agent-metrics';

jest.mock('@/models/referral', () => ({
  Referral: { find: jest.fn() },
}));

jest.mock('@/models/payment', () => ({
  Payment: { aggregate: jest.fn() },
}));

const mockReferralFind = Referral.find as jest.Mock;
const mockPaymentAggregate = Payment.aggregate as jest.Mock;

function chainLean<T>(result: T) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(result),
    }),
  };
}

describe('computeAgentMetrics', () => {
  const agentId = new Types.ObjectId();
  const otherAgentId = new Types.ObjectId();
  const referralId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attributes referrals and won payments through side-specific agent fields', async () => {
    mockReferralFind.mockImplementation(() =>
      chainLean([
        {
          _id: referralId,
          assignedAgent: otherAgentId,
          buySideAgent: agentId,
          sellSideAgent: null,
          status: 'Under Contract',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          sla: { timeToFirstAgentContactHours: 6 },
          commissionBasisPoints: 300,
          referralFeeDueCents: 10000,
          closedPriceCents: 50000000,
        },
      ]),
    );
    mockPaymentAggregate.mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        agentId: null,
        side: 'buy',
        status: 'paid',
        receivedAmountCents: 10000,
        contractPriceCents: 50000000,
        paidDate: new Date(),
        closingDate: new Date(),
        usedAssignedAgent: true,
        agentAttribution: 'AHA',
        referral: {
          _id: referralId,
          assignedAgent: otherAgentId,
          buySideAgent: agentId,
          sellSideAgent: null,
          status: 'Under Contract',
          sla: {},
          commissionBasisPoints: 300,
          referralFeeDueCents: 10000,
          closedPriceCents: 50000000,
        },
      },
    ]);

    const metrics = await computeAgentMetrics([agentId]);
    const agentMetrics = metrics.get(agentId.toString());

    expect(agentMetrics?.totalReferrals).toBe(1);
    expect(agentMetrics?.activePipeline).toBe(1);
    expect(agentMetrics?.dealsClosedAllTime).toBe(1);
    expect(agentMetrics?.closingRate).toBe(100);
    expect(agentMetrics?.totalReferralFeesPaidCents).toBe(10000);
    expect(agentMetrics?.totalNetIncomeCents).toBe(1490000);
  });

  it('excludes outside-agent and lost-assigned-agent payments from closed and net income metrics', async () => {
    mockReferralFind.mockImplementation(() =>
      chainLean([
        {
          _id: referralId,
          assignedAgent: agentId,
          buySideAgent: null,
          sellSideAgent: null,
          status: 'Paired',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          sla: {},
          commissionBasisPoints: 300,
          referralFeeDueCents: 10000,
          closedPriceCents: 50000000,
        },
      ]),
    );
    mockPaymentAggregate.mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        agentId,
        side: 'buy',
        status: 'paid',
        receivedAmountCents: 10000,
        contractPriceCents: 50000000,
        usedAssignedAgent: false,
        agentAttribution: 'AHA',
        referral: {
          _id: referralId,
          assignedAgent: agentId,
          buySideAgent: null,
          sellSideAgent: null,
          status: 'Paired',
          sla: {},
          commissionBasisPoints: 300,
          referralFeeDueCents: 10000,
          closedPriceCents: 50000000,
        },
      },
      {
        _id: new Types.ObjectId(),
        agentId,
        side: 'buy',
        status: 'paid',
        receivedAmountCents: 10000,
        contractPriceCents: 50000000,
        usedAssignedAgent: true,
        agentAttribution: 'OUTSIDE_AGENT',
        referral: {
          _id: referralId,
          assignedAgent: agentId,
          buySideAgent: null,
          sellSideAgent: null,
          status: 'Paired',
          sla: {},
          commissionBasisPoints: 300,
          referralFeeDueCents: 10000,
          closedPriceCents: 50000000,
        },
      },
    ]);

    const metrics = await computeAgentMetrics([agentId]);
    const agentMetrics = metrics.get(agentId.toString());

    expect(agentMetrics?.totalReferrals).toBe(1);
    expect(agentMetrics?.dealsClosedAllTime).toBe(0);
    expect(agentMetrics?.closingRate).toBe(0);
    expect(agentMetrics?.totalReferralFeesPaidCents).toBe(0);
    expect(agentMetrics?.totalNetIncomeCents).toBe(0);
  });

  it('uses the narrower active pipeline status set', async () => {
    mockReferralFind.mockImplementation(() =>
      chainLean([
        {
          _id: new Types.ObjectId(),
          assignedAgent: agentId,
          status: 'New Lead',
          createdAt: new Date(),
          sla: {},
        },
        {
          _id: new Types.ObjectId(),
          assignedAgent: agentId,
          status: 'In Communication',
          createdAt: new Date(),
          sla: {},
        },
      ]),
    );
    mockPaymentAggregate.mockResolvedValue([]);

    const metrics = await computeAgentMetrics([agentId]);
    const agentMetrics = metrics.get(agentId.toString());

    expect(agentMetrics?.totalReferrals).toBe(2);
    expect(agentMetrics?.activePipeline).toBe(1);
  });
});
