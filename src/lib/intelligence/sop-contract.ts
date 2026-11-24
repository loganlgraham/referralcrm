import { z } from 'zod';

const count = z.number().int().nonnegative();
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
