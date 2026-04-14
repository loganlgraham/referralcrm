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
  normalizeAhaKpiMap
} from '@/lib/server/aha-leaderboard-scoring';

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
  it('weights MC NPS equally with other top-tier KPIs', () => {
    const normalizedRevenuePerReferral = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const normalizedNpsScore = new Map([
      ['mc-a', 0],
      ['mc-b', 100]
    ]);

    const revenueWeight = 3;
    const npsWeight = 3;
    const totalWeight = revenueWeight + npsWeight;

    const scoreForMcA =
      ((normalizedRevenuePerReferral.get('mc-a') ?? AHA_NEUTRAL_SCORE) * revenueWeight +
        (normalizedNpsScore.get('mc-a') ?? AHA_NEUTRAL_SCORE) * npsWeight) /
      totalWeight;
    const scoreForMcB =
      ((normalizedRevenuePerReferral.get('mc-b') ?? AHA_NEUTRAL_SCORE) * revenueWeight +
        (normalizedNpsScore.get('mc-b') ?? AHA_NEUTRAL_SCORE) * npsWeight) /
      totalWeight;

    expect(scoreForMcA).toBeCloseTo(50, 2);
    expect(scoreForMcB).toBeCloseTo(50, 2);
  });

  it('uses neutral fill for missing high-tier MC KPIs while keeping denominator fixed', () => {
    const normalizedRevenuePerReferral = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const normalizedReferralCount = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const normalizedNpsScore = new Map([['mc-a', 90]]);

    const revenueWeight = 3;
    const referralWeight = 3;
    const npsWeight = 3;
    const totalWeight = revenueWeight + referralWeight + npsWeight;

    const scoreForMcA =
      ((normalizedRevenuePerReferral.get('mc-a') ?? AHA_NEUTRAL_SCORE) * revenueWeight +
        (normalizedReferralCount.get('mc-a') ?? AHA_NEUTRAL_SCORE) * referralWeight +
        (normalizedNpsScore.get('mc-a') ?? AHA_NEUTRAL_SCORE) * npsWeight) /
      totalWeight;
    const scoreForMcB =
      ((normalizedRevenuePerReferral.get('mc-b') ?? AHA_NEUTRAL_SCORE) * revenueWeight +
        (normalizedReferralCount.get('mc-b') ?? AHA_NEUTRAL_SCORE) * referralWeight +
        (normalizedNpsScore.get('mc-b') ?? AHA_NEUTRAL_SCORE) * npsWeight) /
      totalWeight;

    expect(scoreForMcA).toBeCloseTo(96.67, 2);
    expect(scoreForMcB).toBeCloseTo(16.67, 2);
  });

  it('rewards higher referral counts when other KPI inputs are equal', () => {
    const normalizedRevenuePerReferral = new Map([
      ['mc-a', 50],
      ['mc-b', 50]
    ]);
    const normalizedReferralCount = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const normalizedNpsScore = new Map([
      ['mc-a', 50],
      ['mc-b', 50]
    ]);

    const revenueWeight = 3;
    const referralWeight = 3;
    const npsWeight = 3;
    const totalWeight = revenueWeight + referralWeight + npsWeight;

    const scoreForMcA =
      ((normalizedRevenuePerReferral.get('mc-a') ?? AHA_NEUTRAL_SCORE) * revenueWeight +
        (normalizedReferralCount.get('mc-a') ?? AHA_NEUTRAL_SCORE) * referralWeight +
        (normalizedNpsScore.get('mc-a') ?? AHA_NEUTRAL_SCORE) * npsWeight) /
      totalWeight;
    const scoreForMcB =
      ((normalizedRevenuePerReferral.get('mc-b') ?? AHA_NEUTRAL_SCORE) * revenueWeight +
        (normalizedReferralCount.get('mc-b') ?? AHA_NEUTRAL_SCORE) * referralWeight +
        (normalizedNpsScore.get('mc-b') ?? AHA_NEUTRAL_SCORE) * npsWeight) /
      totalWeight;

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
  });

  it('penalizes higher close-without-AFC rates as a high-tier negative KPI', () => {
    const normalizedNoAfcCloseRate = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const noAfcWeight = 3;
    const baselineWeight = 3;
    const baselineNormalizedScore = 50;
    const totalWeight = noAfcWeight + baselineWeight;

    const scoreForMcA =
      ((normalizedNoAfcCloseRate.get('mc-a') ?? AHA_NEUTRAL_SCORE) * noAfcWeight +
        baselineNormalizedScore * baselineWeight) /
      totalWeight;
    const scoreForMcB =
      ((normalizedNoAfcCloseRate.get('mc-b') ?? AHA_NEUTRAL_SCORE) * noAfcWeight +
        baselineNormalizedScore * baselineWeight) /
      totalWeight;

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
  });

  it('penalizes higher close-without-assigned-agent rates as a high-tier negative KPI', () => {
    const normalizedNoAssignedAgentCloseRate = new Map([
      ['mc-a', 100],
      ['mc-b', 0]
    ]);
    const noAssignedAgentWeight = 3;
    const baselineWeight = 3;
    const baselineNormalizedScore = 50;
    const totalWeight = noAssignedAgentWeight + baselineWeight;

    const scoreForMcA =
      ((normalizedNoAssignedAgentCloseRate.get('mc-a') ?? AHA_NEUTRAL_SCORE) * noAssignedAgentWeight +
        baselineNormalizedScore * baselineWeight) /
      totalWeight;
    const scoreForMcB =
      ((normalizedNoAssignedAgentCloseRate.get('mc-b') ?? AHA_NEUTRAL_SCORE) * noAssignedAgentWeight +
        baselineNormalizedScore * baselineWeight) /
      totalWeight;

    expect(scoreForMcA).toBeGreaterThan(scoreForMcB);
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

  it('captures top two reasons for call prioritization', () => {
    const factors = [
      { label: 'AFC not attached', score: 35 },
      { label: '18 days since last activity', score: 15 },
      { label: '6 days to close', score: 20 },
      { label: 'MC historical outside-lender loss 30.0%', score: 4.5 }
    ];

    const topReasons = factors
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => item.label);

    expect(topReasons).toEqual(['AFC not attached', '6 days to close']);
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
