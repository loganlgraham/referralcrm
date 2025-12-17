import { computeSlaDurations, computeSlaInsights, type ReferralLike } from '@/utils/sla-insights';

describe('computeSlaDurations', () => {
  it('uses business hours for early stages and calendar time for post-communication stages', () => {
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
    expect(durationByKey['communication-to-contract']).toBe(2880);
    expect(durationByKey['contract-to-close']).toBe(1440);
    expect(durationByKey['close-to-paid']).toBe(1440);
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
