/** @jest-environment node */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { day31DecisionCommandSchema, type Day31DecisionCommand } from '@/lib/intelligence/sop-decisions';
import { readDay31Decisions, saveDay31Decision } from '@/lib/server/fub-sop-decisions';
import { FubSopDecision } from '@/models/fub-sop-decision';
import { User } from '@/models/user';

jest.mock('@/models/user', () => ({ User: { findById: jest.fn() } }));
jest.setTimeout(60_000);

const REVIEWER = '6740aabbccddeeff00112233';
const OTHER_REVIEWER = '6740aabbccddeeff00112244';
const ORIGIN = { personId: 75, sourceNoteId: 900, at: '2026-11-01T12:00:00.000Z' };
const NOW = new Date('2026-11-24T22:00:00.000Z');
const command = (overrides: Partial<Day31DecisionCommand> = {}): Day31DecisionCommand => ({
  personId: 75, noteId: 900, decision: 'keep', reason: 'Client confirmed a spring move.',
  expectedRevision: 0, requestId: '66666666-1111-4111-8111-111111111111', ...overrides,
});
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'fub-sop-decisions-test' });
});
beforeEach(async () => {
  jest.clearAllMocks();
  await FubSopDecision.deleteMany({});
  (User.findById as jest.Mock).mockReturnValue({ select: () => ({ lean: async () => ({ name: 'Stored Reviewer' }) }) });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('records an explicit decision with source evidence and server reviewer/time', async () => {
  const result = await saveDay31Decision({ command: command(), origin: ORIGIN, reviewerId: REVIEWER, now: NOW });
  expect(result).toMatchObject({ ok: true, changed: true, record: {
    personId: 75, noteId: 900, sourceAt: ORIGIN.at, revision: 1, decision: 'keep',
    reason: 'Client confirmed a spring move.', reviewerId: REVIEWER, reviewerName: 'Stored Reviewer', decidedAt: NOW.toISOString(),
  } });
  expect(await readDay31Decisions([ORIGIN])).toEqual(result.ok ? [result.record] : []);
  expect(await readDay31Decisions([{ ...ORIGIN, sourceNoteId: 901 }])).toEqual([]);
});

test('concurrent retries create exactly one revision and are idempotent', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => saveDay31Decision({ command: command(), origin: ORIGIN, reviewerId: REVIEWER, now: NOW })));
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.filter((result) => result.ok && result.changed)).toHaveLength(1);
  const [record] = await readDay31Decisions([ORIGIN]);
  expect(record.revision).toBe(1);
  expect(record.history).toHaveLength(1);
});

test('concurrent first decisions cannot silently overwrite each other', async () => {
  const results = await Promise.all([
    saveDay31Decision({ command: command(), origin: ORIGIN, reviewerId: REVIEWER, now: NOW }),
    saveDay31Decision({ command: command({ decision: 'release', reason: 'No relationship established.', requestId: '66666666-2222-4222-8222-222222222222' }), origin: ORIGIN, reviewerId: OTHER_REVIEWER, now: NOW }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, status: 409, reason: 'conflict' }]);
  const [record] = await readDay31Decisions([ORIGIN]);
  expect(record.history).toHaveLength(1);
});

test('a correction appends history and stale concurrent corrections conflict', async () => {
  await saveDay31Decision({ command: command(), origin: ORIGIN, reviewerId: REVIEWER, now: NOW });
  const correction = command({ decision: 'release', reason: 'Client asked for a different agent.', expectedRevision: 1, requestId: '66666666-2222-4222-8222-222222222222' });
  const results = await Promise.all([
    saveDay31Decision({ command: correction, origin: ORIGIN, reviewerId: OTHER_REVIEWER, now: new Date(NOW.getTime() + 1000) }),
    saveDay31Decision({ command: { ...correction, decision: 'keep', reason: 'A competing correction.', requestId: '66666666-3333-4333-8333-333333333333' }, origin: ORIGIN, reviewerId: REVIEWER, now: NOW }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toHaveLength(1);
  const [record] = await readDay31Decisions([ORIGIN]);
  expect(record.revision).toBe(2);
  expect(record.history).toHaveLength(2);
  expect(record.history[0]).toMatchObject({ decision: 'keep', reason: command().reason, reviewerId: REVIEWER, decidedAt: NOW.toISOString() });
});

test('reused request IDs cannot change the payload or reviewer', async () => {
  await saveDay31Decision({ command: command(), origin: ORIGIN, reviewerId: REVIEWER, now: NOW });
  for (const input of [
    { command: command({ decision: 'release' }), reviewerId: REVIEWER },
    { command: command(), reviewerId: OTHER_REVIEWER },
    { command: command({ reason: 'Changed reason.' }), reviewerId: REVIEWER },
  ]) {
    expect(await saveDay31Decision({ ...input, origin: ORIGIN, now: NOW })).toEqual({ ok: false, status: 409, reason: 'conflict' });
  }
  expect((await readDay31Decisions([ORIGIN]))[0].history).toHaveLength(1);
});

test('a mismatched source review never creates a decision', async () => {
  await expect(saveDay31Decision({ command: command({ personId: 76 }), origin: ORIGIN, reviewerId: REVIEWER, now: NOW })).rejects.toThrow('verified Day 31 review');
  expect(await FubSopDecision.countDocuments({})).toBe(0);
});

test('decision input rejects fabricated reviewer fields and missing explicit reasons', () => {
  expect(day31DecisionCommandSchema.safeParse({ ...command(), reviewerId: OTHER_REVIEWER }).success).toBe(false);
  expect(day31DecisionCommandSchema.safeParse(command({ reason: '  ' })).success).toBe(false);
  expect(day31DecisionCommandSchema.safeParse({ ...command(), decision: 'recent-contact' }).success).toBe(false);
  expect(day31DecisionCommandSchema.parse(command({ reason: '  Explicit reason.  ' })).reason).toBe('Explicit reason.');
});
