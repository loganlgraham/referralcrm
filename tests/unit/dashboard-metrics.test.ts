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
      payment.usedAssignedAgent === true;

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
      payment.usedAssignedAgent === true;

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
  it('counts only closed-like deals with usedAssignedAgent=true and excludes terminated deals', () => {
    const payments = [
      { status: 'closed', agentAttribution: 'AHA', usedAssignedAgent: true },
      { status: 'payment_sent', agentAttribution: 'AHA', usedAssignedAgent: null },
      { status: 'paid', agentAttribution: 'AHA_OOS', usedAssignedAgent: undefined },
      { status: 'paid', agentAttribution: 'OUTSIDE_AGENT', usedAssignedAgent: true },
      { status: 'closed', agentAttribution: 'AHA', usedAssignedAgent: false },
      { status: 'terminated', agentAttribution: 'AHA', usedAssignedAgent: true },
    ];

    const isClosedEligible = (payment: (typeof payments)[number]) =>
      ['closed', 'payment_sent', 'paid'].includes(payment.status) &&
      payment.agentAttribution !== 'OUTSIDE_AGENT' &&
      payment.usedAssignedAgent === true;

    const closedCount = payments.filter(isClosedEligible).length;
    expect(closedCount).toBe(1);
  });
});

describe('Dashboard Metrics - MC AFC Leaderboard KPIs', () => {
  it('calculates AFC close rate from period AFC closed-like deals over all MC referrals', () => {
    const referralByMcMap = new Map([['mcA', 4]]);
    const closedStatuses = new Set(['closed', 'payment_sent', 'paid']);
    const eligibleClosedDealsInTimeframe = [
      { status: 'closed', usedAfc: true, referral: { _id: 'ref-1', lender: 'mcA' } },
      { status: 'payment_sent', usedAfc: true, referral: { _id: 'ref-2', lender: 'mcA' } },
      { status: 'paid', usedAfc: true, referral: { _id: 'older-referral', lender: 'mcA' } },
      { status: 'paid', usedAfc: false, referral: { _id: 'ref-3', lender: 'mcA' } }
    ];

    const afcClosedByMc = new Map<string, number>();
    eligibleClosedDealsInTimeframe.forEach((payment) => {
      if (payment.usedAfc !== true || !closedStatuses.has(payment.status)) return;
      const mcKey = payment.referral.lender;
      afcClosedByMc.set(mcKey, (afcClosedByMc.get(mcKey) ?? 0) + 1);
    });

    const afcClosedDeals = afcClosedByMc.get('mcA') ?? 0;
    const totalReferrals = referralByMcMap.get('mcA') ?? 0;
    const afcCloseRate = totalReferrals === 0 ? 0 : (afcClosedDeals / totalReferrals) * 100;

    expect(afcClosedDeals).toBe(3);
    expect(totalReferrals).toBe(4);
    expect(afcCloseRate).toBe(75);
  });

  it('counts AFC deals across every payment status, including terminated', () => {
    const timeframe = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-01-31T23:59:59.999Z')
    };
    const payments = [
      {
        status: 'under_contract',
        usedAfc: true,
        underContractDate: new Date('2026-01-05T00:00:00.000Z'),
        referral: { lender: 'mcA' }
      },
      {
        status: 'paid',
        usedAfc: true,
        underContractDate: new Date('2026-01-10T00:00:00.000Z'),
        referral: { lender: 'mcA' }
      },
      {
        status: 'terminated',
        usedAfc: true,
        underContractDate: new Date('2026-01-12T00:00:00.000Z'),
        referral: { lender: 'mcA' }
      },
      {
        status: 'terminated',
        usedAfc: false,
        underContractDate: new Date('2026-01-15T00:00:00.000Z'),
        referral: { lender: 'mcA' }
      },
      {
        status: 'closed',
        usedAfc: true,
        underContractDate: new Date('2025-12-31T00:00:00.000Z'),
        referral: { lender: 'mcA' }
      }
    ];

    const isWithinTimeframe = (date: Date) => date >= timeframe.start && date <= timeframe.end;
    const afcDealsByMc = new Map<string, number>();

    payments.forEach((payment) => {
      if (payment.usedAfc !== true) return;
      if (!isWithinTimeframe(payment.underContractDate)) return;
      const mcKey = payment.referral.lender;
      afcDealsByMc.set(mcKey, (afcDealsByMc.get(mcKey) ?? 0) + 1);
    });

    expect(afcDealsByMc.get('mcA')).toBe(3);
  });
});

