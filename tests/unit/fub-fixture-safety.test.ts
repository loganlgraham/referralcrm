import {
  isVerifiedFixtureTarget,
  type FixtureConnectionIdentity,
  type FixtureSafetyEnv,
} from '@/lib/server/fixture-safety';

const safeEnv: FixtureSafetyEnv = {
  AGENT_AUTO_ASSIGN_FIXTURE_MODE: 'true',
  ALLOW_AGENT_AUTO_ASSIGN: 'true',
  FUB_MOCK_FIXTURE_MODE: 'true',
  FUB_FIXTURE_RUN_ID: 'run-123',
  FIXTURE_MONGODB_HOST: '127.0.0.1',
  FIXTURE_MONGODB_PORT: '41237',
  FIXTURE_MONGODB_DATABASE: 'referrio-fixture-run-123',
  NODE_ENV: 'test',
};

const safeConnection: FixtureConnectionIdentity = {
  host: '127.0.0.1',
  port: 41237,
  database: 'referrio-fixture-run-123',
  readyState: 1,
};

describe('fixture database safety', () => {
  it('requires the live connection to exactly match the declared isolated target', () => {
    expect(isVerifiedFixtureTarget(safeEnv, safeConnection)).toBe(true);
    expect(
      isVerifiedFixtureTarget(safeEnv, {
        ...safeConnection,
        database: 'referrio-fixture-run-elsewhere',
      }),
    ).toBe(false);
    expect(
      isVerifiedFixtureTarget(safeEnv, {
        ...safeConnection,
        port: 41238,
      }),
    ).toBe(false);
  });

  it('does not trust a database merely because its name contains test', () => {
    expect(
      isVerifiedFixtureTarget(
        {
          ...safeEnv,
          FIXTURE_MONGODB_DATABASE: 'referralcrm-test',
        },
        {
          ...safeConnection,
          database: 'referralcrm-test',
        },
      ),
    ).toBe(false);
  });

  it('rejects hosted, production, remote, disconnected, and partially enabled targets', () => {
    expect(isVerifiedFixtureTarget({ ...safeEnv, VERCEL_ENV: 'preview' }, safeConnection)).toBe(false);
    expect(isVerifiedFixtureTarget({ ...safeEnv, NODE_ENV: 'production' }, safeConnection)).toBe(false);
    expect(
      isVerifiedFixtureTarget(
        { ...safeEnv, FIXTURE_MONGODB_HOST: 'cluster.example.com' },
        { ...safeConnection, host: 'cluster.example.com' },
      ),
    ).toBe(false);
    expect(isVerifiedFixtureTarget(safeEnv, { ...safeConnection, readyState: 0 })).toBe(false);
    expect(
      isVerifiedFixtureTarget(
        { ...safeEnv, FUB_MOCK_FIXTURE_MODE: undefined },
        safeConnection,
      ),
    ).toBe(false);
    expect(
      isVerifiedFixtureTarget(
        { ...safeEnv, FUB_FIXTURE_RUN_ID: undefined },
        safeConnection,
      ),
    ).toBe(false);
  });
});
