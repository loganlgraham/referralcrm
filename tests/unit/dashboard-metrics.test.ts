/**
 * Dashboard Metrics Calculation Tests
 * 
 * These tests verify the correctness of metric calculations across all 4 dashboards:
 * - Main Dashboard (revenue, close rates, pipeline)
 * - MC Dashboard (mortgage consultant metrics)
 * - Agent Dashboard (agent performance metrics)
 * - Admin Dashboard (SLA metrics)
 */

import { describe, it, expect } from '@jest/globals';
import { wasTaskResolvedOnOrBeforeDueDate } from '@/lib/admin-task-timeliness';
import {
  AHA_NEUTRAL_SCORE,
  compareAhaRankedAgents,
  computeAhaReliabilityFactor,
  computeCappedActivityUsageScore,
  normalizeAhaKpiMap
} from '@/lib/server/aha-leaderboard-scoring';
import { resolvePushbackMetricsInTimeframe } from '@/lib/server/pushback-metrics';

describe('Dashboard Metrics - Close Rate Calculation', () => {
  it('calculates close rate correctly when referrals and deals are in same timeframe', () => {
    // Scenario: 10 referrals created this month, 3 have closed
    const totalReferrals = 10;
    const dealsClosed = 3;
    const closeRate = totalReferrals === 0 ? 0 : (dealsClosed / totalReferrals) * 100;
    
    expect(closeRate).toBe(30);
  });

  it('returns 0% close rate when no referrals exist', () => {
    const totalReferrals = 0;
    const dealsClosed = 0;
    const closeRate = totalReferrals === 0 ? 0 : (dealsClosed / totalReferrals) * 100;
    
    expect(closeRate).toBe(0);
  });

  it('handles case where deals closed exceeds referrals in timeframe', () => {
    // This can happen if old referrals close during the timeframe
    // With the fix, we only count deals from referrals created in the timeframe
    const totalReferrals = 5;
    const dealsClosed = 3; // Should be filtered to only include deals from the 5 referrals
    const closeRate = totalReferrals === 0 ? 0 : (dealsClosed / totalReferrals) * 100;
    
    expect(closeRate).toBe(60);
  });

  it('uses cohort-matched closed deals for MC close rate leaderboard', () => {
    const referralByMcMap = new Map([['mcA', 1]]);
    const filteredReferralIds = new Set(['new-referral']);

    const paymentsByNetwork = [
      {
        status: 'closed',
        agentAttribution: 'AHA',
        usedAssignedAgent: true,
        referral: { _id: 'old-referral', lender: 'mcA' }
      }
    ];

    const isClosedDealEligible = (payment: (typeof paymentsByNetwork)[number]) =>
      ['closed', 'payment_sent', 'paid'].includes(payment.status) &&
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent !== false;

    const cohortClosedByMc = new Map<string, number>();
    paymentsByNetwork
      .filter(
        (payment) =>
          isClosedDealEligible(payment) &&
          filteredReferralIds.has(payment.referral._id)
      )
      .forEach((payment) => {
        const mcKey = payment.referral.lender ?? 'unassigned';
        cohortClosedByMc.set(mcKey, (cohortClosedByMc.get(mcKey) ?? 0) + 1);
      });

    const dealsClosed = cohortClosedByMc.get('mcA') ?? 0;
    const totalReferrals = referralByMcMap.get('mcA') ?? 0;
    const closeRate = totalReferrals === 0 ? 0 : (dealsClosed / totalReferrals) * 100;

    expect(dealsClosed).toBe(0);
    expect(closeRate).toBe(0);
  });

  it('prevents impossible agent close rates with cohort-based numerator', () => {
    const agentReferralCount = new Map([['agentA', 1]]);
    const filteredReferralIds = new Set(['new-referral']);

    const paymentsByNetwork = [
      {
        status: 'closed',
        agentAttribution: 'AHA',
        usedAssignedAgent: true,
        referral: { _id: 'old-referral', assignedAgent: 'agentA' }
      },
      {
        status: 'paid',
        agentAttribution: 'AHA',
        usedAssignedAgent: true,
        referral: { _id: 'old-referral-2', assignedAgent: 'agentA' }
      }
    ];

    const isClosedDealEligible = (payment: (typeof paymentsByNetwork)[number]) =>
      ['closed', 'payment_sent', 'paid'].includes(payment.status) &&
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent !== false;

    const cohortClosedByAgent = new Map<string, number>();
    paymentsByNetwork
      .filter(
        (payment) =>
          isClosedDealEligible(payment) &&
          filteredReferralIds.has(payment.referral._id)
      )
      .forEach((payment) => {
        const agentKey = payment.referral.assignedAgent ?? 'unassigned';
        cohortClosedByAgent.set(agentKey, (cohortClosedByAgent.get(agentKey) ?? 0) + 1);
      });

    const dealsClosed = cohortClosedByAgent.get('agentA') ?? 0;
    const totalReferrals = agentReferralCount.get('agentA') ?? 0;
    const closeRate = totalReferrals === 0 ? 0 : (dealsClosed / totalReferrals) * 100;

    expect(dealsClosed).toBe(0);
    expect(closeRate).toBeLessThanOrEqual(100);
    expect(closeRate).toBe(0);
  });
});

describe('Dashboard Metrics - Closed Deal Eligibility', () => {
  it('counts closed-like deals, excludes outside agent, and allows null usedAssignedAgent', () => {
    const payments = [
      { status: 'closed', agentAttribution: 'AHA', usedAssignedAgent: true },
      { status: 'payment_sent', agentAttribution: 'AHA', usedAssignedAgent: null },
      { status: 'paid', agentAttribution: 'AHA_OOS', usedAssignedAgent: undefined },
      { status: 'paid', agentAttribution: 'OUTSIDE_AGENT', usedAssignedAgent: true },
      { status: 'closed', agentAttribution: 'AHA', usedAssignedAgent: false },
    ];

    const isClosedEligible = (payment: (typeof payments)[number]) =>
      ['closed', 'payment_sent', 'paid'].includes(payment.status) &&
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent !== false;

    const closedCount = payments.filter(isClosedEligible).length;
    expect(closedCount).toBe(3);
  });
});

describe('Dashboard Metrics - Revenue Calculations', () => {
  it('calculates realized revenue from received amounts', () => {
    const payments = [
      { receivedAmountCents: 50000, agentAttribution: 'AHA' },
      { receivedAmountCents: 75000, agentAttribution: 'AHA_OOS' },
      { receivedAmountCents: 30000, agentAttribution: 'OUTSIDE_AGENT' }, // Should be excluded
    ];
    
    const revenueEligiblePayments = payments.filter(
      (payment) => payment.agentAttribution !== 'OUTSIDE_AGENT'
    );
    const realizedRevenueCents = revenueEligiblePayments.reduce(
      (sum, payment) => sum + (payment.receivedAmountCents ?? 0),
      0
    );
    
    expect(realizedRevenueCents).toBe(125000);
  });

  it('calculates expected revenue correctly', () => {
    const payments = [
      { status: 'under_contract', expectedAmountCents: 50000, receivedAmountCents: 0 },
      { status: 'closed', expectedAmountCents: 75000, receivedAmountCents: 50000 },
      { status: 'paid', expectedAmountCents: 100000, receivedAmountCents: 100000 },
    ];
    
    const calculateOutstandingExpected = (payment: typeof payments[0]) => {
      const outstanding = Math.max(
        (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0),
        0
      );
      
      const EXPECTED_REVENUE_STATUSES = new Set([
        'under_contract',
        'past_inspection',
        'past_appraisal',
        'clear_to_close',
        'closed',
        'payment_sent'
      ]);
      
      if (EXPECTED_REVENUE_STATUSES.has(payment.status)) {
        return outstanding;
      }
      
      if (payment.status === 'paid' && outstanding > 0) {
        return outstanding;
      }
      
      return 0;
    };
    
    const expectedRevenueCents = payments.reduce(
      (sum, payment) => sum + calculateOutstandingExpected(payment),
      0
    );
    
    // 50000 (under_contract) + 25000 (closed, outstanding) + 0 (paid, fully paid) = 75000
    expect(expectedRevenueCents).toBe(75000);
  });

  it('calculates closed not paid correctly', () => {
    const payments = [
      { status: 'closed', expectedAmountCents: 100000, receivedAmountCents: 0 },
      { status: 'closed', expectedAmountCents: 50000, receivedAmountCents: 30000 },
      { status: 'paid', expectedAmountCents: 75000, receivedAmountCents: 75000 },
      { status: 'paid', expectedAmountCents: 60000, receivedAmountCents: 50000 }, // Partial payment
    ];
    
    const closedNotPaidCents = payments.reduce((sum, payment) => {
      if (payment.status === 'closed') {
        const outstanding = (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0);
        return sum + Math.max(outstanding, 0);
      }
      if (payment.status === 'paid' && (payment.receivedAmountCents ?? 0) < (payment.expectedAmountCents ?? 0)) {
        const outstanding = (payment.expectedAmountCents ?? 0) - (payment.receivedAmountCents ?? 0);
        return sum + Math.max(outstanding, 0);
      }
      return sum;
    }, 0);
    
    // 100000 + 20000 + 0 + 10000 = 130000
    expect(closedNotPaidCents).toBe(130000);
  });
});

