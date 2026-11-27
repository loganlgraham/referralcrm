import { z } from 'zod';

const timestamp = z.string().datetime({ offset: true });
const positiveId = z.number().int().safe().positive();
const timingRow = z.object({
  personId: positiveId, customer: z.string().max(500), agentId: positiveId, agentName: z.string().max(500),
  assignedAt: timestamp, source: z.enum(['confirmed', 'observed']), endedAt: timestamp.nullable(),
  callAt: timestamp.nullable(), callId: positiveId.nullable(), liveConnection: z.boolean(),
});
export const firstCallReportSchema = z.object({ readAt: timestamp, rows: z.array(timingRow).max(2000) });
export type FirstCallReport = z.infer<typeof firstCallReportSchema>;
export type FirstCallRow = z.infer<typeof timingRow>;

export function timingStatus(row: FirstCallRow, readAt: string) {
  const deadline = Date.parse(row.assignedAt) + 600_000;
  if (row.liveConnection) return 'Live connection';
  if (row.callAt && Date.parse(row.callAt) <= deadline) return 'Called within 10 min';
  if (row.endedAt && Date.parse(row.endedAt) < deadline) return 'Assignment ended before 10 min';
  if (Date.parse(readAt) < deadline) return 'Within first 10 min';
  return 'No call recorded within 10 min';
}
