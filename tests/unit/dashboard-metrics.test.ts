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
    designation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
    closingDateIso: string;
  };

  const computeAttachRates = (payments: AttachPayment[], startIso: string, endIso: string) => {
    const closedDealsInTimeframe = payments.filter(
      (payment) =>
        CLOSED_DEAL_STATUSES.has(payment.status) &&
        closedInTimeframe(payment.closingDateIso, startIso, endIso)
    );

    const afcRelevant = closedDealsInTimeframe.filter((payment) => payment.referralOrg === 'AFC');
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
          designation: 'AHA',
          closingDateIso: '2026-03-12T12:00:00.000Z',
        },
        {
          status: 'closed',
          usedAfc: true,
          usedAssignedAgent: true,
          referralOrg: 'AFC',
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