describe('Dashboard Metrics - Average Calculations', () => {
  it('calculates average correctly', () => {
    const computeAverage = (values: number[]): number => {
      if (!values.length) return 0;
      const total = values.reduce((sum, value) => sum + value, 0);
      return total / values.length;
    };
    
    expect(computeAverage([10, 20, 30])).toBe(20);
    expect(computeAverage([100])).toBe(100);
    expect(computeAverage([])).toBe(0);
  });

  it('calculates average days closed to paid correctly', () => {
    const daysValues = [5, 10, 15, 20];
    const average = daysValues.reduce((sum, value) => sum + value, 0) / daysValues.length;
    
    expect(average).toBe(12.5);
  });

  it('calculates average commission percentage correctly', () => {
    // Basis points: 3000 = 3%, 2500 = 2.5%, 3500 = 3.5%
    const commissionBasisPoints = [3000, 2500, 3500];
    const commissionPercentages = commissionBasisPoints.map(bp => bp / 100);
    const average = commissionPercentages.reduce((sum, value) => sum + value, 0) / commissionPercentages.length;
    
    expect(average).toBe(30); // Average of 30%, 25%, 35%
  });

  it('resolves a commission percentage for every closed deal, converting dollar (flat-fee) commissions to a percent', () => {
    const DEFAULT_AGENT_COMMISSION_BPS = 300; // 3% default from src/constants/referrals.ts

    // Mirrors the resolution in src/app/api/dashboard/route.ts. Flat-fee (dollar)
    // commissions are converted to a percent and take precedence, because deals
    // entered in "$" mode store the dollar amount and clear the basis points while
    // the referral still carries the default 3%.
    const resolveCommissionPercent = (payment: {
      commissionBasisPoints?: number | null;
      commissionFlatFeeCents?: number | null;
      contractPriceCents?: number | null;
      referral?: { commissionBasisPoints?: number | null } | null;
    }): number => {
      const contractPriceCents = payment.contractPriceCents ?? 0;
      const flatFeeCents = payment.commissionFlatFeeCents ?? 0;
      if (flatFeeCents > 0) {
        return contractPriceCents > 0 ? (flatFeeCents / contractPriceCents) * 100 : 0;
      }
      const resolvedBps =
        (payment.commissionBasisPoints ?? 0) > 0
          ? payment.commissionBasisPoints!
          : (payment.referral?.commissionBasisPoints ?? 0) > 0
            ? payment.referral!.commissionBasisPoints!
            : DEFAULT_AGENT_COMMISSION_BPS;
      return resolvedBps / 100;
    };

    // A dollar (flat-fee) commission is converted to a percent of the contract price,
    // even when the referral carries the default 3% basis points.
    expect(
      resolveCommissionPercent({
        commissionFlatFeeCents: 1_000_000,
        contractPriceCents: 40_000_000,
        referral: { commissionBasisPoints: 300 }
      })
    ).toBe(2.5);
    // Payment-level basis points win over referral-level.
    expect(
      resolveCommissionPercent({ commissionBasisPoints: 250, referral: { commissionBasisPoints: 300 } })
    ).toBe(2.5);
    // Falls back to referral basis points when no payment-level commission is set.
    expect(resolveCommissionPercent({ referral: { commissionBasisPoints: 350 } })).toBe(3.5);
    // A closed deal with no commission data still contributes the 3% default.
    expect(resolveCommissionPercent({ referral: null })).toBe(3);

    // Every closed deal with a resolvable percentage contributes exactly one sample.
    const closedDeals = [
      { commissionFlatFeeCents: 1_000_000, contractPriceCents: 40_000_000, referral: { commissionBasisPoints: 300 } },
      { commissionBasisPoints: 250, referral: { commissionBasisPoints: 300 } },
      { referral: { commissionBasisPoints: 350 } },
      { referral: null },
    ];
    const percentages = closedDeals.map(resolveCommissionPercent).filter((value) => value > 0);
    expect(percentages).toHaveLength(closedDeals.length);
    const average = percentages.reduce((sum, value) => sum + value, 0) / percentages.length;
    expect(average).toBeCloseTo((2.5 + 2.5 + 3.5 + 3) / 4, 5);
  });
});

describe('Dashboard Metrics - Network Filtering', () => {
  it('filters payments by AHA network correctly', () => {
    const payments = [
      { id: '1', agentDesignation: 'AHA' },
      { id: '2', agentDesignation: 'AHA_OOS' },
      { id: '3', agentDesignation: 'AHA' },
      { id: '4', agentDesignation: null },
    ];
    
    const matchesNetwork = (designation: string | null, filter: 'ALL' | 'AHA' | 'AHA_OOS') => {
      if (filter === 'ALL') return true;
      return designation === filter;
    };
    
    const ahaPayments = payments.filter(p => matchesNetwork(p.agentDesignation, 'AHA'));
    expect(ahaPayments).toHaveLength(2);
    expect(ahaPayments.map(p => p.id)).toEqual(['1', '3']);
  });

  it('filters payments by AHA_OOS network correctly', () => {
    const payments = [
      { id: '1', agentDesignation: 'AHA' },
      { id: '2', agentDesignation: 'AHA_OOS' },
      { id: '3', agentDesignation: 'AHA' },
      { id: '4', agentDesignation: null },
    ];
    
    const matchesNetwork = (designation: string | null, filter: 'ALL' | 'AHA' | 'AHA_OOS') => {
      if (filter === 'ALL') return true;
      return designation === filter;
    };
    
    const ahaOosPayments = payments.filter(p => matchesNetwork(p.agentDesignation, 'AHA_OOS'));
    expect(ahaOosPayments).toHaveLength(1);
    expect(ahaOosPayments[0].id).toBe('2');
  });
});

