import {
  MockFubOperationError,
  runMockFubApproval,
  type MockFubApprovalInput,
  type MockFubAttemptRepository,
  type MockFubClient,
} from '@/lib/fub/mock-fub-orchestrator';
import { createMockFubSteps } from '@/lib/fub/mock-fub-journal';
import type { MockFubSendAttemptRecord } from '@/models/mock-fub';

const approval: MockFubApprovalInput = {
  fixtureRunId: 'fixture-run-1',
  referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  approvalKey: 'approval-1',
  actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  customer: {
    firstName: 'Taylor',
    lastName: 'Client',
    name: 'Taylor Client',
    email: 'taylor@example.com',
    phone: '303-555-0100',
  },
  selectedAgentId: 'cccccccccccccccccccccccc',
  selectedAgentName: 'Selected Agent',
  selectionSource: 'manual',
  fubUserId: 71,
  existingPersonId: null,
  intakeFields: { referrioLookingInZip: '80014' },
  note: {
    key: 'referrio-aha-intake:aaaaaaaaaaaaaaaaaaaaaaaa',
    label: 'Referrio AHA intake summary',
    body: 'Fixture note',
  },
};

function createRepository(): MockFubAttemptRepository & {
  current: () => MockFubSendAttemptRecord | null;
} {
  let attempt: MockFubSendAttemptRecord | null = null;
  const clone = (value: MockFubSendAttemptRecord): MockFubSendAttemptRecord => ({
    ...value,
    steps: value.steps.map((step) => ({ ...step })),
  });
  return {
    current: () => attempt,
    async getOrCreate(input) {
      if (attempt) return clone(attempt);
      attempt = {
        _id: 'dddddddddddddddddddddddd' as never,
        fixtureRunId: input.fixtureRunId,
        referralId: input.referralId as never,
        approvalKey: input.approvalKey,
        actorId: input.actorId as never,
        customerName: input.customer.name,
        selectedAgentId: input.selectedAgentId as never,
        selectedAgentName: input.selectedAgentName,
        selectionSource: input.selectionSource,
        fubUserId: input.fubUserId,
        personId: input.existingPersonId,
        status: 'pending',
        steps: createMockFubSteps(input.fixtureRunId, input.referralId),
        approvedAt: new Date('2026-11-20T04:00:00.000Z'),
        completedAt: null,
      };
      return clone(attempt);
    },
    async save(next) {
      attempt = clone(next);
      return clone(attempt);
    },
    async claimStep(attemptId, stepName, at) {
      if (!attempt || String(attempt._id) !== attemptId) return null;
      const step = attempt.steps.find((candidate) => candidate.name === stepName);
      if (!step || (step.status !== 'pending' && step.status !== 'failed')) return null;
      step.status = 'running';
      step.attempts += 1;
      step.startedAt = at;
      step.errorCode = null;
      step.errorMessage = null;
      attempt.status = 'running';
      return clone(attempt);
    },
    async markStaleRunningAmbiguous(attemptId, startedBefore, at) {
      if (!attempt || String(attempt._id) !== attemptId || attempt.status !== 'running') {
        return null;
      }
      const step = attempt.steps.find(
        (candidate) =>
          candidate.status === 'running' &&
          candidate.startedAt !== null &&
          candidate.startedAt <= startedBefore,
      );
      if (!step) return null;
      step.status = 'ambiguous';
      step.completedAt = at;
      step.errorCode = 'stale_running_outcome';
      step.errorMessage = 'Blind resend is blocked.';
      attempt.status = 'ambiguous';
      return clone(attempt);
    },
  };
}

function successfulClient(
  overrides: Partial<MockFubClient> = {},
): MockFubClient {
  return {
    resolveCustomer: jest.fn(async () => ({ personId: 501, created: true })),
    assignAgent: jest.fn(async () => ({ previousUserId: 44, assignedUserId: 71 })),
    populateFields: jest.fn(async () => ({ populated: ['referrioLookingInZip'], preserved: [] })),
    addNote: jest.fn(async () => ({ created: true })),
    ...overrides,
  };
}

