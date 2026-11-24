import {
  AGENT_RECOMMENDATION_POLICY,
  compareRecommendations,
  deriveAgentOutcomes,
  fubAdjustments,
  measuredActiveCounts,
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
import { zipsWithinMiles } from '@/lib/recommendations/nearby-zips';

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
    lostReason: 'chose_other_agent_postcontact',
    lenderId: MC,
    zips: ['80014'],
    assignedAgentId: 'a',
    buySideAgentId: null,
    sellSideAgentId: null,
    payments: [],
    ...overrides,
  };
}

function deal(overrides: Partial<HistoryPayment> = {}): HistoryPayment {
  return { agentId: null, side: 'buy', status: 'paid', agentAttribution: null, usedAssignedAgent: true, propertyPostalCode: null, usedAfcAtClosing: null, ...overrides };
}

const closed = (overrides: Partial<HistoryPayment> = {}) => referral({ status: 'Closed', lostReason: null, payments: [deal(overrides)] });

/** `count` finished referrals for one agent, the first `wins` closed and the rest lost for a counted reason. */
function worked(agentId: string, count: number, wins: number, lenderId: string = MC): HistoryReferral[] {
  return Array.from({ length: count }, (_, index) => ({
    ...(index < wins ? closed({ agentId }) : referral()),
    assignedAgentId: agentId,
    lenderId,
  }));
}

function agent(id: string, overrides: Partial<CandidateAgent> = {}): CandidateAgent {
  return { id, name: `Agent ${id.toUpperCase()}`, active: true, ahaDesignation: 'AHA', coveredZips: [], ...overrides };
}

const noFub = (ids: string[]) => new Map<string, FubAdjustment>(ids.map((id) => [id, { state: 'neutral', reason: 'paused' }]));

function rank(
  history: HistoryReferral[],
  ids: string[],
  options: { mcId?: string | null; zips?: string[]; activeCounts?: Map<string, number>; candidates?: CandidateAgent[] } = {},
) {
  const candidates = options.candidates ?? ids.map((id) => agent(id));
  return rankAgents({
    candidates,
    outcomes: deriveAgentOutcomes(history, NOW),
    activeCounts: options.activeCounts ?? new Map(),
    mcId: options.mcId === undefined ? MC : options.mcId,
    zips: options.zips ?? ['80014'],
    fub: noFub(candidates.map((entry) => entry.id)),
  });
}