describe('Dashboard Metrics - Attach Rate Calculations', () => {
  const CLOSED_DEAL_STATUSES = new Set(['closed', 'payment_sent', 'paid']);

  const closedInTimeframe = (closingDateIso: string, startIso: string, endIso: string) => {
    const closingDate = new Date(closingDateIso);
    const start = new Date(startIso);
    const end = new Date(endIso);
    return closingDate >= start && closingDate <= end;
  };

  type AttachPayment = {
    status: string;
    usedAfc?: boolean;
    usedAssignedAgent?: boolean;
    referralOrg?: 'AFC' | 'AHA';
    side?: 'buy' | 'sell' | null;
    referralDealSide?: 'buy' | 'sell' | null;
    referralClientType?: 'Buyer' | 'Seller' | 'Both' | null;
    designation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
    closingDateIso: string;
  };

  const computeAttachRates = (payments: AttachPayment[], startIso: string, endIso: string) => {
    const closedDealsInTimeframe = payments.filter(
      (payment) =>
        CLOSED_DEAL_STATUSES.has(payment.status) &&
        closedInTimeframe(payment.closingDateIso, startIso, endIso)
    );

    const resolveSide = (payment: AttachPayment): 'buy' | 'sell' | null => {
      if (payment.side === 'buy' || payment.side === 'sell') return payment.side;
      if (payment.referralDealSide === 'buy' || payment.referralDealSide === 'sell') return payment.referralDealSide;
      if (payment.referralClientType === 'Seller') return 'sell';
      if (payment.referralClientType === 'Buyer') return 'buy';
      return null;
    };

    const afcRelevant = closedDealsInTimeframe.filter(
      (payment) => payment.referralOrg === 'AFC' && resolveSide(payment) === 'buy'
    );
    const afcAttached = afcRelevant.filter((payment) => Boolean(payment.usedAfc));

    const ahaRelevant = closedDealsInTimeframe.filter((payment) => payment.designation === 'AHA');
    const ahaAttached = ahaRelevant.filter((payment) => Boolean(payment.usedAssignedAgent));

    const ahaOosRelevant = closedDealsInTimeframe.filter((payment) => payment.designation === 'AHA_OOS');
    const ahaOosAttached = ahaOosRelevant.filter((payment) => Boolean(payment.usedAssignedAgent));

    return {
      afcAttachRate: afcRelevant.length ? (afcAttached.length / afcRelevant.length) * 100 : 0,
      ahaAttachRate: ahaRelevant.length ? (ahaAttached.length / ahaRelevant.length) * 100 : 0,
      ahaOosAttachRate: ahaOosRelevant.length ? (ahaOosAttached.length / ahaOosRelevant.length) * 100 : 0,
      afcDealsLost: afcRelevant.length - afcAttached.length,
      ahaDealsLost: ahaRelevant.length - ahaAttached.length,
      ahaOosDealsLost: ahaOosRelevant.length - ahaOosAttached.length,
    };
  };

  it('treats closed, payment sent, and paid as closed deals', () => {
    const dealStatuses = ['closed', 'payment_sent', 'paid', 'under_contract'];

    const closedDeals = dealStatuses.filter((status) => CLOSED_DEAL_STATUSES.has(status));
    expect(closedDeals).toEqual(['closed', 'payment_sent', 'paid']);
  });

  it('uses closing date window for attach-rate inclusion', () => {
    const rates = computeAttachRates(
      [
        {
          status: 'closed',
          usedAfc: true,
          usedAssignedAgent: true,
          referralOrg: 'AFC',
          side: 'buy',
          designation: 'AHA',
          closingDateIso: '2026-03-12T12:00:00.000Z',
        },
        {
          status: 'closed',
          usedAfc: true,
          usedAssignedAgent: true,
          referralOrg: 'AFC',
          side: 'buy',
          designation: 'AHA',
          closingDateIso: '2026-01-12T12:00:00.000Z',
        },
      ],
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T23:59:59.999Z'
    );

    expect(rates.afcAttachRate).toBe(100);
    expect(rates.ahaAttachRate).toBe(100);
  });

  it('keeps AFC split based on referral org', () => {
    const rates = computeAttachRates(
      [
        {
          status: 'paid',
          usedAfc: true,
          usedAssignedAgent: true,
          referralOrg: 'AFC',
          side: 'buy',
          designation: 'AHA',
          closingDateIso: '2026-03-10T12:00:00.000Z',
        },
        {
          status: 'paid',
          usedAfc: true,
          usedAssignedAgent: true,
          referralOrg: 'AHA',
          designation: 'AHA',
          closingDateIso: '2026-03-10T12:00:00.000Z',
        },
      ],
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T23:59:59.999Z'
    );

    expect(rates.afcAttachRate).toBe(100);
    expect(rates.ahaAttachRate).toBe(100);
    expect(rates.ahaDealsLost).toBe(0);
  });

  it('computes all attach-rate buckets from same closed-deal set', () => {
    const rates = computeAttachRates(
      [
        {
          status: 'closed',
          usedAfc: true,
          usedAssignedAgent: false,
          referralOrg: 'AFC',
          side: 'buy',
          designation: 'AHA',
          closingDateIso: '2026-03-14T12:00:00.000Z',
        },
        {
          status: 'payment_sent',
          usedAfc: false,
          usedAssignedAgent: true,
          referralOrg: 'AHA',
          designation: 'AHA_OOS',
          closingDateIso: '2026-03-14T12:00:00.000Z',
        },
      ],
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T23:59:59.999Z'
    );

    expect(rates.afcAttachRate).toBe(100);
    expect(rates.ahaAttachRate).toBe(0);
    expect(rates.ahaOosAttachRate).toBe(100);
  });

  it('calculates AFC attach rate correctly', () => {
    const afcRelevant = [
      { usedAfc: true },
      { usedAfc: true },
      { usedAfc: false },
      { usedAfc: true },
    ];
    
    const afcDealsLost = afcRelevant.filter(payment => !payment.usedAfc).length;
    const afcAttachRate = afcRelevant.length
      ? (afcRelevant.filter(payment => Boolean(payment.usedAfc)).length / afcRelevant.length) * 100
      : 0;
    
    expect(afcDealsLost).toBe(1);
    expect(afcAttachRate).toBe(75);
  });

  it('excludes sell-side deals from AFC attach rate and lost counts', () => {
    const rates = computeAttachRates(
      [
        {
          status: 'closed',
          usedAfc: true,
          referralOrg: 'AFC',
          side: 'buy',
          closingDateIso: '2026-03-12T12:00:00.000Z',
        },
        {
          status: 'paid',
          usedAfc: false,
          referralOrg: 'AFC',
          side: 'sell',
          closingDateIso: '2026-03-12T12:00:00.000Z',
        },
      ],
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T23:59:59.999Z'
    );

    expect(rates.afcAttachRate).toBe(100);
    expect(rates.afcDealsLost).toBe(0);
  });

  it('calculates AHA attach rate correctly', () => {
    const ahaRelevant = [
      { usedAssignedAgent: true },
      { usedAssignedAgent: true },
      { usedAssignedAgent: false },
      { usedAssignedAgent: false },
      { usedAssignedAgent: true },
    ];
    
    const ahaAttached = ahaRelevant.filter(payment => Boolean(payment.usedAssignedAgent));
    const ahaDealsLost = ahaRelevant.length - ahaAttached.length;
    const ahaAttachRate = ahaRelevant.length ? (ahaAttached.length / ahaRelevant.length) * 100 : 0;
    
    expect(ahaDealsLost).toBe(2);
    expect(ahaAttachRate).toBe(60);
  });

  it('returns 0% attach rate when no relevant deals exist', () => {
    const afcRelevant: any[] = [];
    const afcAttachRate = afcRelevant.length
      ? (afcRelevant.filter(payment => Boolean(payment.usedAfc)).length / afcRelevant.length) * 100
      : 0;
    
    expect(afcAttachRate).toBe(0);
  });
});

