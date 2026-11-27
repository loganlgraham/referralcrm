import { liveFubEnabled } from '@/lib/server/live-fub-handoff';
import { Types } from 'mongoose';

import type {
  MockFubAttemptRepository,
  MockFubApprovalInput,
} from '@/lib/fub/mock-fub-orchestrator';
import type {
  MockFubPersonRepository,
  MockFubPersonState,
} from '@/lib/fub/mock-fub-client';
import { createMockFubSteps } from '@/lib/fub/mock-fub-journal';
import { canUseMockFubFixture } from '@/lib/server/fixture-safety';
import {
  FubSendAttempt,
  MockFubPerson,
  MockFubSendAttempt,
  type MockFubSendAttemptRecord,
  type MockFubStepName,
} from '@/models/mock-fub';

export class MockFubFixtureUnavailableError extends Error {
  constructor() {
    super('Mock FUB writes require the verified isolated fixture database.');
    this.name = 'MockFubFixtureUnavailableError';
  }
}

function assertFixtureTarget(): void {
  if (!canUseMockFubFixture()) throw new MockFubFixtureUnavailableError();
}

function normalizeAttempt(doc: Record<string, any>): MockFubSendAttemptRecord {
  return {
    ...doc,
    _id: new Types.ObjectId(String(doc._id)),
    referralId: new Types.ObjectId(String(doc.referralId)),
    actorId: new Types.ObjectId(String(doc.actorId)),
    selectedAgentId: new Types.ObjectId(String(doc.selectedAgentId)),
    approvedAt: new Date(doc.approvedAt),
    completedAt: doc.completedAt ? new Date(doc.completedAt) : null,
    steps: (doc.steps ?? []).map((step: Record<string, any>) => ({
      ...step,
      startedAt: step.startedAt ? new Date(step.startedAt) : null,
      completedAt: step.completedAt ? new Date(step.completedAt) : null,
    })),
  } as MockFubSendAttemptRecord;
}

export function createMongooseMockFubAttemptRepository(live = false): MockFubAttemptRepository {
  const attempts = live ? FubSendAttempt : MockFubSendAttempt;
  function assertTarget() {
    if (!live) return assertFixtureTarget();
    if (!liveFubEnabled()) throw new Error('The AHA production handoff is unavailable.');
  }
  async function findAttempt(
    fixtureRunId: string,
    referralId: string,
  ): Promise<MockFubSendAttemptRecord | null> {
    assertTarget();
    const doc = await attempts.findOne({
      fixtureRunId,
      referralId: new Types.ObjectId(referralId),
    }).lean<Record<string, any> | null>();
    return doc ? normalizeAttempt(doc) : null;
  }

  return {
    async getOrCreate(input: MockFubApprovalInput) {
      const existing = await findAttempt(input.fixtureRunId, input.referralId);
      if (existing) return existing;
      assertTarget();
      try {
        const created = await attempts.create({
          ...(live ? { _id: new Types.ObjectId(input.referralId) } : {}),
          fixtureRunId: input.fixtureRunId,
          referralId: new Types.ObjectId(input.referralId),
          approvalKey: input.approvalKey,
          actorId: new Types.ObjectId(input.actorId),
          customerName: input.customer.name,
          selectedAgentId: new Types.ObjectId(input.selectedAgentId),
          selectedAgentName: input.selectedAgentName,
          selectionSource: input.selectionSource,
          fubUserId: input.fubUserId,
          personId: input.existingPersonId,
          status: 'pending',
          steps: createMockFubSteps(input.fixtureRunId, input.referralId),
          approvedAt: new Date(),
        });
        return normalizeAttempt(created.toObject());
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const raced = await findAttempt(input.fixtureRunId, input.referralId);
        if (!raced) throw error;
        return raced;
      }
    },

    async save(attempt) {
      assertTarget();
      const doc = await attempts.findOneAndUpdate(
        { _id: attempt._id, fixtureRunId: attempt.fixtureRunId },
        {
          $set: {
            personId: attempt.personId ?? null,
            status: attempt.status,
            steps: attempt.steps,
            completedAt: attempt.completedAt ?? null,
          },
        },
        { new: true },
      ).lean<Record<string, any> | null>();
      if (!doc) throw new Error('Mock FUB attempt disappeared while saving.');
      return normalizeAttempt(doc);
    },

    async claimStep(attemptId: string, stepName: MockFubStepName, at: Date) {
      assertTarget();
      const doc = await attempts.findOneAndUpdate(
        {
          _id: new Types.ObjectId(attemptId),
          'steps': {
            $elemMatch: {
              name: stepName,
              status: { $in: ['pending', 'failed'] },
            },
          },
        },
        {
          $set: {
            status: 'running',
            'steps.$.status': 'running',
            'steps.$.startedAt': at,
            'steps.$.errorCode': null,
            'steps.$.errorMessage': null,
          },
          $inc: { 'steps.$.attempts': 1 },
        },
        { new: true },
      ).lean<Record<string, any> | null>();
      return doc ? normalizeAttempt(doc) : null;
    },

    async markStaleRunningAmbiguous(attemptId, startedBefore, at) {
      assertTarget();
      const doc = await attempts.findOneAndUpdate(
        {
          _id: new Types.ObjectId(attemptId),
          status: 'running',
          steps: {
            $elemMatch: {
              status: 'running',
              startedAt: { $lte: startedBefore },
            },
          },
        },
        {
          $set: {
            status: 'ambiguous',
            'steps.$.status': 'ambiguous',
            'steps.$.completedAt': at,
            'steps.$.errorCode': 'stale_running_outcome',
            'steps.$.errorMessage':
              'The worker stopped before recording the operation outcome. Blind resend is blocked.',
          },
        },
        { new: true },
      ).lean<Record<string, any> | null>();
      return doc ? normalizeAttempt(doc) : null;
    },
  };
}