describe('eligibility', () => {
  const pool = [
    agent('a'),
    agent('b', { active: false }),
    agent('c', { ahaDesignation: 'AGIT' }),
    agent('d', { ahaDesignation: 'AHA_OOS', coveredZips: ['80107'] }),
    agent('e', { ahaDesignation: 'AHA_OOS', coveredZips: ['80116'] }),
    agent('f', { ahaDesignation: 'AHA_OOS', coveredZips: ['80202'] }),
  ];

  it('limits local AHA referrals to active AHA agents without requiring ZIP coverage', () => {
    const result = selectEligibleAgents({ org: 'AHA', bucket: 'AHA', zips: ['80107'], nearbyZips: [], agents: pool });
    expect(result.eligible.map((entry) => entry.id)).toEqual(['a']);
    expect(result.excluded).toEqual({ inactive: 1, otherNetwork: 4, outsideRadius: 0 });
  });

  it('matches out-of-state agents who cover a ZIP within 15 miles', () => {
    const nearbyZips = zipsWithinMiles(['80107'], AGENT_RECOMMENDATION_POLICY.nearbyZipMiles);
    expect(nearbyZips).toEqual(expect.arrayContaining(['80107', '80116']));
    expect(nearbyZips).not.toContain('80202');
    const result = selectEligibleAgents({ org: 'AHA', bucket: 'AHA_OOS', zips: ['80107'], nearbyZips, agents: pool });
    expect(result.eligible.map((entry) => entry.id)).toEqual(['d', 'e']);
    expect(result.excluded.outsideRadius).toBe(1);
    expect(selectEligibleAgents({ org: 'AHA', bucket: 'AHA_OOS', zips: [], nearbyZips: [], agents: pool }).reason).toBe('no_zip');
  });

  it('keeps unknown ZIPs to an exact match', () => {
    expect(zipsWithinMiles(['00000', 'bad'])).toEqual(['00000']);
  });

  it('does not apply to AFC referrals or referrals without a bucket', () => {
    expect(selectEligibleAgents({ org: 'AFC', bucket: 'AHA', zips: [], nearbyZips: [], agents: pool }).reason).toBe('not_aha');
    expect(selectEligibleAgents({ org: 'AHA', bucket: null, zips: [], nearbyZips: [], agents: pool }).reason).toBe('no_bucket');
  });

  it('keeps geographic eligibility separate from ZIP success', () => {
    const history = [closed({ agentId: 'near' }), referral({ assignedAgentId: 'near', zips: ['80116'] })];
    const result = rankAgents({
      candidates: [agent('near', { ahaDesignation: 'AHA_OOS', coveredZips: ['80116'] })],
      outcomes: deriveAgentOutcomes(history, NOW),
      activeCounts: new Map(),
      mcId: null,
      zips: ['80107'],
      nearbyZips: zipsWithinMiles(['80107']),
      fub: noFub(['near']),
    });
    expect(result.ranked[0]?.coverage).toBe('nearby');
    expect(result.ranked[0]?.factors.zip).toMatchObject({ successes: 0, trials: 0, points: 50 });
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
      referral({ status: 'Under Contract', payments: [deal({ status: 'under_contract' })] }),
    ], NOW);
    expect(rows.map((row) => [row.outcome, row.contract])).toEqual([['active', 'excluded'], ['active', 'contracted']]);
  });

  it('credits closings from the deal record, not the referral status', () => {
    const rows = deriveAgentOutcomes([closed({ agentId: 'b' }), referral({ status: 'Closed', payments: [] })], NOW);
    expect(rows.find((row) => row.agentId === 'b')?.outcome).toBe('closed');
    expect(rows.filter((row) => row.agentId === 'a').map((row) => [row.outcome, row.excludedBecause])).toEqual([
      ['excluded', 'closed_without_record'],
      ['excluded', 'closed_without_record'],
    ]);
  });

  it('does not credit agents who were reassigned away', () => {
    const rows = deriveAgentOutcomes([referral({ assignedAgentId: 'b' })], NOW);
    expect(rows.map((row) => row.agentId)).toEqual(['b']);
  });

  it('counts a client who closed or contracted with an outside agent as not closed and no contract', () => {
    const rows = deriveAgentOutcomes([
      referral({ status: 'Closed', payments: [deal({ agentAttribution: 'OUTSIDE_AGENT' })] }),
      referral({ status: 'Lost', lostReason: null, payments: [deal({ status: 'terminated', usedAssignedAgent: false })] }),
    ], NOW);
    expect(rows.map((row) => [row.outcome, row.contract])).toEqual([['not_closed', 'no_contract'], ['excluded', 'no_contract']]);
  });

  it('uses the existing loss classification and leaves unknown reasons out', () => {
    const rows = deriveAgentOutcomes([
      referral({ lostReason: 'never_connected' }),
      referral({ lostReason: 'chose_other_agent_postcontact' }),
      referral({ lostReason: null }),
      referral({ lostReason: 'something_unrecognized' }),
    ], NOW);
    expect(rows.map((row) => [row.outcome, row.excludedBecause, row.contract])).toEqual([
      ['excluded', 'excused_loss', 'excluded'],
      ['not_closed', null, 'no_contract'],
      ['excluded', 'unknown_loss_reason', 'excluded'],
      ['excluded', 'unknown_loss_reason', 'excluded'],
    ]);
  });

  it('counts terminated deals as not closed but credits reaching contract', () => {
    const rows = deriveAgentOutcomes([
      referral({ status: 'Terminated', lostReason: null, payments: [deal({ status: 'terminated' })] }),
      referral({ status: 'Lost', lostReason: null, payments: [deal({ status: 'terminated' })] }),
      referral({ status: 'Terminated', lostReason: null, payments: [] }),
      referral({ status: 'Active Lead', lostReason: null, payments: [deal({ status: 'terminated' })] }),
    ], NOW);
    expect(rows.map((row) => [row.outcome, row.contract])).toEqual([
      ['not_closed', 'contracted'],
      ['not_closed', 'contracted'],
      ['not_closed', 'excluded'],
      ['active', 'contracted'],
    ]);
  });

  it('counts a referral once however many contracts were written', () => {
    const rows = deriveAgentOutcomes([
      referral({ status: 'Closed', payments: [deal({ status: 'terminated' }), deal({ status: 'terminated' }), deal({ status: 'paid' })] }),
      referral({ status: 'Lost', payments: [deal({ status: 'terminated' }), deal({ status: 'terminated' })] }),
    ], NOW);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.outcome, row.contract])).toEqual([['closed', 'contracted'], ['not_closed', 'contracted']]);
  });

  it('records AFC only when it was answered at closing', () => {
    const rows = deriveAgentOutcomes([
      closed({ usedAfcAtClosing: false }),
      closed({ usedAfcAtClosing: true }),
      closed({ side: 'sell', usedAfcAtClosing: false }),
      referral({ status: 'Terminated', payments: [deal({ status: 'terminated', usedAfcAtClosing: false })] }),
      closed({ usedAfcAtClosing: null }),
    ], NOW);
    expect(rows.map((row) => row.afcAnswers)).toEqual([[false], [true], [], [], [null]]);
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

  it('keeps a one-for-one record from beating substantial history', () => {
    const history = [...worked('lucky', 1, 1), ...worked('steady', 20, 12), ...worked('weak', 20, 0)];
    const result = rank(history, ['lucky', 'steady', 'weak']);
    expect(result.ranked.map((entry) => entry.agentId)).toEqual(['steady', 'lucky', 'weak']);
    const lucky = result.ranked.find((entry) => entry.agentId === 'lucky');
    expect(lucky?.factors.overall).toMatchObject({ successes: 1, trials: 1 });
    expect(lucky?.evidenceStrength).toBe('Limited');
    expect(result.ranked[0]?.evidenceStrength).toBe('Strong');
  });

  it('does not let workload alone promote limited history over adequate history with stronger outcomes', () => {
    const thinId = 'thin';
    const solidId = 'solid';
    // Pool shaped like the preview case: many average closers, one 1-for-1 with an
    // empty load, and one 9-for-9 with a heavy load.
    const history = [
      ...worked(thinId, 1, 1),
      ...worked(solidId, 9, 9),
      ...worked('peer-a', 8, 7),
      ...worked('peer-b', 8, 7),
      ...worked('peer-c', 8, 6),
    ];
    const activeCounts = new Map([
      [thinId, 0],
      [solidId, 12],
      ['peer-a', 4],
      ['peer-b', 4],
      ['peer-c', 3],
    ]);
    const result = rank(history, [thinId, solidId, 'peer-a', 'peer-b', 'peer-c'], { activeCounts, mcId: null });
    const thin = result.ranked.find((entry) => entry.agentId === thinId)!;
    const solid = result.ranked.find((entry) => entry.agentId === solidId)!;
    expect(thin.adequateHistory).toBe(false);
    expect(solid.adequateHistory).toBe(true);
    expect(thin.factors.overall).toMatchObject({ successes: 1, trials: 1 });
    expect(solid.factors.overall).toMatchObject({ successes: 9, trials: 9 });
    expect(thin.factors.workload).toMatchObject({ active: 0, known: true });
    expect(solid.factors.workload).toMatchObject({ active: 12, known: true });
    expect(solid.outcomeScore).toBeGreaterThanOrEqual(thin.outcomeScore);
    expect(thin.factors.workload.points).toBeGreaterThan(solid.factors.workload.points);
    // Even if the empty-load boost made the limited agent’s full score higher, the gate keeps solid first.
    expect(compareRecommendations({ ...thin, score: solid.score + 5 }, solid)).toBeGreaterThan(0);
    expect(result.ranked[0]?.agentId).toBe(solidId);
    expect(result.ranked.map((entry) => entry.agentId)).toContain(thinId);
    expect(result.provisional).toBe(false);
  });

  it('does not treat a missing workload measurement as a confirmed empty load', () => {
    const history = [...worked('a', 6, 3), ...worked('peer', 6, 3)];
    const unknown = rank(history, ['a', 'peer']);
    const empty = rank(history, ['a', 'peer'], { activeCounts: new Map([['a', 0], ['peer', 4]]) });
    expect(unknown.ranked.find((entry) => entry.agentId === 'a')?.factors.workload).toMatchObject({ known: false, points: 50, active: 0 });
    const measuredEmpty = empty.ranked.find((entry) => entry.agentId === 'a');
    expect(measuredEmpty?.factors.workload).toMatchObject({ known: true, active: 0 });
    expect(measuredEmpty!.factors.workload.points).toBeGreaterThan(50);
    expect(unknown.ranked.find((entry) => entry.agentId === 'a')?.reasons.some((reason) => /active referral/.test(reason))).toBe(false);
    expect(measuredEmpty?.reasons.some((reason) => /0 active referral/.test(reason))).toBe(true);
  });

  it('assigns known zero workload only after a successful complete referral read', () => {
    const eligibleIds = ['a', 'b'];
    const rows = [
      { status: 'Active Lead', assignedAgentId: 'a', buySideAgentId: null, sellSideAgentId: null },
      { status: 'Paired', assignedAgentId: 'b', buySideAgentId: 'b', sellSideAgentId: null },
    ];
    expect(measuredActiveCounts({ eligibleIds, activeReferrals: null, complete: false })).toEqual(new Map());
    expect(measuredActiveCounts({ eligibleIds, activeReferrals: rows, complete: false })).toEqual(new Map());
    expect(measuredActiveCounts({ eligibleIds, activeReferrals: rows.slice(0, 1), complete: false })).toEqual(new Map());
    const completeEmpty = measuredActiveCounts({ eligibleIds, activeReferrals: [], complete: true });
    expect(completeEmpty.get('a')).toMatchObject({ active: 0, weightedActive: 0, underContract: 0 });
    expect(completeEmpty.get('b')).toMatchObject({ active: 0, weightedActive: 0, underContract: 0 });
    expect(completeEmpty.size).toBe(2);
    const complete = measuredActiveCounts({ eligibleIds, activeReferrals: rows, complete: true });
    expect(complete.get('a')).toMatchObject({ active: 1, weightedActive: 4, underContract: 0 });
    expect(complete.get('b')).toMatchObject({ active: 1, weightedActive: 2, underContract: 0 });
  });

  it('uses draft weighted stages for workload and keeps Under Contract separate', () => {
    const eligibleIds = ['a'];
    const rows = [
      { status: 'New Lead', assignedAgentId: 'a', buySideAgentId: null, sellSideAgentId: null },
      { status: 'Paired', assignedAgentId: 'a', buySideAgentId: null, sellSideAgentId: null },
      { status: 'In Communication', assignedAgentId: 'a', buySideAgentId: null, sellSideAgentId: null },
      { status: 'Active Lead', assignedAgentId: 'a', buySideAgentId: null, sellSideAgentId: null },
      { status: 'Under Contract', assignedAgentId: 'a', buySideAgentId: null, sellSideAgentId: null },
    ];
    const workload = measuredActiveCounts({ eligibleIds, activeReferrals: rows, complete: true }).get('a');

    expect(workload).toMatchObject({
      active: 4,
      weightedActive: 10,
      underContract: 1,
      stageCounts: {
        'New Lead': 1,
        Paired: 1,
        'In Communication': 1,
        'Active Lead': 1,
      },
    });
  });

  it('keeps active pipeline out of close metrics, outcome penalties, and evidence confidence', () => {
    const history = [
      ...worked('a', 6, 3),
      ...Array.from({ length: 20 }, () => referral({ assignedAgentId: 'a', status: 'Active Lead', lostReason: null })),
    ];
    const result = rank(history, ['a'], { activeCounts: new Map([['a', 80]]) });
    const entry = result.ranked[0];

    expect(entry?.factors.overall).toMatchObject({ successes: 3, trials: 6 });
    expect(entry?.missingOutcomes).toBe(0);
    expect(entry?.outcomeCompleteness).toBe(1);
    expect(entry?.evidenceStrength).toBe('Moderate');
    expect(entry?.adequateHistory).toBe(true);
  });

  it('marks the suggestion provisional when every eligible agent has limited history', () => {
    const history = [...worked('a', 1, 1), ...worked('b', 2, 1), ...worked('c', 3, 2)];
    const result = rank(history, ['a', 'b', 'c'], { activeCounts: new Map([['a', 0], ['b', 1], ['c', 2]]) });
    expect(result.ranked.every((entry) => !entry.adequateHistory)).toBe(true);
    expect(result.provisional).toBe(true);
    expect(result.ranked[0]?.evidenceStrength).toBe('Limited');
  });

  it('keeps inactive agents out even when their history would otherwise win', () => {
    const history = [...worked('blocked', 20, 18), ...worked('open', 6, 3)];
    const eligibility = selectEligibleAgents({
      org: 'AHA',
      bucket: 'AHA',
      zips: [],
      nearbyZips: [],
      agents: [agent('blocked', { active: false }), agent('open')],
    });
    expect(eligibility.eligible.map((entry) => entry.id)).toEqual(['open']);
    const result = rank(history, [], {
      candidates: eligibility.eligible,
      activeCounts: new Map([['open', 2]]),
    });
    expect(result.ranked.map((entry) => entry.agentId)).toEqual(['open']);
    expect(result.ranked.some((entry) => entry.agentId === 'blocked')).toBe(false);
  });

  it('keeps MC history prominent', () => {
    const history = [...worked('mcfit', 10, 7, MC), ...worked('generic', 10, 7, OTHER_MC), ...worked('weak', 10, 1, OTHER_MC)];
    const result = rank(history, ['mcfit', 'generic', 'weak']);
    expect(result.ranked.map((entry) => entry.agentId)).toEqual(['mcfit', 'generic', 'weak']);
    expect(result.ranked[0]?.reasons[0]).toBe('Closed 7 of 10 finished referrals with this MC');
  });

  it('shows losses with no reason but does not let them lower the score', () => {
    const base = Array.from({ length: 6 }, (_, index) => (index < 3 ? closed() : referral()));
    const withUnknown = [...base, ...Array.from({ length: 8 }, () => referral({ lostReason: null }))];
    const plain = rank(base, ['a']).ranked[0];
    const flagged = rank(withUnknown, ['a']).ranked[0];
    expect(flagged?.unknownLossReasons).toBe(8);
    expect(flagged?.score).toBe(plain?.score);
    expect(flagged?.factors.overall).toMatchObject({ successes: 3, trials: 6 });
  });

  it('uses clear denominators for close, contract, MC, ZIP, and AFC', () => {
    const history = [
      closed({ usedAfcAtClosing: true, propertyPostalCode: '80014' }),
      { ...closed({ usedAfcAtClosing: false, propertyPostalCode: '80202' }), lenderId: OTHER_MC, zips: ['80202'] },
      closed({ side: 'sell', usedAfcAtClosing: false, propertyPostalCode: '80014' }),
      closed({ usedAfcAtClosing: null, propertyPostalCode: '80014' }),
      referral(),
      referral({ status: 'Terminated', lostReason: null, payments: [deal({ status: 'terminated', propertyPostalCode: '80014' })] }),
      referral({ status: 'Active Lead', lostReason: null }),
      referral({ lostReason: 'not_qualified' }),
      referral({ lostReason: null }),
    ];
    const entry = rank(history, ['a']).ranked[0];
    expect(entry?.factors.overall).toMatchObject({ successes: 4, trials: 6 });
    expect(entry?.factors.contract).toMatchObject({ successes: 5, trials: 6 });
    expect(entry?.factors.mc).toMatchObject({ successes: 3, trials: 5 });
    expect(entry?.factors.zip).toMatchObject({ successes: 3, trials: 4 });
    expect(entry?.factors.usedAfc).toMatchObject({ successes: 1, trials: 2 });
    expect(entry?.afcUnknown).toBe(1);
    expect(entry?.unknownLossReasons).toBe(1);
    expect(entry?.excludedOutcomes).toBe(2);
  });

  it('uses verified deal ZIPs for historical ZIP evidence without penalizing unknown ZIPs', () => {
    const history = [
      { ...closed({ agentId: 'a', propertyPostalCode: '80107' }), zips: ['80014'] },
      referral({
        assignedAgentId: 'a',
        zips: [],
        status: 'Terminated',
        lostReason: null,
        payments: [deal({ status: 'terminated', agentId: 'a', propertyPostalCode: '80107' })],
      }),
      { ...closed({ agentId: 'a', propertyPostalCode: null }), zips: [] },
      { ...closed({ agentId: 'b', propertyPostalCode: '80107' }), zips: [] },
      referral({
        assignedAgentId: 'b',
        zips: [],
        status: 'Terminated',
        lostReason: null,
        payments: [deal({ status: 'terminated', agentId: 'b', propertyPostalCode: null })],
      }),
    ];
    const result = rank(history, ['a', 'b'], { mcId: null, zips: ['80107'] });
    const a = result.ranked.find((entry) => entry.agentId === 'a');
    const b = result.ranked.find((entry) => entry.agentId === 'b');

    expect(a?.factors.zip).toMatchObject({ successes: 1, trials: 2 });
    expect(b?.factors.zip).toMatchObject({ successes: 1, trials: 1 });
    expect(a?.factors.overall).toMatchObject({ successes: 2, trials: 3 });
    expect(b?.factors.overall).toMatchObject({ successes: 1, trials: 2 });
  });

  it('does not treat a referral search ZIP as historical deal ZIP evidence', () => {
    const history = [
      { ...closed({ agentId: 'a', propertyPostalCode: null }), zips: ['80107'] },
    ];

    const entry = rank(history, ['a'], { mcId: null, zips: ['80107'] }).ranked[0];

    expect(entry?.factors.zip).toMatchObject({ successes: 0, trials: 0, points: 50 });
  });

  it('labels Leah-shaped outcome samples without calling them all referrals', () => {
    const leah = 'leah';
    const history = [
      ...Array.from({ length: 8 }, () => closed({ agentId: leah })),
      referral({
        assignedAgentId: leah,
        buySideAgentId: leah,
        status: 'Closed',
        lostReason: null,
        payments: [
          deal({ agentId: leah, status: 'terminated' }),
          deal({ agentId: leah, status: 'paid' }),
        ],
      }),
      ...Array.from({ length: 12 }, () => referral({ assignedAgentId: leah, buySideAgentId: leah, status: 'Active Lead', lostReason: null })),
      ...Array.from({ length: 10 }, () => referral({ assignedAgentId: leah, buySideAgentId: leah, status: 'Lost', lostReason: null })),
      ...worked('peer', 6, 3),
    ];
    const result = rank(history, [leah, 'peer'], { mcId: null, activeCounts: new Map([[leah, 12], ['peer', 0]]) });
    const entry = result.ranked.find((candidate) => candidate.agentId === leah);

    expect(entry?.factors.overall).toMatchObject({ successes: 9, trials: 9 });
    expect(entry?.factors.contract).toMatchObject({ successes: 9, trials: 9, points: 50, applicable: false });
    expect(entry?.unknownLossReasons).toBe(10);
    expect(entry?.factors.workload).toMatchObject({ active: 12, known: true });
    expect(entry?.evidenceStrength).toBe('Limited');
    expect(entry?.adequateHistory).toBe(false);
    expect(entry?.reasons[0]).toBe('9 closed · 12 active · 10 losses without a reason');
    expect(entry?.reasons).toContain('Closed 9 of 9 finished referrals overall');
    expect(entry?.reasons).toContain('9 documented contracts');
    expect(entry?.reasons).not.toContain('Reached a contract on 9 of 9 referrals');
  });

  it('withholds contract-rate scoring until there is a documented failure to reach contract', () => {
    const positiveOnly = rank(
      Array.from({ length: 6 }, () => referral({ status: 'Active Lead', payments: [deal({ status: 'under_contract', agentId: 'positive' })], assignedAgentId: 'positive' })),
      ['positive'],
      { mcId: null, activeCounts: new Map([['positive', 6]]) },
    ).ranked[0];
    expect(positiveOnly?.factors.contract).toMatchObject({ successes: 6, trials: 6, applicable: false, points: 50 });
    expect(positiveOnly?.reasons).toContain('6 documented contracts');

    const withFailures = rank(
      [
        ...Array.from({ length: 3 }, () => referral({ status: 'Terminated', lostReason: null, payments: [deal({ status: 'terminated', agentId: 'mixed' })], assignedAgentId: 'mixed' })),
        ...Array.from({ length: 3 }, () => referral({ assignedAgentId: 'mixed', lostReason: 'chose_other_agent_postcontact' })),
      ],
      ['mixed'],
      { mcId: null },
    ).ranked[0];
    expect(withFailures?.factors.contract.applicable).toBe(true);
    expect(withFailures?.factors.contract).toMatchObject({ successes: 3, trials: 6 });
    expect(withFailures?.reasons).toContain('Reached a contract on 3 of 6 referrals with known contract results');
  });

  it('rewards contract conversion even when the deal fell through', () => {
    const history = [
      ...Array.from({ length: 6 }, () => ({ ...referral({ status: 'Terminated', lostReason: null, payments: [deal({ status: 'terminated', agentId: 'reached' })] }), assignedAgentId: 'reached' })),
      ...Array.from({ length: 6 }, () => referral({ assignedAgentId: 'stalled' })),
    ];
    const result = rank(history, ['reached', 'stalled']);
    const reached = result.ranked.find((entry) => entry.agentId === 'reached');
    expect(reached?.factors.overall).toMatchObject({ successes: 0, trials: 6 });
    expect(reached?.factors.contract).toMatchObject({ successes: 6, trials: 6, points: 50, applicable: false });
    expect(result.ranked[0]?.agentId).toBe('reached');
  });

  it('does not reward or penalize missing evidence', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      ...(index < 5 ? closed({ agentId: 'known', usedAfcAtClosing: index % 2 === 0 }) : referral()),
      assignedAgentId: 'known',
    }));
    const result = rank(history, ['known', 'new'], { mcId: null, zips: [] });
    const fresh = result.ranked.find((entry) => entry.agentId === 'new');
    expect(fresh?.factors.mc).toMatchObject({ applicable: false, points: 50 });
    expect(fresh?.factors.zip).toMatchObject({ applicable: false, points: 50 });
    expect(fresh?.factors.overall.points).toBe(50);
    expect(fresh?.factors.contract.points).toBe(50);
    expect(fresh?.factors.usedAfc.points).toBe(50);
    expect(fresh?.baseScore).toBe(50);
    expect(fresh?.reasons).toContain('No finished referrals in the last 24 months yet');
  });

  it('prefers lighter workloads and does not count active referrals as losses', () => {
    const result = rankAgents({ candidates: [agent('busy'), agent('free')], outcomes: [], activeCounts: new Map([['busy', 9], ['free', 1]]), mcId: MC, zips: ['80014'], fub: noFub(['busy', 'free']) });
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
    const history = Array.from({ length: 6 }, () => closed());
    const result = rankAgents({ candidates: [agent('a')], outcomes: deriveAgentOutcomes(history, NOW), activeCounts: new Map([['a', 2]]), mcId: MC, zips: ['80014'], fub: noFub(['a']) });
    expect(result.ranked[0]?.reasons).toHaveLength(3);
  });

  it('keeps the weights summing to one with MC history weighted most', () => {
    const weights = Object.values(AGENT_RECOMMENDATION_POLICY.weights);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
    expect(Math.max(...weights)).toBe(AGENT_RECOMMENDATION_POLICY.weights.mc);
  });
});