describe('Dashboard Metrics - Leaderboard Calculations', () => {
  it('sorts MC revenue leaderboard correctly', () => {
    const mcRevenueMap = new Map([
      ['mc1', { revenue: 150000, expected: 50000 }],
      ['mc2', { revenue: 200000, expected: 75000 }],
      ['mc3', { revenue: 100000, expected: 25000 }],
    ]);
    
    const leaderboard = Array.from(mcRevenueMap.entries())
      .map(([key, value]) => ({
        id: key,
        name: `MC ${key}`,
        revenueCents: value.revenue,
        expectedRevenueCents: value.expected
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
    
    expect(leaderboard[0].id).toBe('mc2');
    expect(leaderboard[1].id).toBe('mc1');
    expect(leaderboard[2].id).toBe('mc3');
  });

  it('sorts agent close rate leaderboard correctly', () => {
    const agentStats = [
      { id: 'agent1', closed: 8, total: 10 }, // 80%
      { id: 'agent2', closed: 5, total: 10 }, // 50%
      { id: 'agent3', closed: 9, total: 10 }, // 90%
    ];
    
    const leaderboard = agentStats
      .map(agent => ({
        id: agent.id,
        closeRate: agent.total === 0 ? 0 : (agent.closed / agent.total) * 100,
        closings: agent.closed,
        totalReferrals: agent.total
      }))
      .sort((a, b) => b.closeRate - a.closeRate);
    
    expect(leaderboard[0].id).toBe('agent3');
    expect(leaderboard[0].closeRate).toBe(90);
    expect(leaderboard[1].id).toBe('agent1');
    expect(leaderboard[2].id).toBe('agent2');
  });

  it('handles tie-breaking in leaderboards', () => {
    const agentStats = [
      { id: 'agent1', closed: 5, total: 10, expected: 100000 }, // 50%, $100k
      { id: 'agent2', closed: 5, total: 10, expected: 150000 }, // 50%, $150k
    ];
    
    const leaderboard = agentStats
      .map(agent => ({
        id: agent.id,
        closeRate: agent.total === 0 ? 0 : (agent.closed / agent.total) * 100,
        closings: agent.closed,
        expectedRevenueCents: agent.expected
      }))
      .sort((a, b) => {
        if (b.closeRate === a.closeRate) {
          return (b.expectedRevenueCents ?? 0) - (a.expectedRevenueCents ?? 0);
        }
        return b.closeRate - a.closeRate;
      });
    
    // When close rates are tied, higher expected revenue should rank first
    expect(leaderboard[0].id).toBe('agent2');
    expect(leaderboard[1].id).toBe('agent1');
  });
});

describe('Dashboard Metrics - AHA Composite Scoring', () => {
  it('rewards more active CRM usage when other KPI inputs are equal', () => {
    const crmUsageRaw = new Map([
      ['agent-a', computeCappedActivityUsageScore(20, 10)],
      ['agent-b', computeCappedActivityUsageScore(4, 4)]
    ]);
    const normalizedCrmUsage = normalizeAhaKpiMap(crmUsageRaw, false);

    const closeRateWeight = 5;
    const crmUsageWeight = 1;
    const totalWeight = closeRateWeight + crmUsageWeight;

    const scoreForAgentA =
      ((50 * closeRateWeight) + ((normalizedCrmUsage.get('agent-a') ?? AHA_NEUTRAL_SCORE) * crmUsageWeight)) /
      totalWeight;
    const scoreForAgentB =
      ((50 * closeRateWeight) + ((normalizedCrmUsage.get('agent-b') ?? AHA_NEUTRAL_SCORE) * crmUsageWeight)) /
      totalWeight;

    expect(scoreForAgentA).toBeGreaterThan(scoreForAgentB);
  });

  it('caps CRM usage event bonus to reduce spammy event volume impact', () => {
    const moderateUsage = computeCappedActivityUsageScore(20, 10);
    const spammyUsage = computeCappedActivityUsageScore(200, 10);

    expect(moderateUsage).toBe(20);
    expect(spammyUsage).toBe(20);
  });

  it('keeps CRM usage influence low relative to high-weight KPIs', () => {
    const closeRateWeight = 5;
    const crmUsageWeight = 1;
    const totalWeight = closeRateWeight + crmUsageWeight;

    const highCloseRateLowUsage =
      ((100 * closeRateWeight) + (0 * crmUsageWeight)) / totalWeight;
    const lowCloseRateHighUsage =
      ((0 * closeRateWeight) + (100 * crmUsageWeight)) / totalWeight;

    expect(highCloseRateLowUsage).toBeGreaterThan(lowCloseRateHighUsage);
    expect(highCloseRateLowUsage - lowCloseRateHighUsage).toBeGreaterThan(60);
  });

  it('uses neutral score when KPI values have no variance', () => {
    const rawMap = new Map([
      ['agent-a', 8],
      ['agent-b', 8],
      ['agent-c', 8]
    ]);

    const normalized = normalizeAhaKpiMap(rawMap, false);

    expect(normalized.get('agent-a')).toBe(AHA_NEUTRAL_SCORE);
    expect(normalized.get('agent-b')).toBe(AHA_NEUTRAL_SCORE);
    expect(normalized.get('agent-c')).toBe(AHA_NEUTRAL_SCORE);
  });

  it('applies neutral fill for missing KPI values while keeping fixed denominator', () => {
    const normalizedCloseRate = new Map([
      ['agent-a', 100],
      ['agent-b', 0]
    ]);

    const closeRateWeight = 5;
    const npsWeight = 3;
    const totalWeight = closeRateWeight + npsWeight;

    const scoreForAgentA = ((normalizedCloseRate.get('agent-a') ?? AHA_NEUTRAL_SCORE) * closeRateWeight + AHA_NEUTRAL_SCORE * npsWeight) / totalWeight;
    const scoreForAgentB = ((normalizedCloseRate.get('agent-b') ?? AHA_NEUTRAL_SCORE) * closeRateWeight + AHA_NEUTRAL_SCORE * npsWeight) / totalWeight;

    expect(scoreForAgentA).toBeCloseTo(81.25, 2);
    expect(scoreForAgentB).toBeCloseTo(18.75, 2);
  });

  it('dampens low-volume agents using reliability factor', () => {
    const minReferrals = 5;
    const baseScore = 80;

    const lowVolumeReliability = computeAhaReliabilityFactor(1, minReferrals);
    const qualifiedReliability = computeAhaReliabilityFactor(5, minReferrals);

    const lowVolumeScore = baseScore * lowVolumeReliability;
    const qualifiedScore = baseScore * qualifiedReliability;

    expect(lowVolumeReliability).toBeCloseTo(Math.sqrt(1 / 5), 5);
    expect(qualifiedReliability).toBe(1);
    expect(lowVolumeScore).toBeLessThan(qualifiedScore);
  });

  it('sorts ties deterministically by referrals, net commission, then id', () => {
    const ranked = [
      { id: 'b-agent', score: 72.5, referralCount: 6, netCommissionCents: 150000 },
      { id: 'a-agent', score: 72.5, referralCount: 6, netCommissionCents: 150000 },
      { id: 'c-agent', score: 72.5, referralCount: 4, netCommissionCents: 200000 },
      { id: 'd-agent', score: 72.5, referralCount: 6, netCommissionCents: 100000 }
    ].sort(compareAhaRankedAgents);

    expect(ranked.map((agent) => agent.id)).toEqual(['a-agent', 'b-agent', 'd-agent', 'c-agent']);
  });
});

describe('Dashboard Metrics - MC Composite Scoring', () => {
  // Mirror of MC_KPI_WEIGHTS in src/app/api/dashboard/route.ts. The four
  // volume/revenue drivers carry the most weight; the rest are guardrails.
  const MC_MIN_REFERRALS_FOR_RANK = 3;
  const MC_MIN_RELIABILITY_FACTOR = 0.6;
  const MC_KPI_WEIGHTS = {
    closedDealsWithAfc: 8,
    closedDealsWithoutAfc: 7,
    totalRevenueGenerated: 6,
    referralCount: 5,
    revenuePerReferral: 2,
    closeVelocityMedianDays: 2,
    dealPushbackRate: 2,
    noAssignedAgentCloseRate: 2,
    financingTerminationRate: 2,
    npsScore: 2,
    agingPipelineRisk: 1,
    sourceQualityIndex: 1,
    forecastAccuracy: 1
  } as const;
  const MC_KPI_ORDER = [
    'closedDealsWithAfc',
    'closedDealsWithoutAfc',
    'totalRevenueGenerated',
    'referralCount',
    'revenuePerReferral',
    'closeVelocityMedianDays',
    'dealPushbackRate',
    'noAssignedAgentCloseRate',
    'financingTerminationRate',
    'npsScore',
    'agingPipelineRisk',
    'sourceQualityIndex',
    'forecastAccuracy'
  ] as const;
  const mcScoreWithReliability = (baseScore: number, referralCount: number): number => {
    const reliabilityFactor = Math.max(
      MC_MIN_RELIABILITY_FACTOR,
      computeAhaReliabilityFactor(referralCount, MC_MIN_REFERRALS_FOR_RANK)
    );
    return Math.round(baseScore * reliabilityFactor * 10) / 10;
  };

  // Mirrors route.ts: KPIs with no data (null) are excluded from the
  // denominator rather than filled with a neutral 50.
  const compositeScore = (
    kpis: Array<{ weight: number; normalized: number | null }>
  ): number => {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const { weight, normalized } of kpis) {
      if (normalized == null) {
        continue;
      }
      weightedSum += normalized * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : AHA_NEUTRAL_SCORE;
  };

  it('orders the four volume/revenue drivers above every guardrail KPI', () => {
    expect(MC_KPI_WEIGHTS.closedDealsWithAfc).toBeGreaterThan(MC_KPI_WEIGHTS.closedDealsWithoutAfc);
    expect(MC_KPI_WEIGHTS.closedDealsWithoutAfc).toBeGreaterThan(MC_KPI_WEIGHTS.totalRevenueGenerated);
    expect(MC_KPI_WEIGHTS.totalRevenueGenerated).toBeGreaterThan(MC_KPI_WEIGHTS.referralCount);

    const guardrailWeights = [
      MC_KPI_WEIGHTS.revenuePerReferral,
      MC_KPI_WEIGHTS.closeVelocityMedianDays,
      MC_KPI_WEIGHTS.dealPushbackRate,
      MC_KPI_WEIGHTS.noAssignedAgentCloseRate,
      MC_KPI_WEIGHTS.financingTerminationRate,
      MC_KPI_WEIGHTS.npsScore,
      MC_KPI_WEIGHTS.agingPipelineRisk,
      MC_KPI_WEIGHTS.sourceQualityIndex,
      MC_KPI_WEIGHTS.forecastAccuracy
    ];
    expect(MC_KPI_WEIGHTS.referralCount).toBeGreaterThan(Math.max(...guardrailWeights));
  });

  it('ranks closed deals using AFC as the strongest composite driver', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.closedDealsWithAfc, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 0 }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.closedDealsWithAfc, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 100 }
    ]);

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
    expect(scoreForMcA).toBeCloseTo(57.14, 2);
    expect(scoreForMcB).toBeCloseTo(42.86, 2);
  });

  it('penalizes closed-deal volume without AFC as a negative critical KPI', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.closedDealsWithAfc, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.closedDealsWithoutAfc, normalized: 100 }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.closedDealsWithAfc, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.closedDealsWithoutAfc, normalized: 0 }
    ]);

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
    expect(scoreForMcA).toBeCloseTo(100, 2);
    expect(scoreForMcB).toBeCloseTo(0, 2);
  });

  it('excludes KPIs with no data from the weighted denominator', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.npsScore, normalized: null }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.npsScore, normalized: 100 }
    ]);

    expect(scoreForMcA).toBeCloseTo(100, 2);
    expect(scoreForMcB).toBeCloseTo(25, 2);
  });

  it('keeps zero-referral MCs scored with a provisional reliability floor', () => {
    const baseScore = 76.1;

    expect(computeAhaReliabilityFactor(0, MC_MIN_REFERRALS_FOR_RANK)).toBe(0);
    expect(mcScoreWithReliability(baseScore, 0)).toBeCloseTo(45.7, 1);
    expect(mcScoreWithReliability(baseScore, MC_MIN_REFERRALS_FOR_RANK)).toBeCloseTo(baseScore, 1);
  });

  it('excludes removed and redundant metrics from the composite', () => {
    const removedKeys = [
      'pipelineCashConversion',
      'noAfcCloseRate',
      'afcCaptureRate',
      'ahaAttachRate',
      'ahaOosAttachRate'
    ];
    for (const key of removedKeys) {
      expect(key in MC_KPI_WEIGHTS).toBe(false);
      expect(MC_KPI_ORDER).not.toContain(key);
    }
  });

  it('rewards higher referral (transfer) counts when other KPI inputs are equal', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 50 },
      { weight: MC_KPI_WEIGHTS.revenuePerReferral, normalized: 50 },
      { weight: MC_KPI_WEIGHTS.referralCount, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.npsScore, normalized: 50 }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 50 },
      { weight: MC_KPI_WEIGHTS.revenuePerReferral, normalized: 50 },
      { weight: MC_KPI_WEIGHTS.referralCount, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.npsScore, normalized: 50 }
    ]);

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
  });

  it('lets high revenue outrank a better without-assigned-agent guardrail when inputs are comparable', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.noAssignedAgentCloseRate, normalized: 0 }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.noAssignedAgentCloseRate, normalized: 100 }
    ]);

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
    expect(scoreForMcA).toBeCloseTo(75, 2);
    expect(scoreForMcB).toBeCloseTo(25, 2);
  });

  it('penalizes higher close-without-assigned-agent rates as a negative guardrail KPI', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.noAssignedAgentCloseRate, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 50 }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.noAssignedAgentCloseRate, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 50 }
    ]);

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
  });

  it('penalizes higher pushed-back-deal rates as a negative guardrail KPI', () => {
    const scoreForMcA = compositeScore([
      { weight: MC_KPI_WEIGHTS.dealPushbackRate, normalized: 100 },
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 50 }
    ]);
    const scoreForMcB = compositeScore([
      { weight: MC_KPI_WEIGHTS.dealPushbackRate, normalized: 0 },
      { weight: MC_KPI_WEIGHTS.totalRevenueGenerated, normalized: 50 }
    ]);

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
  });

  it('calculates pushback summary metrics from closed deals updated in timeframe', () => {
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const allClosedDealsInPushbackWindow = [
      {
        updatedAt: new Date('2026-04-05T10:00:00.000Z'),
        closingDatePushbackCount: 0,
        closingDatePushbacks: []
      },
      {
        updatedAt: new Date('2026-04-10T10:00:00.000Z'),
        closingDatePushbackCount: 1,
        closingDatePushbacks: [{ pushedBackDays: 6, timestamp: new Date('2026-04-10T10:00:00.000Z') }]
      },
      {
        updatedAt: new Date('2026-04-12T10:00:00.000Z'),
        closingDatePushbackCount: 2,
        closingDatePushbacks: [
          { pushedBackDays: 4, timestamp: new Date('2026-04-11T10:00:00.000Z') },
          { pushedBackDays: 3, timestamp: new Date('2026-04-12T10:00:00.000Z') }
        ]
      }
    ];

    const totals = allClosedDealsInPushbackWindow.reduce(
      (acc, payment) => {
        const scopedPushback = resolvePushbackMetricsInTimeframe(payment, timeframe);
        if (scopedPushback.events > 0) {
          acc.distinctDealsPushedBack += 1;
          acc.totalPushbackEvents += scopedPushback.events;
          acc.totalPushbackDays += scopedPushback.pushedBackDays;
        }
        return acc;
      },
      { distinctDealsPushedBack: 0, totalPushbackEvents: 0, totalPushbackDays: 0 }
    );

    const averageDaysPushedBackPerEvent =
      totals.totalPushbackEvents > 0 ? totals.totalPushbackDays / totals.totalPushbackEvents : 0;
    const pushbackRatePercent =
      allClosedDealsInPushbackWindow.length > 0
        ? (totals.distinctDealsPushedBack / allClosedDealsInPushbackWindow.length) * 100
        : 0;

    expect(totals.distinctDealsPushedBack).toBe(2);
    expect(totals.totalPushbackEvents).toBe(3);
    expect(averageDaysPushedBackPerEvent).toBeCloseTo(4.33, 2);
    expect(pushbackRatePercent).toBeCloseTo(66.67, 2);
  });

  it('uses pushback event timestamps for timeframe scoping', () => {
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const scopedPushback = resolvePushbackMetricsInTimeframe(
      {
        updatedAt: new Date('2026-04-10T10:00:00.000Z'),
        closingDatePushbackCount: 2,
        closingDatePushbacks: [
          { pushedBackDays: 5, timestamp: new Date('2026-04-08T10:00:00.000Z') },
          { pushedBackDays: 4, timestamp: new Date('2026-03-20T10:00:00.000Z') }
        ]
      },
      timeframe
    );

    expect(scopedPushback.events).toBe(1);
    expect(scopedPushback.pushedBackDays).toBe(5);
  });

  it('falls back to updatedAt when pushback history is incomplete', () => {
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const scopedPushback = resolvePushbackMetricsInTimeframe(
      {
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        closingDatePushbackCount: 2,
        closingDatePushbacks: [{ pushedBackDays: 3, timestamp: new Date('2026-04-13T10:00:00.000Z') }]
      },
      timeframe
    );

    expect(scopedPushback.events).toBe(2);
    expect(scopedPushback.pushedBackDays).toBe(3);
  });

  it('counts a five-day pushback as a non-zero in-range event', () => {
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const scopedPushback = resolvePushbackMetricsInTimeframe(
      {
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        closingDatePushbackCount: 1,
        closingDatePushbacks: [{ pushedBackDays: 5, timestamp: new Date('2026-04-18T10:00:00.000Z') }]
      },
      timeframe
    );

    expect(scopedPushback.events).toBe(1);
    expect(scopedPushback.pushedBackDays).toBe(5);
  });

  it('counts under-contract deals with pushed-back closing dates and builds a per-MC breakdown', () => {
    const NON_TERMINATED_DEAL_STATUSES = new Set([
      'under_contract',
      'past_inspection',
      'past_appraisal',
      'clear_to_close',
      'closed',
      'payment_sent',
      'paid'
    ]);
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const isWithinTimeframe = (value: Date | null | undefined) => {
      if (!value) return false;
      const candidate = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(candidate.getTime())) return false;
      if (timeframe.start && candidate < timeframe.start) return false;
      if (timeframe.end && candidate > timeframe.end) return false;
      return true;
    };
    type TestPayment = {
      status: string;
      updatedAt: Date;
      lender: string;
      closingDatePushbackCount: number;
      closingDatePushbacks: Array<{ pushedBackDays: number; timestamp: Date }>;
    };
    const paymentsByNetwork: TestPayment[] = [
      {
        status: 'under_contract',
        updatedAt: new Date('2026-04-11T10:00:00.000Z'),
        lender: 'mc-a',
        closingDatePushbackCount: 1,
        closingDatePushbacks: [{ pushedBackDays: 7, timestamp: new Date('2026-04-11T10:00:00.000Z') }]
      },
      {
        status: 'under_contract',
        updatedAt: new Date('2026-04-12T10:00:00.000Z'),
        lender: 'mc-b',
        closingDatePushbackCount: 0,
        closingDatePushbacks: []
      },
      {
        status: 'closed',
        updatedAt: new Date('2026-04-14T10:00:00.000Z'),
        lender: 'mc-a',
        closingDatePushbackCount: 0,
        closingDatePushbacks: []
      },
      {
        status: 'terminated',
        updatedAt: new Date('2026-04-15T10:00:00.000Z'),
        lender: 'mc-c',
        closingDatePushbackCount: 1,
        closingDatePushbacks: [{ pushedBackDays: 4, timestamp: new Date('2026-04-15T10:00:00.000Z') }]
      }
    ];
    const pushbackEventInTimeframe = (payment: TestPayment) =>
      payment.closingDatePushbacks.some((entry) => isWithinTimeframe(entry.timestamp));
    const allDealsInPushbackWindow = paymentsByNetwork.filter(
      (payment) =>
        NON_TERMINATED_DEAL_STATUSES.has(payment.status) &&
        (isWithinTimeframe(payment.updatedAt) || pushbackEventInTimeframe(payment))
    );

    const mcPushbackStatsMap = new Map<string, { dealsWithPushback: number }>();
    const mcEligibleDealsMap = new Map<string, number>();
    let distinctDealsPushedBack = 0;
    let eligibleDealsInScope = 0;
    allDealsInPushbackWindow.forEach((payment) => {
      eligibleDealsInScope += 1;
      mcEligibleDealsMap.set(payment.lender, (mcEligibleDealsMap.get(payment.lender) ?? 0) + 1);
      const scoped = resolvePushbackMetricsInTimeframe(payment, timeframe);
      if (scoped.events > 0) {
        const current = mcPushbackStatsMap.get(payment.lender) ?? { dealsWithPushback: 0 };
        current.dealsWithPushback += 1;
        mcPushbackStatsMap.set(payment.lender, current);
        distinctDealsPushedBack += 1;
      }
    });
    const pushbackRatePercent =
      eligibleDealsInScope > 0 ? (distinctDealsPushedBack / eligibleDealsInScope) * 100 : 0;
    const byMc = Array.from(mcPushbackStatsMap.entries())
      .filter(([, stats]) => stats.dealsWithPushback > 0)
      .map(([id, stats]) => {
        const totalDeals = mcEligibleDealsMap.get(id) ?? 0;
        return {
          id,
          dealsPushedBack: stats.dealsWithPushback,
          totalDeals,
          pushbackRatePercent: totalDeals > 0 ? (stats.dealsWithPushback / totalDeals) * 100 : 0
        };
      })
      .sort(
        (a, b) =>
          b.dealsPushedBack - a.dealsPushedBack || b.pushbackRatePercent - a.pushbackRatePercent
      );

    expect(distinctDealsPushedBack).toBe(1);
    expect(eligibleDealsInScope).toBe(3);
    expect(pushbackRatePercent).toBeCloseTo(33.33, 2);
    expect(byMc).toHaveLength(1);
    expect(byMc[0]).toEqual({
      id: 'mc-a',
      dealsPushedBack: 1,
      totalDeals: 2,
      pushbackRatePercent: 50
    });
  });

  it('penalizes higher financing-termination rates as a high-tier negative KPI', () => {
    const normalizedFinancingTerminationRate = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const financingTerminationWeight = 3;
    const baselineWeight = 3;
    const baselineNormalizedScore = 50;
    const totalWeight = financingTerminationWeight + baselineWeight;

    const scoreForMcA =
      ((normalizedFinancingTerminationRate.get('mc-a') ?? AHA_NEUTRAL_SCORE) * financingTerminationWeight +
        baselineNormalizedScore * baselineWeight) /
      totalWeight;
    const scoreForMcB =
      ((normalizedFinancingTerminationRate.get('mc-b') ?? AHA_NEUTRAL_SCORE) * financingTerminationWeight +
        baselineNormalizedScore * baselineWeight) /
      totalWeight;

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
  });
});

