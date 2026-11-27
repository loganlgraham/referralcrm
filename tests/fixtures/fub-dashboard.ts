import type { SopDashboard } from '@/lib/intelligence/sop-contract';

export const fubDashboardFixture: SopDashboard = {
  state: 'ready', officialScoring: false, readAt: '2026-11-24T21:00:00.000Z', days: 30, customers: 240, knownTasks: 12, unknownTasks: 3,
  coverage: [{ resource: 'calls', lastSuccessAt: '2026-11-24T20:45:00.000Z', failed: false }, { resource: 'tasks', lastSuccessAt: '2026-11-24T20:50:00.000Z', failed: false }],
  metrics: [
    { id: 'first-call', label: 'First call within 10 minutes', count: null, evidence: 'calls', detail: 'Verified handoff times and complete call coverage are needed. Recorded calls are available to review.' },
    { id: 'day-3', label: 'Day 3 follow-up · 2 calls', count: null, evidence: 'calls', detail: 'The Playbook start has not been confirmed.' },
    { id: 'day-7', label: 'Day 7 follow-up · 4 calls', count: null, evidence: 'calls', detail: 'The Playbook start and complete call coverage are needed.' },
    { id: 'tasks', label: 'Overdue tasks', count: 1, evidence: 'tasks', detail: '12 tasks have usable status and due-date evidence; 3 need more detail.' },
    { id: 'day-31', label: 'Day 31 · Keep or release', count: null, evidence: 'none', detail: 'The review task and Keep/Release decision field have not been confirmed.' },
  ],
  agents: [{ id: 9, name: 'Jordan Avery', role: 'Agent', customers: 240, calls: 27, overdueTasks: 1 }],
  evidence: {
    calls: Array.from({ length: 27 }, (_, i) => ({ id: i + 1, personId: i + 100, customer: `Example client ${i + 1}`, agentId: 9, at: '2026-11-23T18:00:00.000Z', dateOnly: false, detail: 'Outgoing call recorded; outcome not recorded.' })),
    tasks: [{ id: 80, personId: 100, customer: 'Example client 1', agentId: 9, at: '2026-11-23', dateOnly: true, detail: 'Follow Up is open and past its due date.' }],
  },
};