describe('Follow Up Boss adjustment', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const measured = (assigned: number, contacted: number, coverageComplete = true) => ({ state: 'measured' as const, assignedPeople: assigned, contactedPeople: contacted, coverageComplete });
  const activity = new Map([
    ['a', measured(10, 10)],
    ['b', measured(10, 5)],
    ['c', measured(10, 0)],
    ['d', measured(10, 9, false)],
  ]);

  it('is paused for now, so every agent stays neutral', () => {
    expect(AGENT_RECOMMENDATION_POLICY.fubContributionEnabled).toBe(false);
    const result = fubAdjustments(ids, { permitted: true, connected: true, activity });
    expect([...result.values()].every((entry) => entry.state === 'neutral' && entry.reason === 'paused')).toBe(true);
  });

  it('gives unauthorized viewers Referrio-only results when enabled', () => {
    const result = fubAdjustments(ids, { permitted: false, connected: true, activity, enabled: true });
    expect([...result.values()].every((entry) => entry.state === 'neutral' && entry.reason === 'not_permitted')).toBe(true);
  });

  it('caps the change at five points and keeps unlinked or incomplete agents at zero when enabled', () => {
    const result = fubAdjustments(ids, { permitted: true, connected: true, activity, enabled: true });
    expect(result.get('a')).toMatchObject({ state: 'applied', points: AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment });
    expect(result.get('b')).toMatchObject({ state: 'applied', points: 0 });
    expect(result.get('c')).toMatchObject({ state: 'applied', points: -AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment });
    expect(result.get('d')).toEqual({ state: 'neutral', reason: 'incomplete_coverage' });
    expect(result.get('e')).toEqual({ state: 'neutral', reason: 'not_linked' });
  });

  it('does not compare when too few agents qualify', () => {
    const result = fubAdjustments(['a', 'b'], { permitted: true, connected: true, activity: new Map([['a', measured(10, 10)], ['b', measured(3, 0)]]), enabled: true });
    expect(result.get('a')).toEqual({ state: 'neutral', reason: 'too_few_comparable' });
    expect(result.get('b')).toEqual({ state: 'neutral', reason: 'small_sample' });
  });

  it('moves the final score by no more than the adjustment', () => {
    const fub = fubAdjustments(ids, { permitted: true, connected: true, activity, enabled: true });
    const ranked = rankAgents({ candidates: ids.map((id) => agent(id)), outcomes: [], activeCounts: new Map(), mcId: MC, zips: ['80014'], fub }).ranked;
    for (const entry of ranked) {
      expect(Math.abs(entry.score - entry.baseScore)).toBeLessThanOrEqual(AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment);
    }
    expect(ranked[0]?.agentId).toBe('a');
    expect(ranked.find((entry) => entry.agentId === 'e')?.score).toBe(50);
  });
});