describe('Dashboard Metrics - MC AFC Risk Call List', () => {
  const normalizeStatusKey = (value: string | null | undefined) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');

  const TERMINAL_REFERRAL_STATUS_KEYS = new Set([
    'closed',
    'lost',
    'terminated',
    'payment_sent',
    'payment_received',
    'paid'
  ]);
  const TERMINAL_PAYMENT_STATUS_KEYS = new Set(['closed', 'payment_sent', 'payment_received', 'paid']);
  const ACTIVE_PIPELINE_STATUS_KEYS = new Set([
    'paired',
    'in_communication',
    'active_lead',
    'showing_homes',
    'under_contract'
  ]);
  const AFC_RISK_AT_RISK_SCORE_THRESHOLD = 40;
  const AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD = 0.3;

  const getOutcomeTuningMultiplier = (
    sampleSize: number,
    fullConfidenceAt: number,
    minMultiplier: number,
    maxMultiplier: number
  ) => {
    const normalized = Math.min(1, Math.max(0, sampleSize) / Math.max(fullConfidenceAt, 1));
    return minMultiplier + (maxMultiplier - minMultiplier) * normalized;
  };

  const shouldIncludeInAfcRiskList = ({
    referralStatus,
    paymentStatus
  }: {
    referralStatus: string;
    paymentStatus?: string | null;
  }) => {
    const normalizedReferralStatus = normalizeStatusKey(referralStatus);
    if (TERMINAL_REFERRAL_STATUS_KEYS.has(normalizedReferralStatus)) return false;
    if (paymentStatus && TERMINAL_PAYMENT_STATUS_KEYS.has(normalizeStatusKey(paymentStatus))) return false;
    return ACTIVE_PIPELINE_STATUS_KEYS.has(normalizedReferralStatus);
  };

  const computeRiskScore = ({
    hasDealRecord,
    usedAfc,
    daysSinceActivity,
    daysToClose,
    outsideLossRatePct,
    sourceCloseRatePct,
    noteSignalScore = 0,
    outsideLossSampleSize = 10,
    sourceSampleSize = 15
  }: {
    hasDealRecord: boolean;
    usedAfc: boolean | null;
    daysSinceActivity: number;
    daysToClose: number;
    outsideLossRatePct: number;
    sourceCloseRatePct: number;
    noteSignalScore?: number;
    outsideLossSampleSize?: number;
    sourceSampleSize?: number;
  }) => {
    let score = 0;

    if (hasDealRecord && usedAfc !== true) score += 35;

    if (daysSinceActivity >= 30) score += 25;
    else if (daysSinceActivity >= 14) score += 15;
    else if (daysSinceActivity >= 7) score += 8;

    if (daysToClose <= 7) score += 20;
    else if (daysToClose <= 14) score += 14;
    else if (daysToClose <= 30) score += 8;

    const historicalRiskBoost =
      Math.min(15, outsideLossRatePct * 0.15) *
      getOutcomeTuningMultiplier(outsideLossSampleSize, 10, 0.7, 1.1);
    score += Math.min(15, historicalRiskBoost);

    const sourceFragilityBoost =
      Math.min(10, ((100 - sourceCloseRatePct) / 100) * 10) *
      getOutcomeTuningMultiplier(sourceSampleSize, 15, 0.75, 1.1);
    if (sourceFragilityBoost >= 4) {
      score += Math.min(10, sourceFragilityBoost);
    }
    score += Math.max(0, noteSignalScore);

    return Math.min(100, Number(score.toFixed(1)));
  };

  const prioritizeAfcRiskReasons = (
    reasons: { label: string; score: number }[],
    outsideLossRatePct: number
  ) => {
    const isHighOutsideLoss = outsideLossRatePct / 100 >= AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD;
    return reasons
      .filter((reason) => !reason.label.startsWith('Counter-signal in notes'))
      .sort((a, b) => {
        const aPriority =
          (isHighOutsideLoss && a.label.startsWith('MC historical outside-lender loss') ? 2 : 0) +
          (a.label.startsWith('Notes mention outside/local lender intent') ? 1 : 0);
        const bPriority =
          (isHighOutsideLoss && b.label.startsWith('MC historical outside-lender loss') ? 2 : 0) +
          (b.label.startsWith('Notes mention outside/local lender intent') ? 1 : 0);
        if (bPriority !== aPriority) return bPriority - aPriority;
        return b.score - a.score;
      })
      .slice(0, 2)
      .map((reason) => reason.label);
  };

  it('ranks higher-risk calls first using the risk model factors', () => {
    const highRisk = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceActivity: 21,
      daysToClose: 6,
      outsideLossRatePct: 40,
      sourceCloseRatePct: 45
    });
    const lowerRisk = computeRiskScore({
      hasDealRecord: true,
      usedAfc: true,
      daysSinceActivity: 3,
      daysToClose: 24,
      outsideLossRatePct: 10,
      sourceCloseRatePct: 75
    });

    expect(highRisk).toBeGreaterThan(lowerRisk);
    expect(highRisk).toBeGreaterThanOrEqual(70);
    expect(lowerRisk).toBeLessThan(40);
  });

  it('does not apply AFC-attach penalty before a deal record exists', () => {
    const preDealScore = computeRiskScore({
      hasDealRecord: false,
      usedAfc: null,
      daysSinceActivity: 10,
      daysToClose: 20,
      outsideLossRatePct: 20,
      sourceCloseRatePct: 60
    });
    const withDealNotAttached = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceActivity: 10,
      daysToClose: 20,
      outsideLossRatePct: 20,
      sourceCloseRatePct: 60
    });

    expect(withDealNotAttached - preDealScore).toBeCloseTo(35, 2);
  });

  it('returns deterministic order when risk scores tie by using days-to-close', () => {
    const rows = [
      { id: 'later-close', riskScore: 62.5, daysToClose: 12 },
      { id: 'sooner-close', riskScore: 62.5, daysToClose: 5 }
    ];

    rows.sort((a, b) => b.riskScore - a.riskScore || a.daysToClose - b.daysToClose);

    expect(rows.map((row) => row.id)).toEqual(['sooner-close', 'later-close']);
  });

  it('prioritizes MC loss and outside-lender note reasons when MC loss is high', () => {
    const factors = [
      { label: 'AFC not attached', score: 35 },
      { label: '18 days since last activity', score: 15 },
      { label: '6 days to close', score: 20 },
      { label: 'MC historical outside-lender loss 42.0%', score: 4.5 },
      { label: 'Notes mention outside/local lender intent (outside lender)', score: 25 }
    ];

    const topReasons = prioritizeAfcRiskReasons(factors, 42);

    expect(topReasons).toEqual([
      'MC historical outside-lender loss 42.0%',
      'Notes mention outside/local lender intent (outside lender)'
    ]);
  });

  it('includes pre-under-contract active pipeline statuses for early intervention', () => {
    const referrals = [
      { id: 'paired', status: 'Paired' },
      { id: 'active', status: 'Active Lead' },
      { id: 'under-contract', status: 'Under Contract' },
      { id: 'closed', status: 'Closed' }
    ];

    const included = referrals
      .filter((referral) => shouldIncludeInAfcRiskList({ referralStatus: referral.status }))
      .map((referral) => referral.id);

    expect(included).toEqual(['paired', 'active', 'under-contract']);
  });

  it('excludes referrals when referral status is terminal', () => {
    const included = shouldIncludeInAfcRiskList({
      referralStatus: 'Payment Sent',
      paymentStatus: 'under_contract'
    });

    expect(included).toBe(false);
  });

  it('excludes referrals when linked payment status is terminal', () => {
    const included = shouldIncludeInAfcRiskList({
      referralStatus: 'Under Contract',
      paymentStatus: 'paid'
    });

    expect(included).toBe(false);
  });

  it('raises data-driven boosts as sample size grows', () => {
    const lowConfidenceScore = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceActivity: 7,
      daysToClose: 18,
      outsideLossRatePct: 40,
      sourceCloseRatePct: 45,
      outsideLossSampleSize: 1,
      sourceSampleSize: 1
    });
    const highConfidenceScore = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceActivity: 7,
      daysToClose: 18,
      outsideLossRatePct: 40,
      sourceCloseRatePct: 45,
      outsideLossSampleSize: 25,
      sourceSampleSize: 25
    });

    expect(highConfidenceScore).toBeGreaterThan(lowConfidenceScore);
  });

  it('keeps only at-risk entries (medium/high) in the call list', () => {
    const scores = [82.4, 41.2, 39.9, 18.6];
    const atRisk = scores.filter((score) => score >= AFC_RISK_AT_RISK_SCORE_THRESHOLD);

    expect(atRisk).toEqual([82.4, 41.2]);
  });

  it('adds note-signal risk for strong outside/local lender phrasing', () => {
    const strongTextRisk = 25;
    const baseScore = computeRiskScore({
      hasDealRecord: false,
      usedAfc: null,
      daysSinceActivity: 5,
      daysToClose: 30,
      outsideLossRatePct: 10,
      sourceCloseRatePct: 70,
      noteSignalScore: 0
    });
    const withStrongNotes = computeRiskScore({
      hasDealRecord: false,
      usedAfc: null,
      daysSinceActivity: 5,
      daysToClose: 30,
      outsideLossRatePct: 10,
      sourceCloseRatePct: 70,
      noteSignalScore: strongTextRisk
    });

    expect(withStrongNotes - baseScore).toBeCloseTo(24.9, 2);
  });

  it('suppresses note-only risk when counter-signal indicates staying with AFC', () => {
    const strongTextRisk = 25;
    const suppressorReduction = 18;
    const resultingSignal = Math.max(0, strongTextRisk - suppressorReduction);

    expect(resultingSignal).toBe(7);
  });
});

