import { Types } from 'mongoose';
import { VERIFIED_FUB_ACCOUNT_ID, VERIFIED_FUB_ORGANIZATION } from '@/lib/intelligence/access-control';
import type { Day31DecisionCommand, Day31DecisionRecord, Day31DecisionRevision, Day31ReviewOrigin } from '@/lib/intelligence/sop-decisions';
import { FubSopDecision } from '@/models/fub-sop-decision';
import { User } from '@/models/user';

type StoredRevision = Omit<Day31DecisionRevision, 'reviewerId' | 'decidedAt'> & {
  expectedRevision: number;
  reviewerId: Types.ObjectId;
  decidedAt: Date;
};
type StoredDecision = {
  _id: string;
  organization: typeof VERIFIED_FUB_ORGANIZATION;
  fubAccountId: string;
  personId: number;
  noteId: number;
  sourceAt: Date;
  revision: number;
  audit: StoredRevision[];
};

const MAX_REVISIONS = 200;

function identity(personId: number, noteId: number) {
  return {
    _id: `${VERIFIED_FUB_ORGANIZATION}:${VERIFIED_FUB_ACCOUNT_ID}:${personId}:${noteId}`,
    organization: VERIFIED_FUB_ORGANIZATION as typeof VERIFIED_FUB_ORGANIZATION,
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
    personId,
    noteId,
  };
}

function toRecord(row: StoredDecision): Day31DecisionRecord {
  const history = row.audit.map((entry) => ({
    revision: entry.revision,
    requestId: entry.requestId,
    decision: entry.decision,
    reason: entry.reason,
    reviewerId: String(entry.reviewerId),
    reviewerName: entry.reviewerName,
    decidedAt: new Date(entry.decidedAt).toISOString(),
  }));
  const latest = history[history.length - 1];
  if (!latest || latest.revision !== row.revision) throw new Error('Invalid Day 31 decision history.');
  return {
    personId: row.personId,
    noteId: row.noteId,
    sourceAt: new Date(row.sourceAt).toISOString(),
    revision: row.revision,
    decision: latest.decision,
    reason: latest.reason,
    reviewerId: latest.reviewerId,
    reviewerName: latest.reviewerName,
    decidedAt: latest.decidedAt,
    history,
  };
}

/** Call only after checking the viewer's current dashboard grant. */
export async function readDay31Decisions(reviews: readonly Day31ReviewOrigin[]): Promise<Day31DecisionRecord[]> {
  if (reviews.length === 0) return [];
  if (reviews.length > 2000) throw new Error('Too many Day 31 reviews.');
  const ids = [...new Set(reviews.map((review) => identity(review.personId, review.sourceNoteId)._id))];
  const rows = await FubSopDecision.find({
    _id: { $in: ids },
    organization: VERIFIED_FUB_ORGANIZATION,
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
  }).lean<StoredDecision[]>();
  return rows.map(toRecord);
}

export type SaveDay31DecisionResult =
  | { ok: true; changed: boolean; record: Day31DecisionRecord }
  | { ok: false; status: 409; reason: 'conflict' | 'limit' };

/** The caller verifies both current permission and the exact FUB review origin. */
export async function saveDay31Decision(input: {
  command: Day31DecisionCommand;
  origin: Day31ReviewOrigin;
  reviewerId: string;
  now?: Date;
}): Promise<SaveDay31DecisionResult> {
  const { command, origin } = input;
  if (command.personId !== origin.personId || command.noteId !== origin.sourceNoteId || !Number.isFinite(Date.parse(origin.at))) {
    throw new Error('The decision does not match the verified Day 31 review.');
  }
  if (!Types.ObjectId.isValid(input.reviewerId)) throw new Error('Invalid reviewer.');
  const key = identity(origin.personId, origin.sourceNoteId);
  const existing = await FubSopDecision.findOne(key).lean<StoredDecision | null>();
  const duplicate = duplicateResult(existing, command, input.reviewerId);
  if (duplicate) return duplicate;
  if ((existing?.revision ?? 0) !== command.expectedRevision) return conflict();
  if (command.expectedRevision >= MAX_REVISIONS) return { ok: false, status: 409, reason: 'limit' };

  const reviewer = await User.findById(input.reviewerId).select('name').lean<{ name?: unknown } | null>();
  if (!reviewer) throw new Error('Reviewer no longer exists.');
  const displayName = typeof reviewer.name === 'string' && reviewer.name.trim() ? reviewer.name.trim() : 'Administrator';
  const revision: StoredRevision = {
    revision: command.expectedRevision + 1,
    requestId: command.requestId,
    expectedRevision: command.expectedRevision,
    decision: command.decision,
    reason: command.reason,
    reviewerId: new Types.ObjectId(input.reviewerId),
    reviewerName: displayName.slice(0, 500),
    decidedAt: input.now ?? new Date(),
  };

  if (!existing) {
    try {
      await FubSopDecision.create({ ...key, sourceAt: new Date(origin.at), revision: 1, audit: [revision] });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      return raced(key, command, input.reviewerId);
    }
    return { ok: true, changed: true, record: toRecord({ ...key, sourceAt: new Date(origin.at), revision: 1, audit: [revision] }) };
  }

  const updated = await FubSopDecision.updateOne(
    { ...key, revision: command.expectedRevision, 'audit.requestId': { $ne: command.requestId } },
    { $push: { audit: revision }, $inc: { revision: 1 } },
    { runValidators: true },
  );
  if (updated.matchedCount !== 1) return raced(key, command, input.reviewerId);
  return { ok: true, changed: true, record: toRecord({ ...existing, revision: revision.revision, audit: [...existing.audit, revision] }) };
}

function duplicateResult(existing: StoredDecision | null, command: Day31DecisionCommand, reviewerId: string): SaveDay31DecisionResult | null {
  const prior = existing?.audit.find((entry) => entry.requestId === command.requestId);
  if (!prior || !existing) return null;
  if (prior.decision !== command.decision || prior.reason !== command.reason || prior.expectedRevision !== command.expectedRevision || String(prior.reviewerId) !== reviewerId) return conflict();
  return { ok: true, changed: false, record: toRecord(existing) };
}

async function raced(key: ReturnType<typeof identity>, command: Day31DecisionCommand, reviewerId: string): Promise<SaveDay31DecisionResult> {
  const current = await FubSopDecision.findOne(key).lean<StoredDecision | null>();
  return duplicateResult(current, command, reviewerId) ?? conflict();
}

function conflict(): SaveDay31DecisionResult {
  return { ok: false, status: 409, reason: 'conflict' };
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
