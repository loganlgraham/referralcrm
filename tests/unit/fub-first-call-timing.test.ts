/** @jest-environment node */
import { confirmedHandoff } from '@/lib/server/fub-confirmed-handoffs';
import { timingStatus, type FirstCallRow } from '@/lib/intelligence/first-call-timing';

const at = new Date('2026-11-25T15:00:00Z');
const step = { name: 'assign_agent', status: 'succeeded', completedAt: at, result: { assignedUserId: 2, previousUserId: 2 } };
const attempt = { personId: 1, fubUserId: 2, steps: [step] };
test('a pre-existing owner does not restart the clock; a creation or genuine reassignment does', () => {
  expect(confirmedHandoff(attempt)).toBeNull();
  expect(confirmedHandoff({ ...attempt, steps: [{ ...step, result: { assignedUserId: 2, previousUserId: 3 } }] })?.at).toBe(at.toISOString());
  expect(confirmedHandoff({ ...attempt, steps: [step, { name:'resolve_customer', status:'succeeded', result:{ created:true, personId:1 } }] })?.at).toBe(at.toISOString());
  expect(confirmedHandoff({ ...attempt, steps: [{ ...step, status:'failed' }] })).toBeNull();
});
const row: FirstCallRow = { personId: 1, customer: 'Test', agentId: 2, agentName: 'Agent', assignedAt: at.toISOString(), source:'observed', endedAt:null, callId:null, callAt:null, liveConnection:false };
const deadline = '2026-11-25T15:10:00Z';
test('uses the inclusive ten-minute boundary and keeps partial windows separate', () => {
  expect(timingStatus(row,'2026-11-25T15:09:59Z')).toBe('Within first 10 min');
  expect(timingStatus(row,deadline)).toBe('No call recorded within 10 min');
  expect(timingStatus({ ...row,callAt:deadline },deadline)).toBe('Called within 10 min');
  expect(timingStatus({ ...row,endedAt:'2026-11-25T15:05:00Z' },deadline)).toBe('Assignment ended before 10 min');
  expect(timingStatus({ ...row,liveConnection:true },deadline)).toBe('Live connection');
});