describe('Dashboard Metrics - Admin Assignment and Unassigned', () => {
  it('counts unassigned as referrals in New Lead status only', () => {
    const adminEligibleReferrals = [
      { status: 'New Lead' },
      { status: 'Paired' },
      { status: 'New Lead' },
      { status: 'In Communication' },
      { status: 'Under Contract' },
    ];
    const unassignedReferrals = adminEligibleReferrals.filter(
      (r) => (r.status ?? '').trim() === 'New Lead'
    ).length;
    const assignedReferrals = adminEligibleReferrals.length - unassignedReferrals;
    const assignmentRate = adminEligibleReferrals.length
      ? (assignedReferrals / adminEligibleReferrals.length) * 100
      : 0;

    expect(unassignedReferrals).toBe(2);
    expect(assignedReferrals).toBe(3);
    expect(assignmentRate).toBe(60);
  });

  it('returns 0% assignment rate when all referrals are New Lead', () => {
    const adminEligibleReferrals = [
      { status: 'New Lead' },
      { status: 'New Lead' },
    ];
    const unassignedReferrals = adminEligibleReferrals.filter(
      (r) => (r.status ?? '').trim() === 'New Lead'
    ).length;
    const assignedReferrals = adminEligibleReferrals.length - unassignedReferrals;
    const assignmentRate = adminEligibleReferrals.length
      ? (assignedReferrals / adminEligibleReferrals.length) * 100
      : 0;

    expect(unassignedReferrals).toBe(2);
    expect(assignedReferrals).toBe(0);
    expect(assignmentRate).toBe(0);
  });

  it('returns 100% assignment rate when no referrals are New Lead', () => {
    const adminEligibleReferrals = [
      { status: 'Paired' },
      { status: 'In Communication' },
    ];
    const unassignedReferrals = adminEligibleReferrals.filter(
      (r) => (r.status ?? '').trim() === 'New Lead'
    ).length;
    const assignedReferrals = adminEligibleReferrals.length - unassignedReferrals;
    const assignmentRate = adminEligibleReferrals.length
      ? (assignedReferrals / adminEligibleReferrals.length) * 100
      : 0;

    expect(unassignedReferrals).toBe(0);
    expect(assignedReferrals).toBe(2);
    expect(assignmentRate).toBe(100);
  });

  it('handles empty admin eligible referrals', () => {
    const adminEligibleReferrals: { status: string }[] = [];
    const unassignedReferrals = adminEligibleReferrals.filter(
      (r) => (r.status ?? '').trim() === 'New Lead'
    ).length;
    const assignedReferrals = adminEligibleReferrals.length - unassignedReferrals;
    const assignmentRate = adminEligibleReferrals.length
      ? (assignedReferrals / adminEligibleReferrals.length) * 100
      : 0;

    expect(unassignedReferrals).toBe(0);
    expect(assignedReferrals).toBe(0);
    expect(assignmentRate).toBe(0);
  });
});

