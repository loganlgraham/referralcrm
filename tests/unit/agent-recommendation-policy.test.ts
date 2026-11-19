import {
  AGENT_RECOMMENDATION_POLICY,
  deriveAgentOutcomes,
  fubAdjustments,
  rankAgents,
  ratePoints,
  referralAnchorDate,
  selectEligibleAgents,
  shrinkRate,
  workloadPoints,
  type CandidateAgent,
  type FubAdjustment,
  type HistoryPayment,
  type HistoryReferral,
} from '@/lib/recommendations/agent-policy';

const NOW = new Date('2026-11-19T20:00:00.000Z');
const RECENT = new Date('2026-06-01T12:00:00.000Z');
const MC = 'mc-1';
const OTHER_MC = 'mc-2';

let sequence = 0;
function referral(overrides: Partial<HistoryReferral> = {}): HistoryReferral {
  sequence += 1;
  return {
    id: `ref-${sequence}`,
    createdAt: RECENT,
    referralDate: null,
    clientType: 'Buyer',
    status: 'Lost',
    buyStatus: null,
    sellStatus: null,
    lostReason: null,
    lenderId: MC,
    zips: ['80014'],
    assignedAgentId: 'a',
    buySideAgentId: null,
    sellSideAgentId: null,
    payments: [],
    ...overrides,
  };
}

function closedDeal(overrides: Partial<HistoryPayment> = {}): HistoryPayment {
  return { agentId: null, side: 'buy', status: 'paid', agentAttribution: null, usedAssignedAgent: true, usedAfc: true, ...overrides };
}

function agent(id: string, overrides: Partial<CandidateAgent> = {}): CandidateAgent {
  return { id, name: `Agent ${id.toUpperCase()}`, active: true, ahaDesignation: 'AHA', coveredZips: [], ...overrides };
}

const noFub = (ids: string[]) => new Map<string, FubAdjustment>(ids.map((id) => [id, { state: 'neutral', reason: 'not_linked' }]));

describe('eligibility', () => {
  const pool = [
    agent('a'),
    agent('b', { active: false }),
    agent('c', { ahaDesignation: 'AGIT' }),
    agent('d', { ahaDesignation: 'AHA_OOS', coveredZips: ['80014'] }),
    agent('e', { ahaDesignation: 'AHA_OOS', coveredZips: ['10001'] }),
  ];

  it('limits local AHA referrals to active AHA agents without requiring ZIP coverage', () => {
    const result = selectEligibleAgents({ org: 'AHA', bucket: 'AHA', zips: ['80014'], agents: pool });
    expect(result.eligible.map((entry) => entry.id)).toEqual(['a']);
    expect(result.excluded).toEqual({ inactive: 1, otherNetwork: 3, noZipCoverage: 0 });
  });

  it('requires out-of-state agents to list a referral ZIP', () => {
    const result = selectEligibleAgents({ org: 'AHA', bucket: 'AHA_OOS', zips: ['80014'], agents: pool });
    expect(result.eligible.map((entry) => entry.id)).toEqual(['d']);
    expect(result.excluded.noZipCoverage).toBe(1);
    expect(selectEligibleAgents({ org: 'AHA', bucket: 'AHA_OOS', zips: [], agents: pool }).reason).toBe('no_zip');
  });

  it('does not apply to AFC referrals or referrals without a bucket', () => {
    expect(selectEligibleAgents({ org: 'AFC', bucket: 'AHA', zips: [], agents: pool }).reason).toBe('not_aha');
    expect(selectEligibleAgents({ org: 'AHA', bucket: null, zips: [], agents: pool }).reason).toBe('no_bucket');
  });
});

