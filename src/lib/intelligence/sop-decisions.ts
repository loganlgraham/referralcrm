import { z } from 'zod';

export const day31DecisionCommandSchema = z.object({
  personId: z.number().int().positive().safe(),
  noteId: z.number().int().positive().safe(),
  decision: z.enum(['keep', 'release']),
  reason: z.string().trim().min(1).max(2000),
  expectedRevision: z.number().int().nonnegative().max(200),
  requestId: z.string().uuid(),
}).strict();

export type Day31DecisionCommand = z.infer<typeof day31DecisionCommandSchema>;
export type Day31Decision = Day31DecisionCommand['decision'];
export type Day31ReviewOrigin = {
  personId: number;
  sourceNoteId: number;
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
  noteId: number;
  sourceAt: string;
  revision: number;
  decision: Day31Decision;
  reason: string;
  reviewerId: string;
  reviewerName: string;
  decidedAt: string;
  history: Day31DecisionRevision[];
};
