import { computeSlaDurations, computeSlaInsights, calculateBusinessMinutesBetween, type ReferralLike } from '@/utils/sla-insights';

describe('computeSlaDurations', () => {
  it('uses business hours for early stages and earliest lead date for communication-to-contract', () => {
    const createdAt = new Date('2024-01-05T23:00:00Z');
    const pairedAt = new Date('2024-01-08T17:00:00Z');
    const communicationAt = new Date('2024-01-08T19:00:00Z');
    const underContractAt = new Date('2024-01-10T19:00:00Z');
    const closedAt = new Date('2024-01-11T19:00:00Z');
    const paidAt = new Date('2024-01-12T19:00:00Z');

    const referral: ReferralLike = {
      _id: 'ref-1',
      status: 'Paid',
      statusLastUpdated: paidAt.toISOString(),
      createdAt: createdAt.toISOString(),
      audit: [
        { field: 'status', newValue: 'Paired', timestamp: pairedAt.toISOString() },
        { field: 'status', newValue: 'In Communication', timestamp: communicationAt.toISOString() },
        { field: 'status', newValue: 'Under Contract', timestamp: underContractAt.toISOString() },
        { field: 'status', newValue: 'Closed', timestamp: closedAt.toISOString() },
        { field: 'status', newValue: 'Paid', timestamp: paidAt.toISOString() },
      ],
      payments: [
        { status: 'under_contract', createdAt: underContractAt.toISOString() },
        { status: 'closed', createdAt: closedAt.toISOString() },
        { status: 'paid', createdAt: paidAt.toISOString(), paidDate: paidAt.toISOString() },
      ],
    };

    const durations = computeSlaDurations(referral);
    const durationByKey = Object.fromEntries(durations.map((duration) => [duration.key, duration.minutes]));

    expect(durationByKey['new-lead-to-paired']).toBe(180);
    expect(durationByKey['paired-to-communication']).toBe(120);
    expect(durationByKey['communication-to-contract']).toBe(6960);
    expect(durationByKey['contract-to-close']).toBe(1440);
    expect(durationByKey['close-to-paid']).toBe(1440);
  });

  it('uses stored SLA values as fallback when deal timestamps are missing', () => {
    const underContractDate = new Date('2024-04-10T18:00:00Z');
    const closedDate = new Date('2024-04-12T18:00:00Z');
    
    // Referral with deal timestamps but stored SLA values should be used as fallback for paid
    const referral: ReferralLike = {
      _id: 'ref-stored-sla',
      status: 'Closed',
      statusLastUpdated: closedDate.toISOString(),
      createdAt: new Date('2024-04-01T18:00:00Z').toISOString(),
      audit: [
        { field: 'status', newValue: 'Under Contract', timestamp: underContractDate.toISOString() },
        { field: 'status', newValue: 'Closed', timestamp: closedDate.toISOString() },
      ],
      sla: {
        contractToCloseMinutes: null,
        closedToPaidMinutes: 1440, // 24 hours stored (should be used since no paid timestamp)
        previousContractToCloseMinutes: 1800,
        previousClosedToPaidMinutes: 1200,
      },
      payments: [
        { status: 'under_contract', createdAt: underContractDate.toISOString() },
        { status: 'closed', createdAt: closedDate.toISOString() },
        // No paid payment, so closedToPaid will be null and stored value should be used
      ],
    };

    const durations = computeSlaDurations(referral);
    const closeToPaid = durations.find(d => d.key === 'close-to-paid');
    
    // Should use stored value since there's no paid timestamp
    expect(closeToPaid?.minutes).toBe(1440);
    expect(closeToPaid?.formatted).toContain('24h');
  });

  it('shows previous values when current is pending', () => {
    const now = new Date('2024-04-15T18:00:00Z');
    
    const referral: ReferralLike = {
      _id: 'ref-previous-sla',
      status: 'Under Contract',
      statusLastUpdated: now.toISOString(),
      createdAt: new Date('2024-04-01T18:00:00Z').toISOString(),
      sla: {
        contractToCloseMinutes: null,
        closedToPaidMinutes: null,
        previousContractToCloseMinutes: 1800, // 30 hours from previous deal
        previousClosedToPaidMinutes: 1200,
      },
      payments: [
        { status: 'under_contract', createdAt: now.toISOString() },
      ],
    };

    const durations = computeSlaDurations(referral);
    const contractToClose = durations.find(d => d.key === 'contract-to-close');
    
    expect(contractToClose?.minutes).toBeNull();
    expect(contractToClose?.formatted).toContain('Pending');
    expect(contractToClose?.formatted).toContain('prev 30h');
  });

  it('uses historical referralDate when it is earlier than createdAt', () => {
    const referral: ReferralLike = {
      _id: 'ref-earlier-referral-date',
      createdAt: '2024-01-03T00:00:00Z',
      referralDate: '2024-01-01T00:00:00Z',
      audit: [{ field: 'status', newValue: 'Under Contract', timestamp: '2024-01-05T00:00:00Z' }],
    };

    const durations = computeSlaDurations(referral);
    const communicationToContract = durations.find((duration) => duration.key === 'communication-to-contract');

    expect(communicationToContract?.minutes).toBe(5760);
  });

  it('uses createdAt when it is earlier than historical referralDate', () => {
    const referral: ReferralLike = {
      _id: 'ref-earlier-created-at',
      createdAt: '2024-01-01T00:00:00Z',
      referralDate: '2024-01-03T00:00:00Z',
      audit: [{ field: 'status', newValue: 'Under Contract', timestamp: '2024-01-04T00:00:00Z' }],
    };

    const durations = computeSlaDurations(referral);
    const communicationToContract = durations.find((duration) => duration.key === 'communication-to-contract');

    expect(communicationToContract?.minutes).toBe(4320);
  });

  it('falls back to createdAt when historical referralDate is invalid', () => {
    const referral: ReferralLike = {
      _id: 'ref-invalid-referral-date',
      createdAt: '2024-01-02T00:00:00Z',
      referralDate: 'not-a-valid-date',
      audit: [{ field: 'status', newValue: 'Under Contract', timestamp: '2024-01-04T00:00:00Z' }],
    };

    const durations = computeSlaDurations(referral);
    const communicationToContract = durations.find((duration) => duration.key === 'communication-to-contract');

    expect(communicationToContract?.minutes).toBe(2880);
  });

  it('uses farthest-back fallback date even when communication status exists', () => {
    const referral: ReferralLike = {
      _id: 'ref-communication-status-priority',
      createdAt: '2024-01-02T00:00:00Z',
      referralDate: '2024-01-01T00:00:00Z',
      audit: [
        { field: 'status', newValue: 'In Communication', timestamp: '2024-01-03T00:00:00Z' },
        { field: 'status', newValue: 'Under Contract', timestamp: '2024-01-04T00:00:00Z' },
      ],
    };

    const durations = computeSlaDurations(referral);
    const communicationToContract = durations.find((duration) => duration.key === 'communication-to-contract');

    expect(communicationToContract?.minutes).toBe(4320);
  });
});