describe('mock FUB approval orchestrator', () => {
  it('includes the OOS tag in the journaled assignment and does not repeat it on retry', async () => {
    const repository = createRepository();
    const client = successfulClient();
    const input = { ...approval, tags: ['OOS Referral'] };
    expect((await runMockFubApproval(input, { repository, client })).status).toBe('success');
    expect((await runMockFubApproval(input, { repository, client })).status).toBe('success');
    expect(client.assignAgent).toHaveBeenCalledWith(expect.objectContaining({ fubUserId: approval.fubUserId, tags: ['OOS Referral'] }));
    expect(client.assignAgent).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate completed operations on repeated approval', async () => {
    const repository = createRepository();
    const client = successfulClient();

    const first = await runMockFubApproval(approval, { repository, client });
    const second = await runMockFubApproval(approval, { repository, client });

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    expect(client.resolveCustomer).toHaveBeenCalledTimes(1);
    expect(client.addNote).toHaveBeenCalledTimes(1);
  });

  it('returns the in-flight attempt instead of duplicating a double-click', async () => {
    const repository = createRepository();
    let release: (() => void) | null = null;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = successfulClient({
      resolveCustomer: jest.fn(async () => {
        await waiting;
        return { personId: 501, created: true };
      }),
    });

    const firstPromise = runMockFubApproval(approval, { repository, client });
    await Promise.resolve();
    await Promise.resolve();
    const duplicate = await runMockFubApproval(
      approval,
      { repository, client },
    );
    release?.();
    await firstPromise;

    expect(duplicate.status).toBe('running');
    expect(client.resolveCustomer).toHaveBeenCalledTimes(1);
  });

  it('does not execute a request that loses an approval-context race', async () => {
    const repository = createRepository();
    await repository.getOrCreate(approval);
    const client = successfulClient();

    await expect(
      runMockFubApproval(
        { ...approval, selectedAgentId: 'eeeeeeeeeeeeeeeeeeeeeeee' },
        { repository, client },
      ),
    ).rejects.toThrow('stored approval no longer matches');
    expect(client.resolveCustomer).not.toHaveBeenCalled();
  });

  it('marks a timeout ambiguous and refuses a blind resend', async () => {
    const repository = createRepository();
    const client = successfulClient({
      assignAgent: jest.fn(async () => {
        throw new MockFubOperationError('ambiguous', 'timeout', 'Assignment timed out');
      }),
    });

    const first = await runMockFubApproval(approval, { repository, client });
    const second = await runMockFubApproval(approval, { repository, client });

    expect(first.status).toBe('ambiguous');
    expect(second.status).toBe('ambiguous');
    expect(client.assignAgent).toHaveBeenCalledTimes(1);
    expect(client.populateFields).not.toHaveBeenCalled();
  });

  it('marks an abandoned running step ambiguous instead of resending it', async () => {
    const repository = createRepository();
    await repository.getOrCreate(approval);
    const attempt = repository.current();
    if (!attempt) throw new Error('Expected fixture attempt');
    attempt.status = 'running';
    attempt.steps[0].status = 'running';
    attempt.steps[0].startedAt = new Date('2026-11-20T03:58:00.000Z');
    const client = successfulClient();

    const result = await runMockFubApproval(approval, {
      repository,
      client,
      now: () => new Date('2026-11-20T04:00:00.000Z'),
    });

    expect(result.status).toBe('ambiguous');
    expect(client.resolveCustomer).not.toHaveBeenCalled();
  });

  it('recovers a known partial failure by retrying only the failed step', async () => {
    const repository = createRepository();
    const populateFields = jest
      .fn()
      .mockRejectedValueOnce(
        new MockFubOperationError('definitive', 'validation', 'Mapped field rejected'),
      )
      .mockResolvedValueOnce({ populated: ['referrioLookingInZip'], preserved: [] });
    const client = successfulClient({ populateFields });

    const first = await runMockFubApproval(approval, { repository, client });
    const recovered = await runMockFubApproval(approval, { repository, client });

    expect(first.status).toBe('partial_failure');
    expect(recovered.status).toBe('success');
    expect(client.resolveCustomer).toHaveBeenCalledTimes(1);
    expect(client.assignAgent).toHaveBeenCalledTimes(1);
    expect(populateFields).toHaveBeenCalledTimes(2);
    expect(client.addNote).toHaveBeenCalledTimes(1);
  });
});
