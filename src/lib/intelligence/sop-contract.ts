import type { FirstCallReport } from '@/lib/intelligence/first-call-timing';
import { z } from 'zod';
import { day31ReviewIdSchema, type Day31DecisionRecord } from '@/lib/intelligence/sop-decisions';

const count = z.number().int().nonnegative();
export const sopAuditSchema = z.object({
  id: day31ReviewIdSchema,
  kind: z.enum(['day-3', 'day-7', 'day-31']),
  personId: z.number().int().safe().positive(),
  customer: z.string().max(500),
  agentId: z.number().int().safe().positive().nullable(),
  at: z.string().datetime({ offset: true }),
  sourceNoteId: z.number().int().safe().positive().nullable(),
  provenance: z.enum(['automation', 'template_match', 'tag_observation']).optional(),
}).refine((row) => row.id.startsWith('tag:')
  ? row.kind === 'day-31' && row.sourceNoteId === null && row.provenance === 'tag_observation'
  : row.id === `note:${row.sourceNoteId}` && row.provenance !== 'tag_observation', 'Review identity does not match');
export type SopAudit = z.infer<typeof sopAuditSchema>;
export type SopAuditKind = SopAudit['kind'];
const evidence = z.object({
  id: count,
  personId: z.number().int().positive(),
  customer: z.string().max(500),
  agentId: count.nullable(),
  at: z.string().max(100),
  dateOnly: z.boolean(),
  detail: z.string().max(1000),
});
export const sopDashboardSchema = z.object({
  state: z.literal('ready'),
  officialScoring: z.literal(false),
  readAt: z.string().datetime({ offset: true }),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  customers: count,
  knownTasks: count,
  unknownTasks: count,
  sopAudits: z.array(sopAuditSchema).max(2000).optional(),
  sopMetrics: z.array(z.object({
    id: z.enum(['day-3', 'day-7', 'day-31']),
    label: z.string().max(200),
    count: count.nullable(),
    detail: z.string().max(2000),
  })).max(3).optional(),
  sopCoverage: z.object({
    state: z.enum(['pending', 'partial', 'current', 'failed', 'stale']),
    lastSuccessAt: z.string().nullable(),
    detail: z.string().max(2000),
  }).optional(),
  metrics: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        count: count.nullable(),
        evidence: z.enum(['calls', 'tasks', 'none']),
        detail: z.string(),
      }),
    )
    .max(10),
  agents: z
    .array(
      z.object({
        id: count,
        name: z.string(),
        role: z.string().nullable(),
        customers: count,
        calls: count,
        overdueTasks: count,
      }),
    )
    .max(1000),
  evidence: z.object({
    calls: z.array(evidence).max(2000),
    tasks: z.array(evidence).max(2000),
  }),
  coverage: z
    .array(
      z.object({
        resource: z.string(),
        lastSuccessAt: z.string().nullable(),
        failed: z.boolean(),
      }),
    )
    .max(10),
});
export type SopDashboard = z.infer<typeof sopDashboardSchema>;
export type FubDashboardData = SopDashboard & {
  day31Decisions?: Day31DecisionRecord[];
  decisionError?: string;
  firstCallReport?: FirstCallReport | null;
};