describe('computeSlaInsights', () => {
  it('creates targeted tasks when pre-approval is TBD on transfer', () => {
    const now = new Date('2024-04-01T18:00:00Z');
    jest.useFakeTimers().setSystemTime(now);

    const referral: ReferralLike = {
      _id: 'ref-preapproval-tbd',
      status: 'New Lead',
      statusLastUpdated: now.toISOString(),
      createdAt: now.toISOString(),
      origin: 'admin',
      lender: { name: 'Sample Lender' },
      stageOnTransfer: 'Pre-approval TBD',
      buySideAgent: { name: 'Taylor Agent' },
    } as ReferralLike;

    const insights = computeSlaInsights(referral);
    const ids = insights.recommendations.map((item) => item.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'mc-secure-preapproval-path',
        'preapproval-plan-admin-visibility',
        'preapproval-plan-agent',
      ])
    );

    const mcTask = insights.recommendations.find((item) => item.id === 'mc-secure-preapproval-path');
    const adminTask = insights.recommendations.find((item) => item.id === 'preapproval-plan-admin-visibility');
    const agentTask = insights.recommendations.find((item) => item.id === 'preapproval-plan-agent');

    expect(mcTask?.priority).toBe('high');
    expect(mcTask?.category).toBe('finance');
    expect(mcTask?.dueAt).toBeDefined();

    expect(adminTask?.priority).toBe('medium');
    expect(adminTask?.category).toBe('communication');
    expect(adminTask?.dueAt).toBeDefined();

    expect(agentTask?.priority).toBe('medium');
    expect(agentTask?.category).toBe('communication');
    expect(agentTask?.dueAt).toBeDefined();

    jest.useRealTimers();
  });
});

