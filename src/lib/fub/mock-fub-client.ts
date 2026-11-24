import type { MockFubClient } from '@/lib/fub/mock-fub-orchestrator';
import type { MockFubNoteInput } from '@/lib/fub/fub-send-policy';

export type MockFubPersonState = {
  fixtureRunId: string;
  personId: number;
  referralId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  assignedUserId: number | null;
  fields: Record<string, string>;
  notes: Array<MockFubNoteInput & { createdAt: Date }>;
  operationKeys: string[];
};

export type MockFubPersonRepository = {
  findByReferral(
    fixtureRunId: string,
    referralId: string,
  ): Promise<MockFubPersonState | null>;
  findByPersonId(
    fixtureRunId: string,
    personId: number,
  ): Promise<MockFubPersonState | null>;
  nextPersonId(fixtureRunId: string): Promise<number>;
  create(person: MockFubPersonState): Promise<MockFubPersonState>;
  save(person: MockFubPersonState): Promise<MockFubPersonState>;
};

export type MockFubOperationName =
  | 'resolve_customer'
  | 'assign_agent'
  | 'populate_fields'
  | 'add_note';

export type MockFubBehavior = (event: {
  operation: MockFubOperationName;
  phase: 'before' | 'after';
  operationKey: string;
}) => Promise<void> | void;

function hasOperation(person: MockFubPersonState, operationKey: string): boolean {
  return person.operationKeys.includes(operationKey);
}

async function requiredPerson(
  repository: MockFubPersonRepository,
  fixtureRunId: string,
  personId: number,
): Promise<MockFubPersonState> {
  const person = await repository.findByPersonId(fixtureRunId, personId);
  if (!person) throw new Error(`Mock FUB person ${personId} was not found.`);
  return person;
}

async function notify(
  behavior: MockFubBehavior | undefined,
  operation: MockFubOperationName,
  phase: 'before' | 'after',
  operationKey: string,
): Promise<void> {
  await behavior?.({ operation, phase, operationKey });
}

export function createMockFubClient(input: {
  fixtureRunId: string;
  repository: MockFubPersonRepository;
  behavior?: MockFubBehavior;
  now?: () => Date;
}): MockFubClient {
  const now = input.now ?? (() => new Date());

  return {
    async resolveCustomer(operation) {
      const existing = await input.repository.findByReferral(
        input.fixtureRunId,
        operation.referralId,
      );
      if (existing) {
        return { personId: existing.personId, created: false };
      }

      await notify(
        input.behavior,
        'resolve_customer',
        'before',
        operation.operationKey,
      );
      const personId = await input.repository.nextPersonId(input.fixtureRunId);
      const created = await input.repository.create({
        fixtureRunId: input.fixtureRunId,
        personId,
        referralId: operation.referralId,
        firstName: operation.customer.firstName,
        lastName: operation.customer.lastName,
        email: operation.customer.email,
        phone: operation.customer.phone,
        assignedUserId: null,
        fields: {},
        notes: [],
        operationKeys: [operation.operationKey],
      });
      await notify(
        input.behavior,
        'resolve_customer',
        'after',
        operation.operationKey,
      );
      return {
        personId: created.personId,
        created: created.personId === personId,
      };
    },

    async assignAgent(operation) {
      const person = await requiredPerson(
        input.repository,
        input.fixtureRunId,
        operation.personId,
      );
      if (hasOperation(person, operation.operationKey)) {
        return {
          previousUserId: person.assignedUserId,
          assignedUserId: person.assignedUserId ?? operation.fubUserId,
        };
      }
      await notify(input.behavior, 'assign_agent', 'before', operation.operationKey);
      const previousUserId = person.assignedUserId;
      person.assignedUserId = operation.fubUserId;
      person.operationKeys.push(operation.operationKey);
      await input.repository.save(person);
      await notify(input.behavior, 'assign_agent', 'after', operation.operationKey);
      return { previousUserId, assignedUserId: operation.fubUserId };
    },

    async populateFields(operation) {
      const person = await requiredPerson(
        input.repository,
        input.fixtureRunId,
        operation.personId,
      );
      if (hasOperation(person, operation.operationKey)) {
        return { populated: [], preserved: Object.keys(operation.fields) };
      }
      await notify(
        input.behavior,
        'populate_fields',
        'before',
        operation.operationKey,
      );
      const populated: string[] = [];
      const preserved: string[] = [];
      for (const [key, value] of Object.entries(operation.fields)) {
        if (person.fields[key]?.trim()) {
          preserved.push(key);
        } else {
          person.fields[key] = value;
          populated.push(key);
        }
      }
      person.operationKeys.push(operation.operationKey);
      await input.repository.save(person);
      await notify(
        input.behavior,
        'populate_fields',
        'after',
        operation.operationKey,
      );
      return { populated, preserved };
    },

    async addNote(operation) {
      const person = await requiredPerson(
        input.repository,
        input.fixtureRunId,
        operation.personId,
      );
      if (
        hasOperation(person, operation.operationKey) ||
        person.notes.some((note) => note.key === operation.note.key)
      ) {
        return { created: false };
      }
      await notify(input.behavior, 'add_note', 'before', operation.operationKey);
      person.notes.push({ ...operation.note, createdAt: now() });
      person.operationKeys.push(operation.operationKey);
      await input.repository.save(person);
      await notify(input.behavior, 'add_note', 'after', operation.operationKey);
      return { created: true };
    },
  };
}