describe('Dashboard Metrics - Pre-Approval Conversion', () => {
  it('calculates conversion rate correctly', () => {
    const totalReferrals = 45;
    const totalPreApprovals = 150;
    const conversionRate = totalPreApprovals > 0 
      ? Number(((totalReferrals / totalPreApprovals) * 100).toFixed(1)) 
      : 0;
    
    expect(conversionRate).toBe(30.0);
  });

  it('handles zero pre-approvals gracefully', () => {
    const totalReferrals = 10;
    const totalPreApprovals = 0;
    const conversionRate = totalPreApprovals > 0 
      ? Number(((totalReferrals / totalPreApprovals) * 100).toFixed(1)) 
      : 0;
    
    expect(conversionRate).toBe(0);
  });

  it('calculates network-specific conversion rates', () => {
    const ahaReferrals = 20;
    const ahaPreApprovals = 100;
    const ahaOosReferrals = 15;
    const ahaOosPreApprovals = 50;
    
    const ahaConversionRate = ahaPreApprovals > 0
      ? Number(((ahaReferrals / ahaPreApprovals) * 100).toFixed(1))
      : 0;
    
    const ahaOosConversionRate = ahaOosPreApprovals > 0
      ? Number(((ahaOosReferrals / ahaOosPreApprovals) * 100).toFixed(1))
      : 0;
    
    expect(ahaConversionRate).toBe(20.0);
    expect(ahaOosConversionRate).toBe(30.0);
  });
});

