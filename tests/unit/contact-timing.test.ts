import { recordContactTiming } from '@/lib/server/contact-timing';
import { Referral } from '@/models/referral';

jest.mock('@/models/referral', () => ({ Referral: { updateOne: jest.fn() } }));

const paired = new Date('2026-11-24T16:00:00Z');
const reported = new Date('2026-11-24T17:30:00Z');

afterEach(() => jest.clearAllMocks());
it('records an unsuccessful attempt independently of first conversation', async () => {
  await recordContactTiming('ref',paired,reported,false);
  const patch = (Referral.updateOne as jest.Mock).mock.calls[0][1][0].$set;
  expect(Object.keys(patch).sort()).toEqual(['sla.firstAgentAttemptAt','sla.timeToFirstAgentAttemptHours']);
  expect(patch['sla.timeToFirstAgentAttemptHours'].$cond.slice(1)).toEqual([1.5,'$sla.timeToFirstAgentAttemptHours']);
});
it('counts a first conversation as an attempt and preserves already recorded earlier times', async () => {
  await recordContactTiming('ref',paired,reported,true);
  const patch = (Referral.updateOne as jest.Mock).mock.calls[0][1][0].$set;
  expect(patch['sla.firstSuccessfulContactAt'].$cond[0].$or).toContainEqual({$gt:['$sla.firstSuccessfulContactAt',reported]});
  expect(patch['sla.timeToFirstAgentContactHours'].$cond.slice(1)).toEqual([1.5,'$sla.timeToFirstAgentContactHours']);
  expect(patch['sla.firstAgentAttemptAt']).toBeDefined();
});
