import {
  createMockFubClient,
  type MockFubPersonRepository,
  type MockFubPersonState,
} from '@/lib/fub/mock-fub-client';

function createPersonRepository(): MockFubPersonRepository & {
  people: MockFubPersonState[];
} {
  const people: MockFubPersonState[] = [];
  return {
    people,
    async findByReferral(fixtureRunId, referralId) {
      return people.find(
        (person) =>
          person.fixtureRunId === fixtureRunId && person.referralId === referralId,
      ) ?? null;
    },
    async findByPersonId(fixtureRunId, personId) {
      return people.find(
        (person) =>
          person.fixtureRunId === fixtureRunId && person.personId === personId,
      ) ?? null;
    },
    async nextPersonId() {
      return 500 + people.length + 1;
    },
    async create(person) {
      people.push({ ...person, fields: { ...person.fields }, notes: [...person.notes] });
      return people[people.length - 1];
    },
    async save(person) {
      const index = people.findIndex(
        (candidate) =>
          candidate.fixtureRunId === person.fixtureRunId &&
          candidate.personId === person.personId,
      );
      people[index] = {
        ...person,
        fields: { ...person.fields },
        notes: [...person.notes],
        operationKeys: [...person.operationKeys],
      };
      return people[index];
    },
  };
}

describe('persisted mock FUB client', () => {
  it('never uses network and preserves populated fields while applying the explicit agent override', async () => {
    const repository = createPersonRepository();
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw new Error('Real FUB networking attempted');
    }) as jest.MockedFunction<typeof fetch>;

    try {
      const client = createMockFubClient({
        fixtureRunId: 'fixture-1',
        repository,
      });
      const customer = await client.resolveCustomer({
        referralId: 'ref-1',
        customer: {
          firstName: 'Taylor',
          lastName: 'Client',
          name: 'Taylor Client',
          email: 'taylor@example.com',
          phone: '303-555-0100',
        },
        operationKey: 'resolve',
      });
      repository.people[0].fields.referrioSource = 'Keep';
      repository.people[0].assignedUserId = 44;
      repository.people[0].tags = ['Existing tag'];

      const assignment = await client.assignAgent({
        personId: customer.personId,
        fubUserId: 71,
        operationKey: 'assign',
        tags: ['OOS Referral'],
      });
      await client.assignAgent({ personId: customer.personId, fubUserId: 71, operationKey: 'assign', tags: ['OOS Referral'] });
      expect(repository.people[0].tags).toEqual(['Existing tag', 'OOS Referral']);
      const fields = await client.populateFields({
        personId: customer.personId,
        fields: {
          referrioSource: 'Replace',
          referrioLookingInZip: '80014',
        },
        operationKey: 'fields',
      });

      expect(assignment).toEqual({ previousUserId: 44, assignedUserId: 71, tags: ['Existing tag', 'OOS Referral'] });
      expect(fields).toEqual({
        populated: ['referrioLookingInZip'],
        preserved: ['referrioSource'],
      });
      expect(repository.people[0].fields.referrioSource).toBe('Keep');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('deduplicates customer creation and the labeled note by operation key', async () => {
    const repository = createPersonRepository();
    const client = createMockFubClient({
      fixtureRunId: 'fixture-1',
      repository,
    });
    const input = {
      referralId: 'ref-1',
      customer: {
        firstName: 'Taylor',
        lastName: 'Client',
        name: 'Taylor Client',
        email: 'taylor@example.com',
        phone: '303-555-0100',
      },
      operationKey: 'resolve',
    };
    const first = await client.resolveCustomer(input);
    const second = await client.resolveCustomer(input);
    const note = {
      key: 'referrio-aha-intake:ref-1',
      label: 'Referrio AHA intake summary',
      body: 'Summary',
    };
    const noteFirst = await client.addNote({
      personId: first.personId,
      note,
      operationKey: 'note',
    });
    const noteSecond = await client.addNote({
      personId: first.personId,
      note,
      operationKey: 'note',
    });

    expect(second).toEqual({ personId: first.personId, created: false });
    expect(noteFirst).toEqual({ created: true });
    expect(noteSecond).toEqual({ created: false });
    expect(repository.people).toHaveLength(1);
    expect(repository.people[0].notes).toHaveLength(1);
  });
});
