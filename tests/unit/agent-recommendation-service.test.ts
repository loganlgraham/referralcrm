/** @jest-environment node */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildAgentRecommendations } from '@/lib/server/agent-recommendations';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

let mongo: MongoMemoryServer;
const now = new Date('2026-11-27T18:00:00Z');
const currentId = new Types.ObjectId();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await Promise.all([Agent.deleteMany({}), Referral.deleteMany({}), Payment.deleteMany({})]);
});

async function candidate(name: string, overrides: Record<string, unknown> = {}) {
  const _id = new Types.ObjectId();
  await Agent.collection.insertOne({ _id, name, email: `${_id}@example.com`, active: true, ahaDesignation: 'AHA_OOS', statesLicensed: ['CO'], zipCoverage: [], ...overrides });
  return _id;
}

async function closedDeal(agentId: Types.ObjectId, payment: Record<string, unknown> = {}, referral: Record<string, unknown> = {}) {
  const referralId = new Types.ObjectId();
  await Referral.collection.insertOne({
    _id: referralId, createdAt: new Date('2020-01-01T00:00:00Z'), clientType: 'Buyer', status: 'Closed',
    assignedAgent: agentId, lookingInZip: '99999', ...referral,
  });
  await Payment.collection.insertOne({ referralId, agentId, side: 'buy', status: 'paid', propertyPostalCode: '80107', ...payment });
}

function recommendations(bucket: 'AHA' | 'AHA_OOS', zips: string[] = ['80107']) {
  return buildAgentRecommendations({
    referral: { _id: currentId, org: 'AHA', ahaBucket: bucket, lookingInZips: zips },
    zipOverride: null, mcOverride: undefined, fubPermitted: false, now,
  });
}

it('uses actual closed-deal ZIPs before coverage, including old deals and legacy side attribution', async () => {
  const coverage = await candidate('Coverage', { zipCoverage: ['80107'] });
  const closed = await candidate('Closed');
  const legacy = await candidate('Legacy');
  const nearby = await candidate('Nearby closed');
  const wrongAgent = await candidate('Reassigned agent');
  await closedDeal(closed);
  await closedDeal(wrongAgent, { agentId: null, side: 'sell', status: 'closed' }, { sellSideAgent: legacy });
  await closedDeal(nearby, { propertyPostalCode: '80116', status: 'payment_sent' });
  const result = await recommendations('AHA_OOS');
  expect(result.state).toBe('ready');
  expect(result.recommendations.map((entry) => entry.agentId)).toEqual([closed, legacy, coverage, nearby].map(String));
});

it('excludes outside-agent, unfinished, terminated, deleted, and unlicensed deals', async () => {
  const allowed = await candidate('Allowed', { zipCoverage: ['80107'] });
  const outside = await candidate('Outside');
  const unused = await candidate('Unused');
  const unfinished = await candidate('Unfinished');
  const terminated = await candidate('Terminated');
  const deleted = await candidate('Deleted');
  const unlicensed = await candidate('Unlicensed', { statesLicensed: ['IL'], zipCoverage: ['80107'] });
  const searchZipOnly = await candidate('Search ZIP only');
  await closedDeal(outside, { agentAttribution: 'OUTSIDE_AGENT' });
  await closedDeal(unused, { usedAssignedAgent: false });
  await closedDeal(unfinished, { status: 'under_contract' });
  await closedDeal(terminated, { status: 'terminated' });
  await closedDeal(deleted, {}, { deletedAt: now });
  await closedDeal(unlicensed);
  await closedDeal(searchZipOnly, { propertyPostalCode: null }, { lookingInZip: '80107' });
  expect((await recommendations('AHA_OOS')).recommendations.map((entry) => entry.agentId)).toEqual([String(allowed)]);
});

it('ignores AHA ZIPs and excludes Adam, Kristen, inactive agents, and other networks', async () => {
  const allowed = await candidate('AHA Agent', { ahaDesignation: 'AHA', statesLicensed: [] });
  await candidate('Adam Pippin', { ahaDesignation: 'AHA' });
  await candidate('Kristen Truong', { ahaDesignation: 'AHA' });
  await candidate('Inactive', { ahaDesignation: 'AHA', active: false });
  await candidate('Other network', { zipCoverage: ['60601'], statesLicensed: ['IL'] });
  for (const zips of [[], ['60601'], ['80107']]) {
    const result = await recommendations('AHA', zips);
    expect(result.inputs.zips).toEqual([]);
    expect(result.recommendations.map((entry) => entry.agentId)).toEqual([String(allowed)]);
    expect(result.recommendations[0].factors.zip.applicable).toBe(false);
  }
});