describe('Admin Dashboard SLA Averages', () => {
  it('calculates average time to first contact correctly', () => {
    const referrals = [
      { sla: { timeToFirstAgentContactHours: 12 } },
      { sla: { timeToFirstAgentContactHours: 24 } },
      { sla: { timeToFirstAgentContactHours: 6 } },
      { sla: { timeToFirstAgentContactHours: null } }, // Should be excluded
      { sla: null }, // Should be excluded
    ];

    const slaFields = referrals
      .map((referral) => referral.sla)
      .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

    const firstContactRecords = slaFields
      .map((sla) => sla.timeToFirstAgentContactHours ?? null)
      .filter((value): value is number => value != null);

    const average = firstContactRecords.length
      ? firstContactRecords.reduce((sum, value) => sum + value, 0) / firstContactRecords.length
      : 0;

    expect(firstContactRecords).toHaveLength(3);
    expect(average).toBe(14); // (12 + 24 + 6) / 3
  });

  it('calculates first contact within 24 hours rate correctly', () => {
    const referrals = [
      { sla: { timeToFirstAgentContactHours: 12 } }, // Within
      { sla: { timeToFirstAgentContactHours: 24 } }, // Exactly 24
      { sla: { timeToFirstAgentContactHours: 6 } },  // Within
      { sla: { timeToFirstAgentContactHours: 30 } }, // Outside
      { sla: { timeToFirstAgentContactHours: 18 } }, // Within
    ];

    const slaFields = referrals
      .map((referral) => referral.sla)
      .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

    const firstContactRecords = slaFields
      .map((sla) => sla.timeToFirstAgentContactHours ?? null)
      .filter((value): value is number => value != null);

    const firstContactWithin24HoursCount = firstContactRecords.filter((value) => value <= 24).length;
    const firstContactWithin24HoursRate = firstContactRecords.length
      ? (firstContactWithin24HoursCount / firstContactRecords.length) * 100
      : 0;

    expect(firstContactWithin24HoursCount).toBe(4);
    expect(firstContactWithin24HoursRate).toBe(80);
  });

  it('calculates average time to assignment correctly', () => {
    const referrals = [
      { sla: { timeToAssignmentHours: 1.5 } },
      { sla: { timeToAssignmentHours: 2.0 } },
      { sla: { timeToAssignmentHours: 0.5 } },
      { sla: { timeToAssignmentHours: 3.0 } },
    ];

    const slaFields = referrals
      .map((referral) => referral.sla)
      .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

    const timeToAssignmentValues = slaFields
      .map((sla) => sla.timeToAssignmentHours ?? null)
      .filter((value): value is number => value != null);

    const average = timeToAssignmentValues.length
      ? timeToAssignmentValues.reduce((sum, value) => sum + value, 0) / timeToAssignmentValues.length
      : 0;

    expect(average).toBe(1.75); // (1.5 + 2.0 + 0.5 + 3.0) / 4
  });

  it('calculates average days to contract correctly', () => {
    const referrals = [
      { sla: { daysToContract: 10 } },
      { sla: { daysToContract: 14 } },
      { sla: { daysToContract: 7 } },
      { sla: { daysToContract: 21 } },
      { sla: { daysToContract: null } }, // Should be excluded
    ];

    const slaFields = referrals
      .map((referral) => referral.sla)
      .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

    const daysToContractValues = slaFields
      .map((sla) => sla.daysToContract ?? null)
      .filter((value): value is number => value != null);

    const average = daysToContractValues.length
      ? daysToContractValues.reduce((sum, value) => sum + value, 0) / daysToContractValues.length
      : 0;

    expect(daysToContractValues).toHaveLength(4);
    expect(average).toBe(13); // (10 + 14 + 7 + 21) / 4
  });

  it('calculates average days to close correctly', () => {
    const referrals = [
      { sla: { daysToClose: 30 } },
      { sla: { daysToClose: 45 } },
      { sla: { daysToClose: 35 } },
      { sla: { daysToClose: 40 } },
    ];

    const slaFields = referrals
      .map((referral) => referral.sla)
      .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

    const daysToCloseValues = slaFields
      .map((sla) => sla.daysToClose ?? null)
      .filter((value): value is number => value != null);

    const average = daysToCloseValues.length
      ? daysToCloseValues.reduce((sum, value) => sum + value, 0) / daysToCloseValues.length
      : 0;

    expect(average).toBe(37.5); // (30 + 45 + 35 + 40) / 4
  });

  it('handles empty SLA data gracefully', () => {
    const referrals: any[] = [];

    const slaFields = referrals
      .map((referral) => referral.sla)
      .filter((sla): sla is NonNullable<typeof sla> => Boolean(sla));

    const timeToFirstContactAvg = slaFields.length
      ? slaFields
          .map((sla) => sla.timeToFirstAgentContactHours ?? null)
          .filter((value): value is number => value != null)
          .reduce((sum, value) => sum + value, 0) / slaFields.length
      : 0;

    expect(timeToFirstContactAvg).toBe(0);
  });
});

