import type { FubDashboardData, SopAudit } from '@/lib/intelligence/sop-contract';
import type { Day31DecisionRecord } from '@/lib/intelligence/sop-decisions';
import { fubDashboardFixture } from './fub-dashboard';

export const sopReviews: SopAudit[] = [
  { id: 'note:301', kind: 'day-3', personId: 1001, customer: 'Day 3 Jordan client', agentId: 9, at: '2026-11-23T18:00:00.000Z', sourceNoteId: 301 },
  { id: 'note:302', kind: 'day-3', personId: 1002, customer: 'Day 3 Casey client', agentId: 10, at: '2026-11-23T18:00:00.000Z', sourceNoteId: 302 },
  { id: 'note:303', kind: 'day-3', personId: 1003, customer: 'Day 3 unassigned client', agentId: null, at: '2026-11-23T18:00:00.000Z', sourceNoteId: 303 },
  { id: 'note:304', kind: 'day-3', personId: 1004, customer: 'Day 3 unknown owner client', agentId: 88, at: '2026-11-23T18:00:00.000Z', sourceNoteId: 304 },
  { id: 'note:701', kind: 'day-7', personId: 2001, customer: 'Day 7 Jordan client', agentId: 9, at: '2026-11-22T18:00:00.000Z', sourceNoteId: 701 },
  { id: 'note:901', kind: 'day-31', personId: 3001, customer: 'Pending review client', agentId: 9, at: '2026-10-01T18:00:00.000Z', sourceNoteId: 901 },
  { id: 'note:902', kind: 'day-31', personId: 3002, customer: 'Keep review client', agentId: 9, at: '2026-10-01T18:00:00.000Z', sourceNoteId: 902 },
  { id: 'note:903', kind: 'day-31', personId: 3003, customer: 'Release review client', agentId: 10, at: '2026-10-01T18:00:00.000Z', sourceNoteId: 903 },
];

export function decisionRecord(review: SopAudit, decision: 'keep' | 'release' = 'keep'): Day31DecisionRecord {
  const latest = {
    revision: 1, requestId: 'df3ce185-823e-4da4-8239-508ea114b0c3', decision,
    reason: decision === 'keep' ? 'Client confirmed a January move.' : 'Release approved after explicit review.',
    reviewerId: '507f1f77bcf86cd799439011', reviewerName: 'Stored Reviewer', decidedAt: '2026-11-24T20:00:00.000Z',
  };
  return { personId: review.personId, noteId: review.sourceNoteId, sourceAt: review.at, ...latest, history: [latest] };
}

export const fubSopFixture: FubDashboardData = {
  ...fubDashboardFixture,
  agents: [
    ...fubDashboardFixture.agents,
    { id: 10, name: 'Casey Parker', role: 'Agent', customers: 2, calls: 0, overdueTasks: 0 },
    { id: 0, name: 'Unattributed activity', role: null, customers: 0, calls: 0, overdueTasks: 0 },
  ],
  sopAudits: sopReviews,
  sopMetrics: [
    { id: 'day-3', label: 'Day 3 follow-up · 2 calls', count: 4, detail: 'Recorded Day 3 reminders; missing reminders do not prove compliance.' },
    { id: 'day-7', label: 'Day 7 follow-up · 4 calls', count: 1, detail: 'Recorded Day 7 reminders; missing reminders do not prove compliance.' },
    { id: 'day-31', label: 'Day 31 · Keep or release', count: 3, detail: 'Each recorded review needs an explicit decision.' },
  ],
  sopCoverage: { state: 'current', lastSuccessAt: '2026-11-24T20:50:00.000Z', detail: 'Recognized reminder notes were collected.' },
  day31Decisions: [decisionRecord(sopReviews[6]), decisionRecord(sopReviews[7], 'release')],
};
