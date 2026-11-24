import mongoose from 'mongoose';

export type FixtureSafetyEnv = {
  AGENT_AUTO_ASSIGN_FIXTURE_MODE?: string | undefined;
  ALLOW_AGENT_AUTO_ASSIGN?: string | undefined;
  FUB_MOCK_FIXTURE_MODE?: string | undefined;
  FUB_FIXTURE_RUN_ID?: string | undefined;
  FIXTURE_MONGODB_HOST?: string | undefined;
  FIXTURE_MONGODB_PORT?: string | undefined;
  FIXTURE_MONGODB_DATABASE?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
};

export type FixtureConnectionIdentity = {
  host: string | null | undefined;
  port: number | null | undefined;
  database: string | null | undefined;
  readyState: number;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const FIXTURE_DATABASE_PATTERN = /^[a-z0-9][a-z0-9-]*fixture[a-z0-9-]*$/u;

function hasBaseFixtureFlags(env: FixtureSafetyEnv): boolean {
  return (
    env.AGENT_AUTO_ASSIGN_FIXTURE_MODE === 'true' &&
    env.ALLOW_AGENT_AUTO_ASSIGN === 'true' &&
    env.NODE_ENV !== 'production' &&
    env.VERCEL_ENV !== 'preview' &&
    env.VERCEL_ENV !== 'production'
  );
}

function matchesLiveFixtureTarget(
  env: FixtureSafetyEnv,
  connection: FixtureConnectionIdentity,
): boolean {
  const expectedHost = env.FIXTURE_MONGODB_HOST?.trim().toLowerCase();
  const expectedPort = Number(env.FIXTURE_MONGODB_PORT);
  const expectedDatabase = env.FIXTURE_MONGODB_DATABASE?.trim().toLowerCase();
  const liveHost = connection.host?.trim().toLowerCase();
  const livePort = connection.port;
  const liveDatabase = connection.database?.trim().toLowerCase();

  if (connection.readyState !== 1) return false;
  if (
    !expectedHost ||
    !Number.isSafeInteger(expectedPort) ||
    expectedPort <= 0 ||
    !expectedDatabase ||
    !liveHost ||
    !Number.isSafeInteger(livePort) ||
    !livePort ||
    !liveDatabase
  ) {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(expectedHost) || !LOOPBACK_HOSTS.has(liveHost)) return false;
  if (!FIXTURE_DATABASE_PATTERN.test(expectedDatabase)) return false;
  return (
    liveHost === expectedHost &&
    livePort === expectedPort &&
    liveDatabase === expectedDatabase
  );
}

export function isVerifiedFixtureTarget(
  env: FixtureSafetyEnv,
  connection: FixtureConnectionIdentity,
): boolean {
  return (
    hasBaseFixtureFlags(env) &&
    env.FUB_MOCK_FIXTURE_MODE === 'true' &&
    /^[a-z0-9][a-z0-9-]{2,80}$/u.test(env.FUB_FIXTURE_RUN_ID ?? '') &&
    matchesLiveFixtureTarget(env, connection)
  );
}

export function isVerifiedAutoSuggestTarget(
  env: FixtureSafetyEnv,
  connection: FixtureConnectionIdentity,
): boolean {
  return hasBaseFixtureFlags(env) && matchesLiveFixtureTarget(env, connection);
}

export function currentFixtureConnectionIdentity(): FixtureConnectionIdentity {
  return {
    host: mongoose.connection.host,
    port: mongoose.connection.port,
    database: mongoose.connection.name,
    readyState: mongoose.connection.readyState,
  };
}

export function canUseMockFubFixture(
  env: FixtureSafetyEnv = process.env as FixtureSafetyEnv,
): boolean {
  return isVerifiedFixtureTarget(env, currentFixtureConnectionIdentity());
}