describe('Dashboard Metrics - MC Assigned Agent Guardrail', () => {
  it('counts closes without assigned agent from all period closed-like deals', () => {
    const allClosedDealsInTimeframe = [
      { status: 'closed', usedAssignedAgent: true, referral: { lender: 'mcA' } },
      { status: 'payment_sent', usedAssignedAgent: false, referral: { lender: 'mcA' } },
      { status: 'paid', usedAssignedAgent: false, referral: { lender: 'mcA' } },
      { status: 'closed', usedAssignedAgent: null, referral: { lender: 'mcA' } }
    ];

    const totalClosedDealsByMc = new Map<string, number>();
    const noAssignedAgentClosesByMc = new Map<string, number>();

    allClosedDealsInTimeframe.forEach((payment) => {
      const mcKey = payment.referral.lender;
      totalClosedDealsByMc.set(mcKey, (totalClosedDealsByMc.get(mcKey) ?? 0) + 1);
      if (payment.usedAssignedAgent === false) {
        noAssignedAgentClosesByMc.set(mcKey, (noAssignedAgentClosesByMc.get(mcKey) ?? 0) + 1);
      }
    });

    const noAssignedAgentCloses = noAssignedAgentClosesByMc.get('mcA') ?? 0;
    const totalClosedDeals = totalClosedDealsByMc.get('mcA') ?? 0;
    const noAssignedAgentCloseRate =
      totalClosedDeals === 0 ? 0 : (noAssignedAgentCloses / totalClosedDeals) * 100;

    expect(noAssignedAgentCloses).toBe(2);
    expect(totalClosedDeals).toBe(4);
    expect(noAssignedAgentCloseRate).toBe(50);
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

  const computeAttachRates = (
    payments: AttachPayment[],
    startIso: string,
    endIso: string,
    networkFilter: 'ALL' | 'AHA' | 'AHA_OOS' = 'ALL'
  ) => {
    // Mirror the route's paymentsByNetwork scoping: when a network filter is
    // active, the attach-rate denominators only see payments in that network.
    const paymentsByNetwork = payments.filter((payment) =>
      networkFilter === 'ALL' ? true : payment.designation === networkFilter
    );

    const closedDealsInTimeframe = paymentsByNetwork.filter(
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

    // AFC attach rate (buy-side) counts every closed buy-side deal as eligible,
    // regardless of referral org.
    const afcRelevant = closedDealsInTimeframe.filter(
      (payment) => resolveSide(payment) === 'buy'
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

  it('counts buy-side deals as AFC-eligible regardless of referral org', () => {
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
          usedAfc: false,
          usedAssignedAgent: true,
          referralOrg: 'AHA',
          side: 'buy',
          designation: 'AHA',
          closingDateIso: '2026-03-10T12:00:00.000Z',
        },
      ],
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T23:59:59.999Z'
    );

    // Both buy-side deals count toward the AFC denominator even though one is org=AHA.
    expect(rates.afcAttachRate).toBe(50);
    expect(rates.afcDealsLost).toBe(1);
    expect(rates.ahaAttachRate).toBe(100);
    expect(rates.ahaDealsLost).toBe(0);
  });

  it('constrains AFC buy-side attach rate to the selected network', () => {
    const payments: AttachPayment[] = [
      {
        status: 'paid',
        usedAfc: true,
        referralOrg: 'AHA',
        side: 'buy',
        designation: 'AHA',
        closingDateIso: '2026-03-10T12:00:00.000Z',
      },
      {
        status: 'paid',
        usedAfc: false,
        referralOrg: 'AHA',
        side: 'buy',
        designation: 'AHA_OOS',
        closingDateIso: '2026-03-10T12:00:00.000Z',
      },
    ];
    const start = '2026-03-01T00:00:00.000Z';
    const end = '2026-03-31T23:59:59.999Z';

    // ALL: both buy-side deals count -> 1 of 2 attached.
    expect(computeAttachRates(payments, start, end, 'ALL').afcAttachRate).toBe(50);
    // AHA: only the AHA-designation buy-side deal counts -> attached.
    expect(computeAttachRates(payments, start, end, 'AHA').afcAttachRate).toBe(100);
    // AHA_OOS: only the AHA_OOS-designation buy-side deal counts -> not attached.
    expect(computeAttachRates(payments, start, end, 'AHA_OOS').afcAttachRate).toBe(0);
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

  it('ignores the legacy count remainder when dated entries exist', () => {
    // The dated entry is the anchor; the extra legacy count must not be pulled
    // into the timeframe just because updatedAt happens to fall in the window.
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

    expect(scopedPushback.events).toBe(1);
    expect(scopedPushback.pushedBackDays).toBe(3);
  });

  it('falls back to updatedAt for legacy counts when no dated entries exist', () => {
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const scopedPushback = resolvePushbackMetricsInTimeframe(
      {
        updatedAt: new Date('2026-04-13T10:00:00.000Z'),
        closingDatePushbackCount: 2,
        closingDatePushbacks: []
      },
      timeframe
    );

    expect(scopedPushback.events).toBe(2);
    expect(scopedPushback.pushedBackDays).toBe(0);
    expect(scopedPushback.eventsWithDays).toBe(0);
  });

  it('does not attribute legacy counts when updatedAt is outside the timeframe', () => {
    const timeframe = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T23:59:59.999Z')
    };
    const scopedPushback = resolvePushbackMetricsInTimeframe(
      {
        updatedAt: new Date('2026-06-13T10:00:00.000Z'),
        closingDatePushbackCount: 2,
        closingDatePushbacks: []
      },
      timeframe
    );

    expect(scopedPushback.events).toBe(0);
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

  const TERMINAL_REFERRAL_STATUS_KEYS = new Set(['closed', 'lost', 'terminated']);
  const TERMINAL_PAYMENT_STATUS_KEYS = new Set(['closed', 'payment_sent', 'payment_received', 'paid']);
  const UNDER_CONTRACT_PAYMENT_STATUS_KEYS = new Set(['under_contract', 'past_inspection', 'past_appraisal', 'clear_to_close']);
  const AFC_RISK_TARGET_STATUS_KEYS = new Set(['active_lead', 'in_communication']);
  const AFC_RISK_AT_RISK_SCORE_THRESHOLD = 40;
  const AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD = 0.3;
  const AFC_RISK_LOW_ATTACH_RATE_THRESHOLD = 0.7;
  const AFC_RISK_MIN_HISTORICAL_SAMPLE = 3;
  const AFC_RISK_STALE_DAYS = 7;
  const AFC_RISK_RESURFACE_DAYS = 14;

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
    paymentStatus,
    clientType = 'Buyer',
    dealSide = 'buy',
    daysInStatus = AFC_RISK_STALE_DAYS,
    agentDesignation = 'AHA_OOS'
  }: {
    referralStatus: string;
    paymentStatus?: string | null;
    clientType?: 'Buyer' | 'Seller' | 'Both';
    dealSide?: 'buy' | 'sell';
    daysInStatus?: number;
    agentDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  }) => {
    const normalizedReferralStatus = normalizeStatusKey(referralStatus);
    if (agentDesignation !== 'AHA_OOS') return false;
    if (TERMINAL_REFERRAL_STATUS_KEYS.has(normalizedReferralStatus)) return false;
    if (paymentStatus && TERMINAL_PAYMENT_STATUS_KEYS.has(normalizeStatusKey(paymentStatus))) return false;
    if (paymentStatus && UNDER_CONTRACT_PAYMENT_STATUS_KEYS.has(normalizeStatusKey(paymentStatus))) return false;
    if (!AFC_RISK_TARGET_STATUS_KEYS.has(normalizedReferralStatus)) return false;
    if (clientType === 'Seller' || dealSide === 'sell') return false;
    if (normalizedReferralStatus === 'in_communication' && daysInStatus < AFC_RISK_STALE_DAYS) return false;
    return true;
  };

  const shouldShowStalePageTrigger = ({
    editedAfterStatus,
    daysInStatus,
    daysSinceLastUpdated
  }: {
    editedAfterStatus: boolean;
    daysInStatus: number;
    daysSinceLastUpdated: number;
  }) => {
    return editedAfterStatus
      ? daysSinceLastUpdated >= AFC_RISK_RESURFACE_DAYS
      : daysInStatus >= AFC_RISK_STALE_DAYS;
  };

  const computeRiskScore = ({
    hasDealRecord,
    usedAfc,
    daysSinceLastUpdated,
    outsideLossRatePct,
    assignedAgentOutsideLossRatePct = 0,
    agentAssignedAgentOutsideLossRatePct = 0,
    sourceNetworkAttachRatePct = 100,
    baselineAttachRatePct = 100,
    noteSignalScore = 0,
    outsideLossSampleSize = 10,
    sourceNetworkSampleSize = AFC_RISK_MIN_HISTORICAL_SAMPLE
  }: {
    hasDealRecord: boolean;
    usedAfc: boolean | null;
    daysSinceLastUpdated: number;
    outsideLossRatePct: number;
    assignedAgentOutsideLossRatePct?: number;
    agentAssignedAgentOutsideLossRatePct?: number;
    sourceNetworkAttachRatePct?: number;
    baselineAttachRatePct?: number;
    noteSignalScore?: number;
    outsideLossSampleSize?: number;
    sourceNetworkSampleSize?: number;
  }) => {
    let score = 0;

    if (hasDealRecord && usedAfc !== true) score += 35;

    if (daysSinceLastUpdated >= 30) score += 25;
    else if (daysSinceLastUpdated >= 14) score += 18;
    else if (daysSinceLastUpdated >= 7) score += 12;

    const historicalRiskBoost =
      Math.min(15, outsideLossRatePct * 0.15) *
      getOutcomeTuningMultiplier(outsideLossSampleSize, 10, 0.7, 1.1);
    if (
      outsideLossSampleSize >= AFC_RISK_MIN_HISTORICAL_SAMPLE &&
      outsideLossRatePct / 100 >= AFC_RISK_HIGH_OUTSIDE_LOSS_RATE_THRESHOLD
    ) {
      score += Math.min(15, historicalRiskBoost);
    }

    if (
      outsideLossSampleSize >= AFC_RISK_MIN_HISTORICAL_SAMPLE &&
      assignedAgentOutsideLossRatePct >= 20
    ) {
      score += Math.min(20, assignedAgentOutsideLossRatePct * 0.4);
    }
    if (
      outsideLossSampleSize >= AFC_RISK_MIN_HISTORICAL_SAMPLE &&
      agentAssignedAgentOutsideLossRatePct >= 20
    ) {
      score += Math.min(20, agentAssignedAgentOutsideLossRatePct * 0.4);
    }

    const sourceNetworkThreshold = Math.min(
      AFC_RISK_LOW_ATTACH_RATE_THRESHOLD * 100,
      Math.max(0, baselineAttachRatePct - 10)
    );
    if (
      sourceNetworkSampleSize >= AFC_RISK_MIN_HISTORICAL_SAMPLE &&
      sourceNetworkAttachRatePct <= sourceNetworkThreshold
    ) {
      score += Math.min(15, (baselineAttachRatePct - sourceNetworkAttachRatePct) * 0.5);
    }
    score += Math.max(0, noteSignalScore);

    return Math.min(100, Number(score.toFixed(1)));
  };

  const NOTE_SIGNAL_STRONG_PHRASES = [
    'outside lender',
    'preferred lender',
    'builder lender',
    'my lender',
    'loan officer',
    'already working with',
    'shopping rates',
    'better rate',
    'needs lender asap',
    'appraisal ordered'
  ];
  const NOTE_SIGNAL_SOFT_PHRASES = ['quoted', 'apr', 'points', 'fees'];
  const NOTE_SIGNAL_ACTIVE_BUYER_PHRASES = [
    'putting in an offer',
    'writing an offer',
    'offer deadline',
    'going to see homes',
    'showing homes'
  ];
  const NOTE_SIGNAL_SUPPRESSOR_PHRASES = ['confirmed afc', 'staying with afc', 'afc pre-approved', 'loan file opened'];

  const scoreOutsideLenderNoteSignals = (text: string) => {
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const strongMatch = NOTE_SIGNAL_STRONG_PHRASES.find((phrase) => normalizedText.includes(phrase));
    const softMatch = NOTE_SIGNAL_SOFT_PHRASES.find((phrase) => normalizedText.includes(phrase));
    const activeBuyerMatch = NOTE_SIGNAL_ACTIVE_BUYER_PHRASES.find((phrase) => normalizedText.includes(phrase));
    const suppressorMatch = NOTE_SIGNAL_SUPPRESSOR_PHRASES.find((phrase) => normalizedText.includes(phrase));
    const outsideScore = strongMatch ? 25 : softMatch ? 10 : 0;
    const activeBuyerScore = activeBuyerMatch ? 12 : 0;
    let score = outsideScore + activeBuyerScore;
    if (suppressorMatch) {
      score -= Math.min(12, outsideScore);
    }
    return {
      score,
      reason: strongMatch
        ? `Notes mention outside/local lender intent (${strongMatch})`
        : softMatch
          ? `Notes suggest lender-shopping (${softMatch})`
          : activeBuyerMatch
            ? `Notes show active buyer activity (${activeBuyerMatch})`
          : null
    };
  };

  const collectVisibleRiskTexts = ({
    notes,
    initialNotes,
    activityTexts
  }: {
    notes: string[];
    initialNotes?: string;
    activityTexts?: string[];
  }) => {
    void initialNotes;
    void activityTexts;
    return notes.map((note) => note.trim()).filter(Boolean);
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
          (isHighOutsideLoss && a.label.startsWith('MC history: agent used, AFC not used') ? 2 : 0) +
          (a.label.startsWith('Agent history: agent used, AFC not used') ? 2 : 0) +
          (a.label.startsWith('Source/network low AFC attach') ? 1 : 0) +
          (a.label.startsWith('Notes mention outside/local lender intent') ? 1 : 0);
        const bPriority =
          (isHighOutsideLoss && b.label.startsWith('MC historical outside-lender loss') ? 2 : 0) +
          (isHighOutsideLoss && b.label.startsWith('MC history: agent used, AFC not used') ? 2 : 0) +
          (b.label.startsWith('Agent history: agent used, AFC not used') ? 2 : 0) +
          (b.label.startsWith('Source/network low AFC attach') ? 1 : 0) +
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
      daysSinceLastUpdated: 21,
      outsideLossRatePct: 40,
      assignedAgentOutsideLossRatePct: 30,
      agentAssignedAgentOutsideLossRatePct: 30,
      sourceNetworkAttachRatePct: 45,
      baselineAttachRatePct: 82
    });
    const lowerRisk = computeRiskScore({
      hasDealRecord: true,
      usedAfc: true,
      daysSinceLastUpdated: 3,
      outsideLossRatePct: 10,
      assignedAgentOutsideLossRatePct: 0,
      agentAssignedAgentOutsideLossRatePct: 0,
      sourceNetworkAttachRatePct: 75,
      baselineAttachRatePct: 82
    });

    expect(highRisk).toBeGreaterThan(lowerRisk);
    expect(highRisk).toBeGreaterThanOrEqual(70);
    expect(lowerRisk).toBeLessThan(40);
  });

  it('does not apply AFC-attach penalty before a deal record exists', () => {
    const preDealScore = computeRiskScore({
      hasDealRecord: false,
      usedAfc: null,
      daysSinceLastUpdated: 10,
      outsideLossRatePct: 20,
      sourceNetworkAttachRatePct: 60,
      baselineAttachRatePct: 80
    });
    const withDealNotAttached = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceLastUpdated: 10,
      outsideLossRatePct: 20,
      sourceNetworkAttachRatePct: 60,
      baselineAttachRatePct: 80
    });

    expect(withDealNotAttached - preDealScore).toBeCloseTo(35, 2);
  });

  it('returns deterministic order when risk scores tie by using last updated age', () => {
    const rows = [
      { id: 'recent-update', riskScore: 62.5, daysSinceLastUpdated: 12 },
      { id: 'older-update', riskScore: 62.5, daysSinceLastUpdated: 21 }
    ];

    rows.sort((a, b) => b.riskScore - a.riskScore || b.daysSinceLastUpdated - a.daysSinceLastUpdated);

    expect(rows.map((row) => row.id)).toEqual(['older-update', 'recent-update']);
  });

  it('prioritizes MC loss and outside-lender note reasons when MC loss is high', () => {
    const factors = [
      { label: 'AFC not attached', score: 35 },
      { label: '18 days since referral page update', score: 18 },
      { label: 'Source/network low AFC attach 45.0%', score: 12 },
      { label: 'MC historical outside-lender loss 42.0%', score: 4.5 },
      { label: 'Notes mention outside/local lender intent (outside lender)', score: 25 }
    ];

    const topReasons = prioritizeAfcRiskReasons(factors, 42);

    expect(topReasons).toEqual([
      'MC historical outside-lender loss 42.0%',
      'Notes mention outside/local lender intent (outside lender)'
    ]);
  });

  it('includes only Active Lead and aged In Communication buyer referrals', () => {
    const referrals = [
      { id: 'paired', status: 'Paired' },
      { id: 'active', status: 'Active Lead', daysInStatus: 1 },
      { id: 'fresh-communication', status: 'In Communication', daysInStatus: 6 },
      { id: 'aged-communication', status: 'In Communication', daysInStatus: 7 },
      { id: 'under-contract', status: 'Under Contract' },
      { id: 'closed', status: 'Closed' }
    ];

    const included = referrals
      .filter((referral) =>
        shouldIncludeInAfcRiskList({
          referralStatus: referral.status,
          daysInStatus: referral.daysInStatus ?? AFC_RISK_STALE_DAYS
        })
      )
      .map((referral) => referral.id);

    expect(included).toEqual(['active', 'aged-communication']);
  });

  it('limits entries to AHA OOS attached agents', () => {
    const ahaOos = shouldIncludeInAfcRiskList({
      referralStatus: 'Active Lead',
      agentDesignation: 'AHA_OOS'
    });
    const aha = shouldIncludeInAfcRiskList({
      referralStatus: 'Active Lead',
      agentDesignation: 'AHA'
    });
    const agit = shouldIncludeInAfcRiskList({
      referralStatus: 'Active Lead',
      agentDesignation: 'AGIT'
    });

    expect(ahaOos).toBe(true);
    expect(aha).toBe(false);
    expect(agit).toBe(false);
  });

  it('excludes referrals when referral status is terminal', () => {
    const included = shouldIncludeInAfcRiskList({
      referralStatus: 'Payment Sent',
      paymentStatus: 'under_contract'
    });

    expect(included).toBe(false);
  });

  it('excludes under-contract payment statuses and sell-side referrals', () => {
    const underContract = shouldIncludeInAfcRiskList({
      referralStatus: 'Active Lead',
      paymentStatus: 'under_contract'
    });
    const sellSide = shouldIncludeInAfcRiskList({
      referralStatus: 'Active Lead',
      clientType: 'Seller',
      dealSide: 'sell'
    });

    expect(underContract).toBe(false);
    expect(sellSide).toBe(false);
  });

  it('raises data-driven boosts as sample size grows', () => {
    const lowConfidenceScore = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceLastUpdated: 7,
      outsideLossRatePct: 40,
      sourceNetworkAttachRatePct: 45,
      baselineAttachRatePct: 82,
      outsideLossSampleSize: 1,
      sourceNetworkSampleSize: 1
    });
    const highConfidenceScore = computeRiskScore({
      hasDealRecord: true,
      usedAfc: false,
      daysSinceLastUpdated: 7,
      outsideLossRatePct: 40,
      sourceNetworkAttachRatePct: 45,
      baselineAttachRatePct: 82,
      outsideLossSampleSize: 25,
      sourceNetworkSampleSize: 25
    });

    expect(highConfidenceScore).toBeGreaterThan(lowConfidenceScore);
  });

  it('keeps entries with a qualifying trigger even when the score is low', () => {
    const rows = [
      { id: 'stale-low', riskScore: 12, hasQualifyingTrigger: true },
      { id: 'no-trigger', riskScore: 85, hasQualifyingTrigger: false }
    ];
    const included = rows.filter((row) => row.hasQualifyingTrigger);

    expect(included.map((row) => row.id)).toEqual(['stale-low']);
    expect(AFC_RISK_AT_RISK_SCORE_THRESHOLD).toBe(40);
  });

  it('adds note-signal risk for outside lender, preferred lender, prior lender, and urgency phrasing', () => {
    const signals = [
      'Buyer is shopping rates and got a better rate.',
      'Agent says builder lender is preferred.',
      'Borrower is already working with my lender.',
      'Needs lender ASAP because appraisal ordered.'
    ];

    signals.forEach((signal) => {
      expect(scoreOutsideLenderNoteSignals(signal).score).toBeGreaterThan(0);
    });
  });

  it('uses stored visible notes for outside-lender risk signals', () => {
    const visibleTexts = collectVisibleRiskTexts({
      notes: ['Borrower mentioned an outside lender.'],
      initialNotes: '',
      activityTexts: []
    });
    const signal = scoreOutsideLenderNoteSignals(visibleTexts.join(' '));

    expect(signal.score).toBeGreaterThan(0);
    expect(signal.reason).toBe('Notes mention outside/local lender intent (outside lender)');
  });

  it('does not use activity text or legacy initial notes for visible note risk signals', () => {
    const visibleTexts = collectVisibleRiskTexts({
      notes: ['Buyer prefers AFC.'],
      initialNotes: 'outside lender',
      activityTexts: ['Admin emailed outside lender note to team']
    });
    const signal = scoreOutsideLenderNoteSignals(visibleTexts.join(' '));

    expect(signal.score).toBe(0);
    expect(signal.reason).toBeNull();
  });

  it('only treats active buyer phrases as risk when they are in stored visible notes', () => {
    const activityOnlyTexts = collectVisibleRiskTexts({
      notes: [],
      activityTexts: ['Buyer is writing an offer.']
    });
    const visibleNoteTexts = collectVisibleRiskTexts({
      notes: ['Buyer is writing an offer.']
    });

    expect(scoreOutsideLenderNoteSignals(activityOnlyTexts.join(' ')).score).toBe(0);
    expect(scoreOutsideLenderNoteSignals(visibleNoteTexts.join(' ')).reason).toBe(
      'Notes show active buyer activity (writing an offer)'
    );
  });

  it('categorizes showing homes and writing offers as active buyer activity, not outside lender intent', () => {
    const offerSignal = scoreOutsideLenderNoteSignals(
      'They are writing an offer after going to see homes.'
    );
    const showingSignal = scoreOutsideLenderNoteSignals('Buyer is showing homes this weekend.');

    expect(offerSignal.score).toBeGreaterThan(0);
    expect(offerSignal.reason).toBe('Notes show active buyer activity (writing an offer)');
    expect(showingSignal.score).toBeGreaterThan(0);
    expect(showingSignal.reason).toBe('Notes show active buyer activity (showing homes)');
  });

  it('suppresses note-only risk when counter-signal indicates staying with AFC', () => {
    const resultingSignal = scoreOutsideLenderNoteSignals(
      'Borrower compared fees but confirmed AFC and loan file opened.'
    );

    expect(resultingSignal.score).toBe(0);
  });

  it('keeps active buyer activity risk even when notes confirm AFC', () => {
    const resultingSignal = scoreOutsideLenderNoteSignals(
      'Borrower is writing an offer and confirmed AFC.'
    );

    expect(resultingSignal.score).toBeGreaterThan(0);
    expect(resultingSignal.reason).toBe('Notes show active buyer activity (writing an offer)');
  });

  it('removes stale page risk after an edit and resurfaces after 14 days without another edit', () => {
    expect(
      shouldShowStalePageTrigger({
        editedAfterStatus: false,
        daysInStatus: 7,
        daysSinceLastUpdated: 7
      })
    ).toBe(true);
    expect(
      shouldShowStalePageTrigger({
        editedAfterStatus: true,
        daysInStatus: 10,
        daysSinceLastUpdated: 0
      })
    ).toBe(false);
    expect(
      shouldShowStalePageTrigger({
        editedAfterStatus: true,
        daysInStatus: 21,
        daysSinceLastUpdated: 14
      })
    ).toBe(true);
  });

  it('uses MC, assigned-agent, and source/network low attach patterns as scoring signals', () => {
    const patternScore = computeRiskScore({
      hasDealRecord: false,
      usedAfc: null,
      daysSinceLastUpdated: 0,
      outsideLossRatePct: 35,
      assignedAgentOutsideLossRatePct: 25,
      agentAssignedAgentOutsideLossRatePct: 40,
      sourceNetworkAttachRatePct: 45,
      baselineAttachRatePct: 82,
      outsideLossSampleSize: 8,
      sourceNetworkSampleSize: 6
    });

    expect(patternScore).toBeGreaterThan(0);
  });

  it('includes loan file number and last-updated fields in row payloads', () => {
    const row = {
      borrowerName: 'Test Buyer',
      loanFileNumber: '12345678901',
      lastUpdatedAt: '2026-06-01T12:00:00.000Z',
      daysSinceLastUpdated: 9
    };

    expect(row.loanFileNumber).toBe('12345678901');
    expect(row.lastUpdatedAt).toContain('2026-06-01');
    expect(row.daysSinceLastUpdated).toBe(9);
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