describe('Business Hours Calculation', () => {
  it('calculates business minutes correctly for same-day period', () => {
    // Monday 9am to Monday 11am MST = 2 hours = 120 minutes
    const start = new Date('2024-01-08T16:00:00Z'); // 9am MST (MST is UTC-7)
    const end = new Date('2024-01-08T18:00:00Z');   // 11am MST
    
    const minutes = calculateBusinessMinutesBetween(start, end);
    expect(minutes).toBe(120);
  });

  it('excludes weekend hours from calculation', () => {
    // Friday 4pm to Monday 11am MST
    const friday = new Date('2024-01-05T23:00:00Z'); // Friday 4pm MST
    const monday = new Date('2024-01-08T18:00:00Z'); // Monday 11am MST
    
    const minutes = calculateBusinessMinutesBetween(friday, monday);
    // Friday 4pm to 5pm = 60 minutes, then weekend (excluded), then Monday 8am to 11am = 180 minutes
    // Total = 60 + 180 = 240 minutes
    expect(minutes).toBe(240);
  });

  it('handles multi-day business periods correctly', () => {
    // Monday 9am to Wednesday 4pm MST
    const monday = new Date('2024-01-08T16:00:00Z');   // Monday 9am MST
    const wednesday = new Date('2024-01-10T23:00:00Z'); // Wednesday 4pm MST
    
    const minutes = calculateBusinessMinutesBetween(monday, wednesday);
    // Monday 9am-5pm = 8 hours = 480 min
    // Tuesday 8am-5pm = 9 hours = 540 min
    // Wednesday 8am-4pm = 8 hours = 480 min
    // Total = 480 + 540 + 480 = 1500 minutes
    expect(minutes).toBe(1500);
  });
});
