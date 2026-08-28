/** @jest-environment node */

import {
  isCachedConnectionFresh,
  lazyThenable,
  MONGO_PING_TIMEOUT_MS,
  MONGO_POOL_OPTIONS,
  MONGO_STALE_AFTER_MS,
  raceWithTimeout,
} from '@/lib/mongo-connection';

describe('mongo connection helpers', () => {
  it('treats a never-used cache as stale', () => {
    expect(isCachedConnectionFresh(0, 1_000_000)).toBe(false);
  });

  it('treats a recent success as fresh and an idle gap as stale', () => {
    const last = 100_000;
    expect(isCachedConnectionFresh(last, last + MONGO_STALE_AFTER_MS - 1)).toBe(true);
    expect(isCachedConnectionFresh(last, last + MONGO_STALE_AFTER_MS)).toBe(false);
  });

  it('uses a serverless pool that can serve concurrent Fluid requests without waiting forever', () => {
    expect(MONGO_POOL_OPTIONS.maxPoolSize).toBe(5);
    expect(MONGO_POOL_OPTIONS.minPoolSize).toBe(0);
    expect(MONGO_POOL_OPTIONS.maxIdleTimeMS).toBe(10_000);
    expect(MONGO_POOL_OPTIONS.waitQueueTimeoutMS).toBe(5_000);
    expect(MONGO_POOL_OPTIONS.socketTimeoutMS).toBe(20_000);
    expect(MONGO_POOL_OPTIONS.serverSelectionTimeoutMS).toBe(10_000);
    expect(MONGO_POOL_OPTIONS.connectTimeoutMS).toBe(10_000);
    expect(MONGO_PING_TIMEOUT_MS).toBeLessThan(MONGO_POOL_OPTIONS.socketTimeoutMS);
  });

  it('resolves when the work finishes before the timeout', async () => {
    await expect(raceWithTimeout(Promise.resolve('ok'), 50, 'timed out')).resolves.toBe('ok');
  });

  it('rejects when the work exceeds the timeout', async () => {
    const never = new Promise<string>(() => undefined);
    await expect(raceWithTimeout(never, 20, 'timed out')).rejects.toThrow('timed out');
  });

  it('does not run a lazy thenable until it is awaited', async () => {
    let ran = 0;
    const deferred = lazyThenable(async () => {
      ran += 1;
      return 42;
    });
    expect(ran).toBe(0);
    await expect(deferred).resolves.toBe(42);
    expect(ran).toBe(1);
  });
});