describe('outcomes and attribution', () => {
  it('uses the earliest date and a 24-month window', () => {
    const old = referral({ createdAt: new Date('2026-10-01T00:00:00Z'), referralDate: new Date('2024-01-01T00:00:00Z') });
    expect(referralAnchorDate(old).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(deriveAgentOutcomes([old], NOW)).toEqual([]);
    expect(deriveAgentOutcomes([referral()], NOW)).toHaveLength(1);
  });

  it('treats active referrals and projected closings as active, not losses', () => {
    const rows = deriveAgentOutcomes([
      referral({ status: 'In Communication' }),
      referral({ status: 'Under Contract', payments: [closedDeal({ status: 'under_contract' })] }),
    ], NOW);
    expect(rows.map((row) => row.outcome)).toEqual(['active', 'active']);
  });

  it('credits closings from the deal record, not the referral status', () => {
    const rows = deriveAgentOutcomes([
      referral({ status: 'Closed', payments: [closedDeal({ agentId: 'b' })] }),
      referral({ status: 'Closed', payments: [] }),
    ], NOW);
    expect(rows.find((row) => row.agentId === 'b')?.outcome).toBe('closed');
    expect(rows.filter((row) => row.agentId === 'a').map((row) => [row.outcome, row.excludedBecause])).toEqual([
      ['excluded', 'closed_without_record'],
      ['excluded', 'closed_without_record'],
    ]);
  });

  it('does not credit agents who were reassigned away', () => {
    const rows = deriveAgentOutcomes([referral({ assignedAgentId: 'b', status: 'Lost' })], NOW);
    expect(rows.map((row) => row.agentId)).toEqual(['b']);
  });

  it('counts a client who closed with an outside agent as not closed', () => {
    const rows = deriveAgentOutcomes([referral({ status: 'Closed', payments: [closedDeal({ agentAttribution: 'OUTSIDE_AGENT' })] })], NOW);
    expect(rows[0]?.outcome).toBe('not_closed');
  });

  it('leaves out losses that are not the agent’s responsibility', () => {
    const rows = deriveAgentOutcomes([
      referral({ lostReason: 'never_connected' }),
      referral({ lostReason: 'chose_other_agent_postcontact' }),
      referral({ lostReason: null }),
    ], NOW);
    expect(rows.map((row) => row.outcome)).toEqual(['excluded', 'not_closed', 'not_closed']);
  });

  it('records AFC answers only for closed purchases', () => {
    const rows = deriveAgentOutcomes([
      referral({ status: 'Closed', payments: [closedDeal({ usedAfc: false })] }),
      referral({ status: 'Closed', payments: [closedDeal({ side: 'sell', usedAfc: false })] }),
      referral({ status: 'Terminated', payments: [closedDeal({ status: 'terminated', usedAfc: false })] }),
      referral({ status: 'Closed', payments: [closedDeal({ usedAfc: null })] }),
    ], NOW);
    expect(rows.map((row) => row.afcAnswers)).toEqual([[false], [], [], [null]]);
  });
});

describe('scoring', () => {
  it('maps the group rate and no evidence to exactly 50', () => {
    expect(ratePoints(0.3, 0.3)).toBe(50);
    expect(ratePoints(shrinkRate(0, 0, 0.3), 0.3)).toBe(50);
    expect(ratePoints(1, 0.3)).toBe(100);
    expect(ratePoints(0, 0.3)).toBe(0);
    expect(workloadPoints(4, 4)).toBe(50);
    expect(workloadPoints(0, 4)).toBeGreaterThan(workloadPoints(9, 4));
  });

  it('keeps a one-for-one record from beating a long strong record', () => {
    const history = [
      referral({ assignedAgentId: 'lucky', status: 'Closed', payments: [closedDeal({ agentId: 'lucky' })] }),
      ...Array.from({ length: 30 }, (_, index) => referral({
        assignedAgentId: 'steady',
        status: index < 18 ? 'Closed' : 'Lost',
        payments: index < 18 ? [closedDeal({ agentId: 'steady' })] : [],
      })),
      ...Array.from({ length: 30 }, () => referral({ assignedAgentId: 'weak', status: 'Lost' })),
    ];
    const ids = ['lucky', 'steady', 'weak'];
    const result = rankAgents({
      candidates: ids.map((id) => agent(id)),
      outcomes: deriveAgentOutcomes(history, NOW),
      activeCounts: new Map(),
      mcId: MC,
      zips: ['80014'],
      fub: noFub(ids),
    });
    expect(result.ranked.map((entry) => entry.agentId)).toEqual(['steady', 'lucky', 'weak']);
    const lucky = result.ranked.find((entry) => entry.agentId === 'lucky');
    expect(lucky?.factors.overall).toMatchObject({ successes: 1, trials: 1 });
    expect(lucky?.evidenceStrength).toBe('Limited');
    expect(result.ranked[0]?.evidenceStrength).toBe('Strong');
  });

  it('uses clear denominators: finished referrals for close rates, closed purchases for AFC', () => {
    const history = [
      referral({ status: 'Closed', payments: [closedDeal({ usedAfc: true })] }),
      referral({ status: 'Closed', lenderId: OTHER_MC, zips: ['80202'], payments: [closedDeal({ usedAfc: false })] }),
      referral({ status: 'Closed', payments: [closedDeal({ side: 'sell', usedAfc: false })] }),
      referral({ status: 'Lost' }),
      referral({ status: 'Active Lead' }),
      referral({ status: 'Lost', lostReason: 'not_qualified' }),
    ];
    const result = rankAgents({ candidates: [agent('a')], outcomes: deriveAgentOutcomes(history, NOW), activeCounts: new Map(), mcId: MC, zips: ['80014'], fub: noFub(['a']) });
    const factors = result.ranked[0]?.factors;
    expect(factors?.overall).toMatchObject({ successes: 3, trials: 4 });
    expect(factors?.mc).toMatchObject({ successes: 2, trials: 3 });
    expect(factors?.zip).toMatchObject({ successes: 2, trials: 3 });
    expect(factors?.usedAfc).toMatchObject({ successes: 1, trials: 2 });
    expect(result.ranked[0]?.excludedOutcomes).toBe(1);
  });

  it('does not reward or penalize missing evidence', () => {
    const history = [
      ...Array.from({ length: 10 }, (_, index) => referral({ assignedAgentId: 'known', status: index < 5 ? 'Closed' : 'Lost', payments: index < 5 ? [closedDeal({ agentId: 'known', usedAfc: index % 2 === 0 })] : [] })),
    ];
    const result = rankAgents({
      candidates: [agent('known'), agent('new')],
      outcomes: deriveAgentOutcomes(history, NOW),
      activeCounts: new Map(),
      mcId: null,
      zips: [],
      fub: noFub(['known', 'new']),
    });
    const fresh = result.ranked.find((entry) => entry.agentId === 'new');
    expect(fresh?.factors.mc).toMatchObject({ applicable: false, points: 50 });
    expect(fresh?.factors.zip).toMatchObject({ applicable: false, points: 50 });
    expect(fresh?.factors.overall.points).toBe(50);
    expect(fresh?.factors.usedAfc.points).toBe(50);
    expect(fresh?.baseScore).toBe(50);
    expect(fresh?.reasons).toContain('No finished referrals in the last 24 months yet');
  });

  it('prefers lighter workloads and does not count active referrals as losses', () => {
    const result = rankAgents({
      candidates: [agent('busy'), agent('free')],
      outcomes: [],
      activeCounts: new Map([['busy', 9], ['free', 1]]),
      mcId: MC,
      zips: ['80014'],
      fub: noFub(['busy', 'free']),
    });
    expect(result.ranked.map((entry) => entry.agentId)).toEqual(['free', 'busy']);
    expect(result.ranked[1]?.factors.overall.trials).toBe(0);
  });

  it('breaks ties the same way regardless of input order', () => {
    const ids = ['z9', 'b2', 'a1'];
    const candidates = [agent('z9', { name: 'Same' }), agent('b2', { name: 'Beta' }), agent('a1', { name: 'Same' })];
    const first = rankAgents({ candidates, outcomes: [], activeCounts: new Map(), mcId: MC, zips: ['80014'], fub: noFub(ids) });
    const second = rankAgents({ candidates: [...candidates].reverse(), outcomes: [], activeCounts: new Map(), mcId: MC, zips: ['80014'], fub: noFub(ids) });
    expect(first.ranked.map((entry) => entry.agentId)).toEqual(['b2', 'a1', 'z9']);
    expect(second.ranked.map((entry) => entry.agentId)).toEqual(['b2', 'a1', 'z9']);
  });

  it('gives exactly three reasons when there is history', () => {
    const history = Array.from({ length: 6 }, () => referral({ status: 'Closed', payments: [closedDeal()] }));
    const result = rankAgents({ candidates: [agent('a')], outcomes: deriveAgentOutcomes(history, NOW), activeCounts: new Map([['a', 2]]), mcId: MC, zips: ['80014'], fub: noFub(['a']) });
    expect(result.ranked[0]?.reasons).toHaveLength(3);
  });
});

describe('optional Follow Up Boss adjustment', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const measured = (assigned: number, contacted: number, coverageComplete = true) => ({ state: 'measured' as const, assignedPeople: assigned, contactedPeople: contacted, coverageComplete });
  const activity = new Map([
    ['a', measured(10, 10)],
    ['b', measured(10, 5)],
    ['c', measured(10, 0)],
    ['d', measured(10, 9, false)],
  ]);

  it('gives unauthorized viewers Referrio-only results', () => {
    const result = fubAdjustments(ids, { permitted: false, connected: true, activity });
    expect([...result.values()].every((entry) => entry.state === 'neutral' && entry.reason === 'not_permitted')).toBe(true);
  });

  it('caps the change at five points and keeps unlinked or incomplete agents at zero', () => {
    const result = fubAdjustments(ids, { permitted: true, connected: true, activity });
    expect(result.get('a')).toMatchObject({ state: 'applied', points: AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment });
    expect(result.get('b')).toMatchObject({ state: 'applied', points: 0 });
    expect(result.get('c')).toMatchObject({ state: 'applied', points: -AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment });
    expect(result.get('d')).toEqual({ state: 'neutral', reason: 'incomplete_coverage' });
    expect(result.get('e')).toEqual({ state: 'neutral', reason: 'not_linked' });
  });

  it('does not compare when too few agents qualify', () => {
    const result = fubAdjustments(['a', 'b'], { permitted: true, connected: true, activity: new Map([['a', measured(10, 10)], ['b', measured(3, 0)]]) });
    expect(result.get('a')).toEqual({ state: 'neutral', reason: 'too_few_comparable' });
    expect(result.get('b')).toEqual({ state: 'neutral', reason: 'small_sample' });
  });

  it('moves the final score by no more than the adjustment', () => {
    const fub = fubAdjustments(ids, { permitted: true, connected: true, activity });
    const ranked = rankAgents({ candidates: ids.map((id) => agent(id)), outcomes: [], activeCounts: new Map(), mcId: MC, zips: ['80014'], fub }).ranked;
    for (const entry of ranked) {
      expect(Math.abs(entry.score - entry.baseScore)).toBeLessThanOrEqual(AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment);
    }
    expect(ranked[0]?.agentId).toBe('a');
    expect(ranked.find((entry) => entry.agentId === 'e')?.score).toBe(50);
  });
});
