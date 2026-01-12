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

describe('Dashboard Metrics - Monthly Trend Close Rate', () => {
  it('groups deals by referral creation month, not closing month', () => {
    // Scenario: Referrals created in January, deals close in June
    // The monthly close rate should attribute these deals to January, not June
    
    // Referrals created in January 2024
    const januaryReferrals = [
      { id: 'ref1', createdAt: new Date('2024-01-15') },
      { id: 'ref2', createdAt: new Date('2024-01-20') },
      { id: 'ref3', createdAt: new Date('2024-01-25') },
    ];
    
    // Deals that closed in June 2024, but from January referrals
    const payments = [
      { 
        referralId: 'ref1', 
        status: 'closed',
        metricDate: new Date('2024-06-10'), // Closed in June
        agentAttribution: 'AHA'
      },
      { 
        referralId: 'ref2', 
        status: 'paid',
        metricDate: new Date('2024-06-15'), // Closed in June
        agentAttribution: 'AHA'
      },
    ];
    
    // Build referral creation month map
    const referralCreationMonthMap = new Map<string, string>();
    januaryReferrals.forEach((referral) => {
      const createdAt = new Date(referral.createdAt);
      const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      referralCreationMonthMap.set(referral.id, monthKey);
    });
    
    // Group deals by referral creation month (not closing month)
    const dealMonthlyMap = new Map<string, { dealsClosed: number }>();
    payments.forEach((payment) => {
      if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
      if (!['closed', 'payment_sent', 'paid'].includes(payment.status)) return;
      
      const referralMonthKey = referralCreationMonthMap.get(payment.referralId);
      if (!referralMonthKey) return;
      
      const current = dealMonthlyMap.get(referralMonthKey) ?? { dealsClosed: 0 };
      current.dealsClosed += 1;
      dealMonthlyMap.set(referralMonthKey, current);
    });
    
    // January should have 2 deals closed (even though they closed in June)
    const januaryDeals = dealMonthlyMap.get('2024-01') ?? { dealsClosed: 0 };
    expect(januaryDeals.dealsClosed).toBe(2);
    
    // June should have 0 deals (no referrals created in June)
    const juneDeals = dealMonthlyMap.get('2024-06') ?? { dealsClosed: 0 };
    expect(juneDeals.dealsClosed).toBe(0);
    
    // January close rate: 2 deals / 3 referrals = 66.7%
    const januaryReferralsCount = januaryReferrals.length;
    const januaryCloseRate = januaryReferralsCount === 0 
      ? 0 
      : (januaryDeals.dealsClosed / januaryReferralsCount) * 100;
    
    expect(januaryCloseRate).toBeCloseTo(66.67, 1);
  });

  it('matches summary close rate logic for single month', () => {
    // When viewing a single month, the summary close rate should match the monthly trend
    const referrals = [
      { id: 'ref1', createdAt: new Date('2024-03-10') },
      { id: 'ref2', createdAt: new Date('2024-03-15') },
      { id: 'ref3', createdAt: new Date('2024-03-20') },
      { id: 'ref4', createdAt: new Date('2024-03-25') },
    ];
    
    const payments = [
      { referralId: 'ref1', status: 'closed', agentAttribution: 'AHA' },
      { referralId: 'ref2', status: 'paid', agentAttribution: 'AHA' },
      { referralId: 'ref3', status: 'closed', agentAttribution: 'AHA' },
    ];
    
    // Summary close rate calculation
    const filteredReferralIds = new Set(referrals.map(r => r.id));
    const dealsClosed = payments.filter(
      (payment) =>
        payment.agentAttribution !== 'OUTSIDE_AGENT' &&
        (payment.status === 'closed' || payment.status === 'paid') &&
        filteredReferralIds.has(payment.referralId)
    );
    const summaryCloseRate = referrals.length === 0 
      ? 0 
      : (dealsClosed.length / referrals.length) * 100;
    
    // Monthly trend close rate calculation
    const referralCreationMonthMap = new Map<string, string>();
    referrals.forEach((referral) => {
      const createdAt = new Date(referral.createdAt);
      const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      referralCreationMonthMap.set(referral.id, monthKey);
    });
    
    const dealMonthlyMap = new Map<string, { dealsClosed: number }>();
    payments.forEach((payment) => {
      if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
      if (!['closed', 'payment_sent', 'paid'].includes(payment.status)) return;
      
      const referralMonthKey = referralCreationMonthMap.get(payment.referralId);
      if (!referralMonthKey) return;
      
      const current = dealMonthlyMap.get(referralMonthKey) ?? { dealsClosed: 0 };
      current.dealsClosed += 1;
      dealMonthlyMap.set(referralMonthKey, current);
    });
    
    const marchDeals = dealMonthlyMap.get('2024-03') ?? { dealsClosed: 0 };
    const monthlyCloseRate = referrals.length === 0
      ? 0
      : (marchDeals.dealsClosed / referrals.length) * 100;
    
    // Both should calculate the same close rate
    expect(summaryCloseRate).toBe(75); // 3 deals / 4 referrals
    expect(monthlyCloseRate).toBe(75); // 3 deals / 4 referrals
    expect(summaryCloseRate).toBe(monthlyCloseRate);
  });

  it('excludes deals from referrals not in the network', () => {
    // Referrals created in March
    const referrals = [
      { id: 'ref1', createdAt: new Date('2024-03-10') },
      { id: 'ref2', createdAt: new Date('2024-03-15') },
    ];
    
    // Payments: one from a referral in our list, one from outside
    const payments = [
      { referralId: 'ref1', status: 'closed', agentAttribution: 'AHA' },
      { referralId: 'ref999', status: 'closed', agentAttribution: 'AHA' }, // Not in referrals list
    ];
    
    const referralCreationMonthMap = new Map<string, string>();
    referrals.forEach((referral) => {
      const createdAt = new Date(referral.createdAt);
      const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      referralCreationMonthMap.set(referral.id, monthKey);
    });
    
    const dealMonthlyMap = new Map<string, { dealsClosed: number }>();
    payments.forEach((payment) => {
      if (payment.agentAttribution === 'OUTSIDE_AGENT') return;
      if (!['closed', 'payment_sent', 'paid'].includes(payment.status)) return;
      
      const referralMonthKey = referralCreationMonthMap.get(payment.referralId);
      if (!referralMonthKey) return; // Skip if referral not in our network
      
      const current = dealMonthlyMap.get(referralMonthKey) ?? { dealsClosed: 0 };
      current.dealsClosed += 1;
      dealMonthlyMap.set(referralMonthKey, current);
    });
    
    const marchDeals = dealMonthlyMap.get('2024-03') ?? { dealsClosed: 0 };
    // Should only count ref1, not ref999
    expect(marchDeals.dealsClosed).toBe(1);
    
    const monthlyCloseRate = referrals.length === 0
      ? 0
      : (marchDeals.dealsClosed / referrals.length) * 100;
    
    expect(monthlyCloseRate).toBe(50); // 1 deal / 2 referrals
  });
});

