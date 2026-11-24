/**
 * @jest-environment node
 */

import { Types } from 'mongoose';

import {
  canPersistAutoAgentAssignment,
  isValidAutoSuggestion,
  applyIntakeAgentSuggestion,
  refreshAgentSuggestion,
} from '@/lib/server/agent-auto-suggest';
import type { AgentRecommendationResponse } from '@/lib/recommendations/agent-recommendation-response';
import type { AgentRecommendation } from '@/lib/recommendations/agent-policy';

jest.mock('@/lib/server/agent-recommendations', () => ({
  buildAgentRecommendations: jest.fn(),
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(),
    updateOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock('@/lib/server/fixture-safety', () => {
  const actual = jest.requireActual('@/lib/server/fixture-safety');
  return {
    ...actual,
    currentFixtureConnectionIdentity: jest.fn(() => ({
      host: '127.0.0.1',
      port: 41237,
      database: 'referralcrm-agent-auto-suggest-fixture',
      readyState: 1,
    })),
  };
});

import { buildAgentRecommendations } from '@/lib/server/agent-recommendations';
import { Referral } from '@/models/referral';

const buildMock = buildAgentRecommendations as jest.MockedFunction<typeof buildAgentRecommendations>;
const referralFindById = Referral.findById as jest.Mock;
const referralUpdateOne = Referral.updateOne as jest.Mock;
const referralFindOneAndUpdate = Referral.findOneAndUpdate as jest.Mock;

function top(overrides: Partial<AgentRecommendation> = {}): AgentRecommendation {
  const rate = { successes: 6, trials: 8, baseline: 0.5, adjusted: 0.6, points: 70, applicable: true };
  return {
    agentId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Leah Wells',
    rank: 1,
    score: 72,
    baseScore: 72,
    outcomeScore: 70,
    adequateHistory: true,
    evidenceStrength: 'Strong',
    coverage: 'not_listed',
    factors: {
      mc: rate,
      overall: rate,
      contract: rate,
      zip: rate,
      usedAfc: rate,
      workload: {
        active: 2,
        weightedActive: 6,
        underContract: 0,
        stageCounts: { 'New Lead': 0, Paired: 1, 'In Communication': 0, 'Active Lead': 1 },
        poolMedian: 3,
        points: 55,
        known: true,
      },
    },
    excludedOutcomes: 0,
    unknownLossReasons: 0,
    afcUnknown: 0,
    missingOutcomes: 0,
    outcomeCompleteness: 1,
    fub: { state: 'neutral', reason: 'paused' },
    reasons: ['Closed 6 of 8 finished referrals overall', 'Reached a contract on 7 of 8 referrals with known contract results'],
    ...overrides,
  };
}

function ready(overrides: Partial<AgentRecommendationResponse> = {}): AgentRecommendationResponse {
  return {
    officialScoring: false,
    preview: true,
    policyVersion: 'draft-2026-11-19c',
    state: 'ready',
    provisional: false,
    generatedAt: new Date().toISOString(),
    inputs: { mcId: null, mcName: null, zips: ['80107'], bucket: 'AHA', radiusMiles: null },
    recommendations: [top()],
    totals: {
      eligible: 1,
      inactive: 0,
      outsideRadius: 0,
      windowStart: new Date().toISOString(),
      resolvedOutcomes: 8,
      activeOutcomes: 0,
      excludedOutcomes: 0,
      unknownLossReasons: 0,
    },
    baselines: { overall: 0.5, mc: 0.5, contract: 0.7, zip: 0.5, usedAfc: 0.2 },
    workloadMedian: 3,
    fub: { state: 'paused', linkedAgents: 0, adjustedAgents: 0 },
    ...overrides,
  };
}

describe('canPersistAutoAgentAssignment', () => {
  const fixtureConnection = {
    host: '127.0.0.1',
    port: 41237,
    database: 'referralcrm-agent-auto-suggest-fixture',
    readyState: 1,
  };
  const fixtureEnv = {
    AGENT_AUTO_ASSIGN_FIXTURE_MODE: 'true',
    ALLOW_AGENT_AUTO_ASSIGN: 'true',
    FIXTURE_MONGODB_HOST: '127.0.0.1',
    FIXTURE_MONGODB_PORT: '41237',
    FIXTURE_MONGODB_DATABASE: 'referralcrm-agent-auto-suggest-fixture',
  };

  it('fails closed on hosted Vercel preview even when the allow flag is set', () => {
    expect(canPersistAutoAgentAssignment({
      ...fixtureEnv,
      VERCEL_ENV: 'preview',
    }, fixtureConnection)).toBe(false);
  });

  it('fails closed in production even when all assignment flags are set', () => {
    expect(canPersistAutoAgentAssignment({
      ...fixtureEnv,
      VERCEL_ENV: 'production',
    }, fixtureConnection)).toBe(false);
  });

  it('requires explicit fixture mode, not just ALLOW_AGENT_AUTO_ASSIGN', () => {
    expect(canPersistAutoAgentAssignment({
      ALLOW_AGENT_AUTO_ASSIGN: 'true',
      FIXTURE_MONGODB_HOST: '127.0.0.1',
      FIXTURE_MONGODB_PORT: '41237',
      FIXTURE_MONGODB_DATABASE: 'referralcrm-agent-auto-suggest-fixture',
      VERCEL_ENV: 'development',
    }, fixtureConnection)).toBe(false);
  });

  it('fails closed for local sessions connected to the shared production database', () => {
    expect(canPersistAutoAgentAssignment({
      ...fixtureEnv,
      FIXTURE_MONGODB_HOST: 'cluster.example.mongodb.net',
      FIXTURE_MONGODB_DATABASE: 'referralcrm',
      VERCEL_ENV: 'development',
    }, {
      host: 'cluster.example.mongodb.net',
      port: 27017,
      database: 'referralcrm',
      readyState: 1,
    })).toBe(false);
  });

  it('fails closed for local databases that are not clearly isolated fixtures', () => {
    expect(canPersistAutoAgentAssignment({
      ...fixtureEnv,
      FIXTURE_MONGODB_DATABASE: 'referralcrm',
      VERCEL_ENV: 'development',
    }, {
      ...fixtureConnection,
      database: 'referralcrm',
    })).toBe(false);
  });

  it('allows only explicit fixture mode on a verified isolated database', () => {
    expect(canPersistAutoAgentAssignment({
      ...fixtureEnv,
      VERCEL_ENV: 'development',
    }, fixtureConnection)).toBe(true);
    expect(canPersistAutoAgentAssignment({}, fixtureConnection)).toBe(false);
  });
});

describe('isValidAutoSuggestion', () => {
  it('requires ready, non-provisional, and adequate history', () => {
    expect(isValidAutoSuggestion(ready())?.agentId).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(isValidAutoSuggestion(ready({ provisional: true }))).toBeNull();
    expect(isValidAutoSuggestion(ready({ recommendations: [top({ adequateHistory: false })] }))).toBeNull();
    expect(isValidAutoSuggestion(ready({ state: 'no_candidates', recommendations: [] }))).toBeNull();
  });
});

describe('applyIntakeAgentSuggestion', () => {
  const originalFixture = process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE;
  const originalAllow = process.env.ALLOW_AGENT_AUTO_ASSIGN;
  const originalFixtureHost = process.env.FIXTURE_MONGODB_HOST;
  const originalFixturePort = process.env.FIXTURE_MONGODB_PORT;
  const originalFixtureDatabase = process.env.FIXTURE_MONGODB_DATABASE;
  const originalVercel = process.env.VERCEL_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE = 'true';
    process.env.ALLOW_AGENT_AUTO_ASSIGN = 'true';
    process.env.FIXTURE_MONGODB_HOST = '127.0.0.1';
    process.env.FIXTURE_MONGODB_PORT = '41237';
    process.env.FIXTURE_MONGODB_DATABASE = 'referralcrm-agent-auto-suggest-fixture';
    delete process.env.VERCEL_ENV;
    referralFindById.mockReturnValue({
      select: () => ({
        lean: async () => ({
          _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb'),
          org: 'AHA',
          ahaBucket: 'AHA',
          lookingInZip: '80107',
          lookingInZips: ['80107'],
          lender: null,
          assignedAgent: null,
          buySideAgent: null,
        }),
      }),
    });
    referralUpdateOne.mockResolvedValue({ acknowledged: true });
    referralFindOneAndUpdate.mockResolvedValue({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
    buildMock.mockResolvedValue(ready());
  });

  afterEach(() => {
    if (originalFixture === undefined) delete process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE;
    else process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE = originalFixture;
    if (originalAllow === undefined) delete process.env.ALLOW_AGENT_AUTO_ASSIGN;
    else process.env.ALLOW_AGENT_AUTO_ASSIGN = originalAllow;
    if (originalFixtureHost === undefined) delete process.env.FIXTURE_MONGODB_HOST;
    else process.env.FIXTURE_MONGODB_HOST = originalFixtureHost;
    if (originalFixturePort === undefined) delete process.env.FIXTURE_MONGODB_PORT;
    else process.env.FIXTURE_MONGODB_PORT = originalFixturePort;
    if (originalFixtureDatabase === undefined) delete process.env.FIXTURE_MONGODB_DATABASE;
    else process.env.FIXTURE_MONGODB_DATABASE = originalFixtureDatabase;
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
  });

  it('skips when the persist gate is off', async () => {
    process.env.ALLOW_AGENT_AUTO_ASSIGN = 'false';
    await expect(applyIntakeAgentSuggestion('bbbbbbbbbbbbbbbbbbbbbbbb')).resolves.toEqual({
      outcome: 'skipped',
      reason: 'hosted_preview_or_gate_off',
    });
    expect(buildMock).not.toHaveBeenCalled();
  });

  it('applies a valid recommendation without overwriting filters', async () => {
    await expect(applyIntakeAgentSuggestion('bbbbbbbbbbbbbbbbbbbbbbbb')).resolves.toEqual({
      outcome: 'applied',
      agentId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      agentName: 'Leah Wells',
    });
    expect(referralFindOneAndUpdate).toHaveBeenCalled();
    const filter = referralFindOneAndUpdate.mock.calls[0][0];
    expect(filter._id).toBeDefined();
  });

  it('records none when evidence is insufficient', async () => {
    buildMock.mockResolvedValue(ready({ provisional: true, recommendations: [top({ adequateHistory: false })] }));
    await expect(applyIntakeAgentSuggestion('bbbbbbbbbbbbbbbbbbbbbbbb')).resolves.toMatchObject({
      outcome: 'none',
    });
    expect(referralFindOneAndUpdate).not.toHaveBeenCalled();
    expect(referralUpdateOne).toHaveBeenCalled();
  });

  it('does not overwrite an existing assignment', async () => {
    referralFindById.mockReturnValue({
      select: () => ({
        lean: async () => ({
          _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb'),
          org: 'AHA',
          ahaBucket: 'AHA_OOS',
          lookingInZip: '90210',
          assignedAgent: new Types.ObjectId('cccccccccccccccccccccccc'),
          buySideAgent: new Types.ObjectId('cccccccccccccccccccccccc'),
        }),
      }),
    });
    await expect(applyIntakeAgentSuggestion('bbbbbbbbbbbbbbbbbbbbbbbb')).resolves.toEqual({
      outcome: 'skipped',
      reason: 'already_assigned',
    });
    expect(buildMock).not.toHaveBeenCalled();
  });
});

describe('refreshAgentSuggestion', () => {
  const originalFixture = process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE;
  const originalAllow = process.env.ALLOW_AGENT_AUTO_ASSIGN;
  const originalMongoUri = process.env.MONGODB_URI;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE = 'true';
    process.env.ALLOW_AGENT_AUTO_ASSIGN = 'true';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/referralcrm-agent-auto-suggest-fixture';
    delete process.env.VERCEL_ENV;
    referralUpdateOne.mockResolvedValue({ acknowledged: true });
    buildMock.mockResolvedValue(ready());
  });

  afterEach(() => {
    if (originalFixture === undefined) delete process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE;
    else process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE = originalFixture;
    if (originalAllow === undefined) delete process.env.ALLOW_AGENT_AUTO_ASSIGN;
    else process.env.ALLOW_AGENT_AUTO_ASSIGN = originalAllow;
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
  });

  it('refreshes suggestion metadata without changing a manual assignment', async () => {
    referralFindById.mockReturnValue({
      select: () => ({
        lean: async () => ({
          _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb'),
          org: 'AHA',
          ahaBucket: 'AHA',
          lookingInZip: '80107',
          assignedAgent: new Types.ObjectId('cccccccccccccccccccccccc'),
          buySideAgent: new Types.ObjectId('cccccccccccccccccccccccc'),
          agentSelectionSource: 'manual',
        }),
      }),
    });
    await expect(refreshAgentSuggestion('bbbbbbbbbbbbbbbbbbbbbbbb')).resolves.toEqual({
      outcome: 'skipped',
      reason: 'already_assigned',
    });
    expect(referralFindOneAndUpdate).not.toHaveBeenCalled();
    expect(referralUpdateOne).toHaveBeenCalled();
  });
});
