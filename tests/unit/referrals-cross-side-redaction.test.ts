import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { User } from '@/models/user';

let getReferralById: typeof import('@/lib/server/referrals').getReferralById;

jest.mock('mongoose', () => {
  class MockObjectId {
    private value: string;
    constructor(value?: string) {
      this.value = value ?? 'mock-object-id';
    }
    toString() {
      return this.value;
    }
    static isValid() {
      return true;
    }
  }
  return {
    Types: {
      ObjectId: MockObjectId,
    },
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
    findOne: jest.fn(),
  },
}));

jest.mock('@/models/payment', () => ({
  Payment: {
    find: jest.fn(),
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

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: jest.fn(),
  },
}));

jest.mock('@/models/admin-task', () => ({
  AdminTask: {
    aggregate: jest.fn(),
  },
  getEffectiveDueDate: jest.fn(),
}));

jest.mock('@/models/zip', () => ({
  Zip: {
    find: jest.fn(),
  },
}));

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindOne = Referral.findOne as jest.Mock;
const mockedPaymentFind = Payment.find as jest.Mock;
const mockedAgentFindOne = Agent.findOne as jest.Mock;
const mockedUserFind = User.find as jest.Mock;

const buildPopulateChain = <T>(finalValue: T) => {
  const chain: Record<string, unknown> = {};
  chain.populate = jest.fn(() => chain);
  chain.lean = jest.fn().mockResolvedValue(finalValue);
  return chain;
};

const buildSortPopulateChain = <T>(finalValue: T) => ({
  sort: jest.fn().mockReturnValue(buildPopulateChain(finalValue)),
});

describe('getReferralById cross-side redaction', () => {
  beforeAll(async () => {
    ({ getReferralById } = await import('@/lib/server/referrals'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConnectMongo.mockResolvedValue(undefined as any);
    mockedGetCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'agent', name: 'Buy Agent', email: 'buy@example.com' },
    } as any);

    mockedAgentFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: { toString: () => 'agent-buy-id' } }),
      }),
    });

    mockedUserFind.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });
  });

  it('redacts pay-structure fields for opposite-side deals for agents', async () => {
    mockedReferralFindOne.mockReturnValue(
      buildPopulateChain({
        _id: { toString: () => 'ref-1' },
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        referralDate: null,
        statusLastUpdated: new Date('2026-03-10T10:00:00.000Z'),
        deletedAt: null,
        clientType: 'Both',
        dealSide: 'buy',
        buyStatus: 'Under Contract',
        sellStatus: 'Active Lead',
        assignedAgent: null,
        buySideAgent: { _id: { toString: () => 'agent-buy-id' }, name: 'Buy Agent', email: 'buy@example.com' },
        sellSideAgent: { _id: { toString: () => 'agent-sell-id' }, name: 'Sell Agent', email: 'sell@example.com' },
        lender: null,
        notes: [],
        audit: [],
        borrower: { name: 'Borrower Name', email: 'borrower@example.com', phone: '5555555555' },
      })
    );

    mockedPaymentFind.mockReturnValue(
      buildSortPopulateChain([
        {
          _id: { toString: () => 'pay-buy' },
          status: 'under_contract',
          expectedAmountCents: 120000,
          receivedAmountCents: 0,
          netReferralFeePaidCents: null,
          invoiceDate: null,
          paidDate: null,
          closingDate: new Date('2026-05-20T10:00:00.000Z'),
          underContractDate: new Date('2026-03-20T10:00:00.000Z'),
          createdAt: new Date('2026-03-20T10:00:00.000Z'),
          updatedAt: new Date('2026-03-20T10:00:00.000Z'),
          terminatedReason: null,
          agentAttribution: 'AHA',
          propertyAddress: '123 Buy St',
          propertyCity: 'Denver',
          propertyState: 'CO',
          agentId: { _id: { toString: () => 'agent-buy-id' }, name: 'Buy Agent' },
          usedAfc: true,
          usedAssignedAgent: true,
          commissionBasisPoints: 300,
          referralFeeBasisPoints: 2500,
          contractPriceCents: 50000000,
          side: 'buy',
          feeBreakdownEmailSentAt: null,
          feeBreakdownEmailSentBy: null,
        },
        {
          _id: { toString: () => 'pay-sell' },
          status: 'closed',
          expectedAmountCents: 110000,
          receivedAmountCents: 105000,
          netReferralFeePaidCents: 105000,
          invoiceDate: null,
          paidDate: new Date('2026-06-10T10:00:00.000Z'),
          closingDate: new Date('2026-05-25T10:00:00.000Z'),
          underContractDate: new Date('2026-03-25T10:00:00.000Z'),
          createdAt: new Date('2026-03-25T10:00:00.000Z'),
          updatedAt: new Date('2026-06-10T10:00:00.000Z'),
          terminatedReason: null,
          agentAttribution: 'AHA',
          propertyAddress: '987 Sell Ave',
          propertyCity: 'Boulder',
          propertyState: 'CO',
          agentId: { _id: { toString: () => 'agent-sell-id' }, name: 'Sell Agent' },
          usedAfc: false,
          usedAssignedAgent: true,
          commissionBasisPoints: 275,
          referralFeeBasisPoints: 3000,
          contractPriceCents: 42000000,
          side: 'sell',
          feeBreakdownEmailSentAt: null,
          feeBreakdownEmailSentBy: null,
        },
      ])
    );

    const referral = await getReferralById('ref-1');
    expect(referral).not.toBeNull();
    expect(referral?.viewerAssignedSide).toBe('buy');

    const ownSideDeal = referral?.payments?.find((deal) => deal._id === 'pay-buy');
    const crossSideDeal = referral?.payments?.find((deal) => deal._id === 'pay-sell');
    expect(ownSideDeal).toBeDefined();
    expect(crossSideDeal).toBeDefined();

    expect(ownSideDeal?.isCrossSideReadOnly).toBe(false);
    expect(ownSideDeal?.commissionBasisPoints).toBe(300);
    expect(ownSideDeal?.referralFeeBasisPoints).toBe(2500);
    expect(ownSideDeal?.expectedAmountCents).toBe(120000);
    expect(ownSideDeal?.usedAssignedAgent).toBe(true);

    expect(crossSideDeal?.isCrossSideReadOnly).toBe(true);
    expect(crossSideDeal?.commissionBasisPoints).toBeNull();
    expect(crossSideDeal?.referralFeeBasisPoints).toBeNull();
    expect(crossSideDeal?.expectedAmountCents).toBeNull();
    expect(crossSideDeal?.receivedAmountCents).toBeNull();
    expect(crossSideDeal?.netReferralFeePaidCents).toBeNull();
    expect(crossSideDeal?.usedAfc).toBeUndefined();
    expect(crossSideDeal?.usedAssignedAgent).toBeUndefined();
    expect(crossSideDeal?.contractPriceCents).toBe(42000000);
    expect(crossSideDeal?.propertyAddress).toBe('987 Sell Ave');
    expect(crossSideDeal?.agent?.name).toBe('Sell Agent');
  });
});