describe('Dashboard Metrics - On Time Task Completion', () => {
  it('counts a resolved task completed on the due date as on time', () => {
    const task = {
      dueAt: new Date('2026-04-10T09:00:00.000Z'),
      dueAtOverride: undefined,
      snoozedUntil: undefined,
      completedAt: new Date('2026-04-10T18:30:00.000Z'),
      dismissedAt: undefined,
    } satisfies Parameters<typeof wasTaskResolvedOnOrBeforeDueDate>[0];

    expect(wasTaskResolvedOnOrBeforeDueDate(task)).toBe(true);
  });

  it('uses an active snooze date when evaluating on-time completion', () => {
    const task = {
      dueAt: new Date('2026-04-01T09:00:00.000Z'),
      dueAtOverride: undefined,
      snoozedUntil: new Date('2026-04-05T09:00:00.000Z'),
      completedAt: new Date('2026-04-04T12:00:00.000Z'),
      dismissedAt: undefined,
    } satisfies Parameters<typeof wasTaskResolvedOnOrBeforeDueDate>[0];

    expect(wasTaskResolvedOnOrBeforeDueDate(task)).toBe(true);
  });

  it('returns null when a resolved task has no due date to evaluate against', () => {
    const task = {
      dueAt: undefined,
      dueAtOverride: undefined,
      snoozedUntil: undefined,
      completedAt: new Date('2026-04-04T12:00:00.000Z'),
      dismissedAt: undefined,
    } satisfies Parameters<typeof wasTaskResolvedOnOrBeforeDueDate>[0];

    expect(wasTaskResolvedOnOrBeforeDueDate(task)).toBeNull();
  });
});
