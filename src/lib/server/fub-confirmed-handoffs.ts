import { FubSendAttempt } from '@/models/mock-fub';

type Step = { name: string; status: string; startedAt?: Date; completedAt?: Date; result?: Record<string, unknown> };
type Attempt = { personId: number; fubUserId: number; steps: Step[] };
export type ConfirmedHandoff = { personId: number; agentId: number; at: string; beganAt: string };

export function confirmedHandoff(row: Attempt): ConfirmedHandoff | null {
  const assignment = row.steps.find(step => step.name === 'assign_agent' && step.status === 'succeeded');
  const result = assignment?.result;
  if (!assignment?.completedAt || !result || result.assignedUserId !== row.fubUserId ||
      !Number.isSafeInteger(row.personId) || row.personId <= 0 || !Number.isSafeInteger(row.fubUserId) || row.fubUserId <= 0) return null;
  const creation = row.steps.find(step => step.name === 'resolve_customer' && step.status === 'succeeded' &&
    step.result?.created === true && step.result.personId === row.personId);
  if (!creation && (result.previousUserId === undefined || result.previousUserId === row.fubUserId)) return null;
  const began = creation?.startedAt ?? assignment.startedAt ?? assignment.completedAt;
  return { personId: row.personId, agentId: row.fubUserId, at: assignment.completedAt.toISOString(), beganAt: began.toISOString() };
}

export async function readConfirmedHandoffs(days: number, readAt: string): Promise<ConfirmedHandoff[]> {
  const end = new Date(readAt);
  const start = new Date(end.getTime() - days * 86_400_000);
  const attempts = await FubSendAttempt.find({
    fixtureRunId: 'aha-production',
    steps: { $elemMatch: { name: 'assign_agent', status: 'succeeded', completedAt: { $gte: start, $lte: end } } },
  }).select('personId fubUserId steps.name steps.status steps.result.created steps.result.personId steps.result.assignedUserId steps.result.previousUserId steps.startedAt steps.completedAt')
    .limit(2001).lean<Attempt[]>();
  if (attempts.length > 2000) throw new Error('Assignment window exceeds the report limit.');
  return attempts.flatMap(attempt => {
    const handoff = confirmedHandoff(attempt);
    return handoff ? [handoff] : [];
  });
}