function normalizePerson(doc: Record<string, any>): MockFubPersonState {
  return {
    fixtureRunId: String(doc.fixtureRunId),
    personId: Number(doc.personId),
    referralId: String(doc.referralId),
    firstName: String(doc.firstName ?? ''),
    lastName: String(doc.lastName ?? ''),
    email: String(doc.email ?? ''),
    phone: String(doc.phone ?? ''),
    assignedUserId:
      typeof doc.assignedUserId === 'number' ? doc.assignedUserId : null,
    tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    fields:
      doc.fields && typeof doc.fields === 'object'
        ? Object.fromEntries(
            Object.entries(doc.fields).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
    notes: (doc.notes ?? []).map((note: Record<string, any>) => ({
      key: String(note.key),
      label: String(note.label),
      body: String(note.body),
      createdAt: new Date(note.createdAt),
    })),
    operationKeys: Array.isArray(doc.operationKeys)
      ? doc.operationKeys.map(String)
      : [],
  };
}

export function createMongooseMockFubPersonRepository(): MockFubPersonRepository {
  return {
    async findByReferral(fixtureRunId, referralId) {
      assertFixtureTarget();
      const doc = await MockFubPerson.findOne({
        fixtureRunId,
        referralId: new Types.ObjectId(referralId),
      }).lean<Record<string, any> | null>();
      return doc ? normalizePerson(doc) : null;
    },

    async findByPersonId(fixtureRunId, personId) {
      assertFixtureTarget();
      const doc = await MockFubPerson.findOne({
        fixtureRunId,
        personId,
      }).lean<Record<string, any> | null>();
      return doc ? normalizePerson(doc) : null;
    },

    async nextPersonId(fixtureRunId) {
      assertFixtureTarget();
      const objectId = new Types.ObjectId();
      return Number.parseInt(objectId.toHexString().slice(-12), 16);
    },

    async create(person) {
      assertFixtureTarget();
      try {
        const created = await MockFubPerson.create({
          ...person,
          referralId: new Types.ObjectId(person.referralId),
        });
        return normalizePerson(created.toObject());
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const existing = await MockFubPerson.findOne({
          fixtureRunId: person.fixtureRunId,
          referralId: new Types.ObjectId(person.referralId),
        }).lean<Record<string, any> | null>();
        if (!existing) throw error;
        return normalizePerson(existing);
      }
    },

    async save(person) {
      assertFixtureTarget();
      const operationKey = person.operationKeys.at(-1);
      if (!operationKey) throw new Error('Mock FUB operation key is required.');
      const operationName = operationKey.split(':').at(-1);
      const filter = {
        fixtureRunId: person.fixtureRunId,
        personId: person.personId,
        operationKeys: { $ne: operationKey },
      };
      let doc: Record<string, any> | null;
      if (operationName === 'assign_agent') {
        doc = await MockFubPerson.findOneAndUpdate(
          filter,
          {
            $set: { assignedUserId: person.assignedUserId },
            $addToSet: { operationKeys: operationKey, tags: { $each: person.tags ?? [] } },
          },
          { new: true },
        ).lean<Record<string, any> | null>();
      } else if (operationName === 'populate_fields') {
        const fieldUpdates = Object.fromEntries(
          Object.entries(person.fields).map(([key, value]) => [
            `fields.${key}`,
            {
              $cond: [
                {
                  $gt: [
                    {
                      $strLenCP: {
                        $trim: {
                          input: { $ifNull: [`$fields.${key}`, ''] },
                        },
                      },
                    },
                    0,
                  ],
                },
                `$fields.${key}`,
                value,
              ],
            },
          ]),
        );
        doc = await MockFubPerson.findOneAndUpdate(
          filter,
          [
            {
              $set: {
                ...fieldUpdates,
                operationKeys: {
                  $setUnion: [{ $ifNull: ['$operationKeys', []] }, [operationKey]],
                },
              },
            },
          ],
          { new: true },
        ).lean<Record<string, any> | null>();
      } else if (operationName === 'add_note') {
        const note = person.notes.at(-1);
        if (!note) throw new Error('Mock FUB note is required.');
        doc = await MockFubPerson.findOneAndUpdate(
          { ...filter, 'notes.key': { $ne: note.key } },
          {
            $push: { notes: note },
            $addToSet: { operationKeys: operationKey },
          },
          { new: true },
        ).lean<Record<string, any> | null>();
      } else {
        throw new Error(`Unsupported mock FUB person operation: ${operationName}`);
      }
      if (!doc) {
        doc = await MockFubPerson.findOne({
          fixtureRunId: person.fixtureRunId,
          personId: person.personId,
        }).lean<Record<string, any> | null>();
      }
      if (!doc) throw new Error('Mock FUB person disappeared while saving.');
      return normalizePerson(doc);
    },
  };
}
