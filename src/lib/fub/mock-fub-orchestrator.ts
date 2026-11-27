import {
  nextRunnableMockFubStep,
  summarizeMockFubSteps,
} from '@/lib/fub/mock-fub-journal';
import type { MockFubNoteInput } from '@/lib/fub/fub-send-policy';
import type {
  MockFubSendAttemptRecord,
  MockFubStepName,
  MockFubStepRecord,
} from '@/models/mock-fub';

export type MockFubApprovalInput = {
  fixtureRunId: string;
  referralId: string;
  approvalKey: string;
  actorId: string;
  customer: {
    firstName: string;
    lastName: string;
    name: string;
    email: string;
    phone: string;
  };
  selectedAgentId: string;
  selectedAgentName: string;
  selectionSource: 'auto' | 'manual';
  fubUserId: number;
  existingPersonId: number | null;
  intakeFields: Record<string, string>;
  note: MockFubNoteInput;
};

export type MockFubClient = {
  resolveCustomer(input: {
    referralId: string;
    customer: MockFubApprovalInput['customer'];
    operationKey: string;
  }): Promise<{ personId: number; created: boolean }>;
  assignAgent(input: {
    personId: number;
    fubUserId: number;
    operationKey: string;
  }): Promise<{ previousUserId: number | null; assignedUserId: number }>;
  populateFields(input: {
    personId: number;
    fields: Record<string, string>;
    operationKey: string;
  }): Promise<{ populated: string[]; preserved: string[] }>;
  addNote(input: {
    personId: number;
    note: MockFubNoteInput;
    operationKey: string;
  }): Promise<{ created: boolean }>;
};

export type MockFubAttemptRepository = {
  getOrCreate(input: MockFubApprovalInput): Promise<MockFubSendAttemptRecord>;
  save(attempt: MockFubSendAttemptRecord): Promise<MockFubSendAttemptRecord>;
  claimStep(
    attemptId: string,
    stepName: MockFubStepName,
    at: Date,
  ): Promise<MockFubSendAttemptRecord | null>;
  markStaleRunningAmbiguous(
    attemptId: string,
    startedBefore: Date,
    at: Date,
  ): Promise<MockFubSendAttemptRecord | null>;
};

export class MockFubOperationError extends Error {
  constructor(
    readonly certainty: 'definitive' | 'ambiguous',
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'MockFubOperationError';
  }
}

export class MockFubApprovalContextMismatchError extends Error {
  constructor() {
    super('The stored approval no longer matches the selected agent or mapping.');
    this.name = 'MockFubApprovalContextMismatchError';
  }
}

export type MockFubApprovalResult = {
  status: MockFubSendAttemptRecord['status'];
  personId: number | null;
  steps: MockFubStepRecord[];
  recovered: boolean;
};

function requirePersonId(attempt: MockFubSendAttemptRecord): number {
  if (!attempt.personId) {
    throw new MockFubOperationError(
      'ambiguous',
      'person_id_missing',
      'The mock customer result did not include a person ID.',
    );
  }
  return attempt.personId;
}

async function executeStep(
  stepName: MockFubStepName,
  step: MockFubStepRecord,
  input: MockFubApprovalInput,
  attempt: MockFubSendAttemptRecord,
  client: MockFubClient,
): Promise<Record<string, unknown>> {
  switch (stepName) {
    case 'resolve_customer': {
      if (input.existingPersonId) {
        attempt.personId = input.existingPersonId;
        return { personId: input.existingPersonId, created: false, preservedLink: true };
      }
      const result = await client.resolveCustomer({
        referralId: input.referralId,
        customer: input.customer,
        operationKey: step.operationKey,
      });
      attempt.personId = result.personId;
      return result;
    }
    case 'assign_agent':
      return client.assignAgent({
        personId: requirePersonId(attempt),
        fubUserId: input.fubUserId,
        operationKey: step.operationKey,
      });
    case 'populate_fields':
      return client.populateFields({
        personId: requirePersonId(attempt),
        fields: input.intakeFields,
        operationKey: step.operationKey,
      });
    case 'add_note':
      return client.addNote({
        personId: requirePersonId(attempt),
        note: input.note,
        operationKey: step.operationKey,
      });
    default: {
      const exhaustive: never = stepName;
      throw new Error(`Unhandled mock FUB step: ${exhaustive}`);
    }
  }
}

function cloneSteps(steps: readonly MockFubStepRecord[]): MockFubStepRecord[] {
  return steps.map((step) => ({ ...step }));
}

export async function runMockFubApproval(
  input: MockFubApprovalInput,
  dependencies: {
    repository: MockFubAttemptRepository;
    client: MockFubClient;
    now?: () => Date;
  },
): Promise<MockFubApprovalResult> {
  const now = dependencies.now ?? (() => new Date());
  let attempt = await dependencies.repository.getOrCreate(input);
  if (
    attempt.approvalKey !== input.approvalKey ||
    String(attempt.selectedAgentId) !== input.selectedAgentId ||
    attempt.fubUserId !== input.fubUserId
  ) {
    throw new MockFubApprovalContextMismatchError();
  }
  const initialStatus = attempt.status;

  if (attempt.status === 'running') {
    const currentTime = now();
    const reconciled = await dependencies.repository.markStaleRunningAmbiguous(
      String(attempt._id),
      new Date(currentTime.getTime() - 60_000),
      currentTime,
    );
    if (reconciled) attempt = reconciled;
  }

  if (
    attempt.status === 'success' ||
    attempt.status === 'ambiguous' ||
    attempt.status === 'running'
  ) {
    return {
      status: attempt.status,
      personId: attempt.personId ?? null,
      steps: cloneSteps(attempt.steps),
      recovered: false,
    };
  }

  let step = nextRunnableMockFubStep(attempt.steps);
  while (step) {
    const claimed = await dependencies.repository.claimStep(
      String(attempt._id),
      step.name,
      now(),
    );
    if (!claimed) {
      attempt = await dependencies.repository.getOrCreate(input);
      return {
        status: attempt.status,
        personId: attempt.personId ?? null,
        steps: cloneSteps(attempt.steps),
        recovered: false,
      };
    }
    attempt = claimed;
    step = attempt.steps.find((candidate) => candidate.name === step?.name) ?? null;
    if (!step) {
      throw new Error('Mock FUB journal lost the running step.');
    }

    try {
      const result = await executeStep(step.name, step, input, attempt, dependencies.client);
      step.status = 'succeeded';
      step.result = result;
      step.completedAt = now();
    } catch (error) {
      const operationError =
        error instanceof MockFubOperationError
          ? error
          : new MockFubOperationError(
              'ambiguous',
              'unknown_outcome',
              error instanceof Error ? error.message : 'Unknown mock FUB failure',
            );
      step.status = operationError.certainty === 'ambiguous' ? 'ambiguous' : 'failed';
      step.errorCode = operationError.code;
      step.errorMessage = operationError.message;
      step.completedAt = now();
    }

    attempt.status = summarizeMockFubSteps(attempt.steps);
    if (attempt.status === 'success') attempt.completedAt = now();
    attempt = await dependencies.repository.save(attempt);
    if (attempt.status === 'partial_failure' || attempt.status === 'ambiguous') break;
    step = nextRunnableMockFubStep(attempt.steps);
  }

  return {
    status: attempt.status,
    personId: attempt.personId ?? null,
    steps: cloneSteps(attempt.steps),
    recovered: initialStatus === 'partial_failure' && attempt.status === 'success',
  };
}
