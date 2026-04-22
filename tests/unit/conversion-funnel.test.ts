import { describe, expect, it } from '@jest/globals';

import {
  buildConversionFunnel,
  FUNNEL_STAGE_ORDER,
  type FunnelReferralInput
} from '@/lib/server/conversion-funnel';

const day = (iso: string) => new Date(iso);

function statusChange(
  previousValue: string | null,
  newValue: string,
  timestamp: string
): Record<string, unknown> {
  return {
    field: 'status',
    previousValue,
    newValue,
    timestamp: day(timestamp)
  };
}

function referral(id: string, overrides: Partial<FunnelReferralInput> = {}): FunnelReferralInput {
  return {
    _id: id,
    status: 'New Lead',
    createdAt: day('2026-01-01T00:00:00Z'),
    statusLastUpdated: day('2026-01-01T00:00:00Z'),
    referralDate: null,
    audit: [],
    sla: null,
    ...overrides
  };
}

describe('buildConversionFunnel', () => {
  it('emits exactly the six active-pipeline stages in order', () => {
    const result = buildConversionFunnel([]);
    expect(result.stages.map((s) => s.status)).toEqual(FUNNEL_STAGE_ORDER);
    expect(result.terminal).toEqual({ lostTotal: 0, terminatedTotal: 0 });
  });

  it('counts referrals cumulatively using maxStageReached from audit history', () => {
    const referrals: FunnelReferralInput[] = [
      referral('a', {
        status: 'In Communication',
        createdAt: day('2026-01-01T00:00:00Z'),
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z'),
          statusChange('Paired', 'In Communication', '2026-01-05T00:00:00Z')
        ]
      }),
      referral('b', {
        status: 'New Lead',
        createdAt: day('2026-01-03T00:00:00Z')
      }),
      referral('c', {
        status: 'Under Contract',
        createdAt: day('2026-01-01T00:00:00Z'),
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z'),
          statusChange('Paired', 'In Communication', '2026-01-04T00:00:00Z'),
          statusChange('In Communication', 'Active Lead', '2026-01-06T00:00:00Z'),
          statusChange('Active Lead', 'Under Contract', '2026-01-10T00:00:00Z')
        ]
      })
    ];

    const { stages } = buildConversionFunnel(referrals);
    const countByStage = Object.fromEntries(stages.map((s) => [s.status, s.count]));
    expect(countByStage['New Lead']).toBe(3);
    expect(countByStage['Paired']).toBe(2);
    expect(countByStage['In Communication']).toBe(2);
    expect(countByStage['Active Lead']).toBe(1);
    expect(countByStage['Under Contract']).toBe(1);
    expect(countByStage['Closed']).toBe(0);
  });

  it('keeps conversionFromPrevious in [0,100] and is null when previous is zero', () => {
    const referrals: FunnelReferralInput[] = [
      referral('a', {
        status: 'Paired',
        audit: [statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z')]
      }),
      referral('b', { status: 'New Lead' })
    ];
    const { stages } = buildConversionFunnel(referrals);
    for (const stage of stages) {
      if (stage.conversionFromPrevious != null) {
        expect(stage.conversionFromPrevious).toBeGreaterThanOrEqual(0);
        expect(stage.conversionFromPrevious).toBeLessThanOrEqual(100);
      }
    }
    const paired = stages.find((s) => s.status === 'Paired');
    expect(paired?.conversionFromPrevious).toBeCloseTo(50, 1);
    const closed = stages.find((s) => s.status === 'Closed');
    expect(closed?.count).toBe(0);
    expect(closed?.conversionFromPrevious).toBeNull();
  });

  it('treats bounce-backs as non-overwriting: uses first-entry timestamps', () => {
    const referrals: FunnelReferralInput[] = [
      referral('a', {
        status: 'Active Lead',
        createdAt: day('2026-01-01T00:00:00Z'),
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z'),
          statusChange('Paired', 'In Communication', '2026-01-04T00:00:00Z'),
          statusChange('In Communication', 'Active Lead', '2026-01-06T00:00:00Z'),
          statusChange('Active Lead', 'In Communication', '2026-01-09T00:00:00Z'),
          statusChange('In Communication', 'Active Lead', '2026-01-12T00:00:00Z')
        ]
      })
    ];
    const { stages } = buildConversionFunnel(referrals);
    const pairedStage = stages.find((s) => s.status === 'Paired');
    const inComm = stages.find((s) => s.status === 'In Communication');
    const active = stages.find((s) => s.status === 'Active Lead');
    expect(pairedStage?.count).toBe(1);
    expect(inComm?.count).toBe(1);
    expect(active?.count).toBe(1);
    // Paired -> In Communication uses first entries: 01-04 minus 01-02 = 2 days
    expect(pairedStage?.avgDaysInStage).toBeCloseTo(2, 1);
    // In Communication -> Active Lead uses FIRST entry for both (01-06 and 01-04), not bounce-back 01-12
    expect(inComm?.avgDaysInStage).toBeCloseTo(2, 1);
  });

  it('normalizes "Showing Homes" audit entries to Active Lead', () => {
    const referrals: FunnelReferralInput[] = [
      referral('a', {
        status: 'Showing Homes',
        audit: [
          statusChange('Paired', 'Showing Homes', '2026-01-05T00:00:00Z')
        ]
      })
    ];
    const { stages } = buildConversionFunnel(referrals);
    const active = stages.find((s) => s.status === 'Active Lead');
    expect(active?.count).toBe(1);
  });

  it('falls back to SLA timestamps for legacy referrals with no audit', () => {
    const referrals: FunnelReferralInput[] = [
      referral('legacy', {
        status: 'Under Contract',
        createdAt: day('2026-01-01T00:00:00Z'),
        audit: [],
        sla: {
          lastPairedAt: day('2026-01-03T00:00:00Z'),
          lastUnderContractAt: day('2026-01-10T00:00:00Z')
        }
      })
    ];
    const { stages } = buildConversionFunnel(referrals);
    const pairedStage = stages.find((s) => s.status === 'Paired');
    const underContract = stages.find((s) => s.status === 'Under Contract');
    expect(pairedStage?.count).toBe(1);
    expect(underContract?.count).toBe(1);
  });

  it('lifts maxStageReached to Closed via closedDealReferralIds override', () => {
    const referrals: FunnelReferralInput[] = [
      referral('uc', {
        status: 'Under Contract',
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z'),
          statusChange('Paired', 'Under Contract', '2026-01-05T00:00:00Z')
        ]
      })
    ];
    const { stages } = buildConversionFunnel(referrals, {
      closedDealReferralIds: new Set(['uc'])
    });
    const closed = stages.find((s) => s.status === 'Closed');
    expect(closed?.count).toBe(1);
  });

  it('computes avgDaysInStage as mean(enteredNext - enteredThis) only over advancers; Closed stage is null', () => {
    const referrals: FunnelReferralInput[] = [
      referral('a', {
        status: 'In Communication',
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-05T00:00:00Z'),
          statusChange('Paired', 'In Communication', '2026-01-08T00:00:00Z')
        ],
        createdAt: day('2026-01-01T00:00:00Z')
      }),
      referral('b', {
        status: 'In Communication',
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-03T00:00:00Z'),
          statusChange('Paired', 'In Communication', '2026-01-10T00:00:00Z')
        ],
        createdAt: day('2026-01-01T00:00:00Z')
      }),
      referral('stuck', {
        status: 'New Lead',
        createdAt: day('2026-01-01T00:00:00Z')
      })
    ];
    const { stages } = buildConversionFunnel(referrals);
    const paired = stages.find((s) => s.status === 'Paired');
    expect(paired?.avgDaysInStage).toBeCloseTo((3 + 7) / 2, 1);
    const closed = stages.find((s) => s.status === 'Closed');
    expect(closed?.avgDaysInStage).toBeNull();
  });

  it('counts terminal outcomes separately and excludes them from active-stage counts', () => {
    const referrals: FunnelReferralInput[] = [
      referral('lost-from-paired', {
        status: 'Lost',
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z'),
          statusChange('Paired', 'Lost', '2026-01-08T00:00:00Z')
        ]
      }),
      referral('terminated-from-active', {
        status: 'Terminated',
        audit: [
          statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z'),
          statusChange('Paired', 'Active Lead', '2026-01-04T00:00:00Z'),
          statusChange('Active Lead', 'Terminated', '2026-01-09T00:00:00Z')
        ]
      }),
      referral('active', {
        status: 'Paired',
        audit: [statusChange('New Lead', 'Paired', '2026-01-02T00:00:00Z')]
      })
    ];
    const { stages, terminal } = buildConversionFunnel(referrals);
    expect(terminal).toEqual({ lostTotal: 1, terminatedTotal: 1 });
    const newLead = stages.find((s) => s.status === 'New Lead');
    expect(newLead?.count).toBe(3);
    const pairedStage = stages.find((s) => s.status === 'Paired');
    expect(pairedStage?.count).toBe(3);
    const active = stages.find((s) => s.status === 'Active Lead');
    expect(active?.count).toBe(1);
    // Neither Lost nor Terminated appear as stage rows
    expect(stages.map((s) => s.status)).not.toContain('Lost');
    expect(stages.map((s) => s.status)).not.toContain('Terminated');
  });
});
