import { z } from 'zod';

const uuidSchema = z.string().uuid();
export const day31ReviewIdSchema = z.string().max(64).refine((value) => {
  if (/^note:[1-9]\d*$/.test(value)) return Number.isSafeInteger(Number(value.slice(5)));
  if (!value.startsWith('tag:')) return false;
  const uuid = value.slice(4);
  return uuid === uuid.toLowerCase() && uuidSchema.safeParse(uuid).success;
}, 'Choose a valid source review.');

export const day31DecisionCommandSchema = z.object({
  personId: z.number().int().positive().safe(),
  reviewId: day31ReviewIdSchema,
  decision: z.enum(['keep', 'release']),
  reason: z.string().trim().min(1).max(2000),
  expectedRevision: z.number().int().nonnegative().max(200),
  requestId: z.string().uuid(),
}).strict();

export type Day31DecisionCommand = z.infer<typeof day31DecisionCommandSchema>;
export type Day31Decision = Day31DecisionCommand['decision'];
export type Day31ReviewOrigin = {
  id: string;
  personId: number;
  at: string;
};
export type Day31DecisionRevision = {
  revision: number;
  requestId: string;
  decision: Day31Decision;
  reason: string;
  reviewerId: string;
  reviewerName: string;
  decidedAt: string;
};
export type Day31DecisionRecord = {
  personId: number;
  reviewId: string;
  sourceAt: string;
  revision: number;
  decision: Day31Decision;
  reason: string;
  reviewerId: string;
  reviewerName: string;
  decidedAt: string;
  history: Day31DecisionRevision[];
};
