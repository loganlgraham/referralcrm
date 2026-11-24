/** @jest-environment node */

import mongoose from 'mongoose';
import { connectMongo } from '@/lib/mongoose';

jest.mock('@vercel/functions', () => ({ attachDatabasePool: jest.fn() }));
jest.mock('mongoose', () => {
  const connection = {
    readyState: 0,
    db: { admin: jest.fn() },
    getClient: jest.fn(),
    asPromise: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  };
  return { __esModule: true, default: {
    connection,
    ConnectionStates: { disconnected: 0, connected: 1, connecting: 2 },
    connect: jest.fn(),
    disconnect: jest.fn(),
  } };
});

jest.mock('@/models/activity', () => ({}));
jest.mock('@/models/admin-task', () => ({}));
jest.mock('@/models/agent', () => ({}));
jest.mock('@/models/coverage-suggestion', () => ({}));
jest.mock('@/models/email-address-health', () => ({}));
jest.mock('@/models/email-message', () => ({}));
jest.mock('@/models/lender', () => ({}));
jest.mock('@/models/notification', () => ({}));
jest.mock('@/models/payment', () => ({}));
jest.mock('@/models/pre-approval-metric', () => ({}));
jest.mock('@/models/referral', () => ({}));
jest.mock('@/models/referral-metadata', () => ({}));
jest.mock('@/models/server-document', () => ({}));
jest.mock('@/models/user', () => ({}));
jest.mock('@/models/zip', () => ({}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const connect = jest.mocked(mongoose.connect);
const disconnect = jest.mocked(mongoose.disconnect);
const command = jest.fn();
const listeners = new Map<string, (...args: unknown[]) => void>();
const cache = global.mongooseGlobal!;

async function settle() {
  await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.clear();
  cache.conn = null;
  cache.promise = null;
  cache.lastSuccessfulOpAt = 0;
  cache.listenersAttached = false;
  mongoose.connection.readyState = 0;
  jest.mocked(mongoose.connection.on).mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    listeners.set(event, listener);
    return mongoose.connection;
  }) as typeof mongoose.connection.on);
  jest.mocked(mongoose.connection.getClient).mockReturnValue(undefined as never);
  jest.mocked(mongoose.connection.db!.admin).mockReturnValue({ command } as never);
  command.mockReset().mockResolvedValue({ ok: 1 });
  connect.mockReset().mockImplementation(async () => {
    mongoose.connection.readyState = 1;
    return mongoose;
  });
  disconnect.mockReset().mockImplementation(async () => {
    mongoose.connection.readyState = 0;
    listeners.get('close')?.();
  });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('shares one cold connection across simultaneous callers and later reuses it', async () => {
  const pending = deferred<typeof mongoose>();
  connect.mockReturnValueOnce(pending.promise);
  const calls = Array.from({ length: 20 }, () => connectMongo());
  await settle();
  expect(connect).toHaveBeenCalledTimes(1);
  mongoose.connection.readyState = 1;
  pending.resolve(mongoose);
  expect(await Promise.all(calls)).toEqual(Array(20).fill(mongoose));
  expect(cache.promise).toBeNull();
  await connectMongo();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
});

it('shares a stale probe and reconnect without letting other requests close the new client', async () => {
  await connectMongo();
  cache.lastSuccessfulOpAt = Date.now() - 60_000;
  const ping = deferred<{ ok: number }>();
  const closing = deferred<void>();
  command.mockReturnValueOnce(ping.promise);
  jest.mocked(mongoose.connection.getClient).mockReturnValue({} as never);
  disconnect.mockImplementationOnce(() => closing.promise);
  const calls = Array.from({ length: 20 }, () => connectMongo());
  await settle();
  expect(command).toHaveBeenCalledTimes(1);
  mongoose.connection.readyState = 0;
  ping.reject(new Error('stale socket'));
  await settle();
  expect(disconnect).toHaveBeenCalledTimes(1);
  calls.push(connectMongo());
  await settle();
  expect(connect).toHaveBeenCalledTimes(1);
  mongoose.connection.readyState = 0;
  jest.mocked(mongoose.connection.getClient).mockReturnValue(undefined as never);
  closing.resolve();
  expect(await Promise.all(calls)).toEqual(Array(21).fill(mongoose));
  expect(connect).toHaveBeenCalledTimes(2);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('lets the existing driver recover a transient disconnect without replacing its pool', async () => {
  await connectMongo();
  mongoose.connection.readyState = 0;
  listeners.get('disconnected')?.();
  command.mockImplementationOnce(async () => {
    mongoose.connection.readyState = 1;
    return { ok: 1 };
  });
  await Promise.all(Array.from({ length: 10 }, () => connectMongo()));
  expect(command).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
});

it('keeps recovery owned when a close event arrives during retry backoff', async () => {
  await connectMongo();
  cache.lastSuccessfulOpAt = 0;
  command.mockImplementationOnce(async () => { mongoose.connection.readyState = 0; throw new Error('socket lost'); });
  connect.mockRejectedValueOnce(new Error('temporary network failure'));
  const first = connectMongo();
  await settle();
  listeners.get('close')?.();
  const second = connectMongo();
  await settle();
  expect(connect).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1000);
  await expect(first).resolves.toBe(mongoose);
  await expect(second).resolves.toBe(mongoose);
  expect(connect).toHaveBeenCalledTimes(3);
});

it('rejects all waiters after bounded retries and allows a later request to recover', async () => {
  connect.mockRejectedValue(new Error('network unavailable'));
  const results = Promise.allSettled(Array.from({ length: 20 }, () => connectMongo()));
  await jest.advanceTimersByTimeAsync(3000);
  expect((await results).every(result => result.status === 'rejected')).toBe(true);
  expect(connect).toHaveBeenCalledTimes(3);
  expect(cache.promise).toBeNull();
  connect.mockImplementation(async () => { mongoose.connection.readyState = 1; return mongoose; });
  await expect(connectMongo()).resolves.toBe(mongoose);
  expect(connect).toHaveBeenCalledTimes(4);
});

it('shares a timed-out probe and recovers even if that old ping settles later', async () => {
  await connectMongo();
  cache.lastSuccessfulOpAt = 0;
  const ping = deferred<{ ok: number }>();
  command.mockReturnValueOnce(ping.promise);
  const result = Promise.all(Array.from({ length: 10 }, () => connectMongo()));
  await settle();
  mongoose.connection.readyState = 0;
  await jest.advanceTimersByTimeAsync(3000);
  await result;
  ping.reject(new Error('late socket failure'));
  await settle();
  expect(connect).toHaveBeenCalledTimes(2);
  expect(cache.conn).toBe(mongoose);
  expect(cache.promise).toBeNull();
});

it('does not open another client when closing the previous pool fails', async () => {
  await connectMongo();
  cache.lastSuccessfulOpAt = 0;
  jest.mocked(mongoose.connection.getClient).mockReturnValue({} as never);
  command.mockImplementationOnce(async () => { mongoose.connection.readyState = 0; throw new Error('stale socket'); });
  disconnect.mockRejectedValueOnce(new Error('close failed'));
  await expect(connectMongo()).rejects.toThrow('close failed');
  expect(connect).toHaveBeenCalledTimes(1);
  expect(cache.promise).toBeNull();
});

it('waits for connecting state to settle and clears the readiness timer', async () => {
  const ready = deferred<typeof mongoose.connection>();
  connect.mockImplementationOnce(async () => {
    mongoose.connection.readyState = 2;
    return mongoose;
  });
  jest.mocked(mongoose.connection.asPromise).mockReturnValueOnce(ready.promise);
  const calls = Promise.all([connectMongo(), connectMongo()]);
  await settle();
  expect(connect).toHaveBeenCalledTimes(1);
  mongoose.connection.readyState = 1;
  ready.resolve(mongoose.connection);
  await calls;
  expect(jest.getTimerCount()).toBe(0);
});

it('does not return an invalidated connection when a close event races with a successful probe', async () => {
  await connectMongo();
  cache.lastSuccessfulOpAt = 0;
  const ping = deferred<{ ok: number }>();
  command.mockReturnValueOnce(ping.promise);
  const result = connectMongo();
  await settle();
  mongoose.connection.readyState = 0;
  listeners.get('close')?.();
  ping.resolve({ ok: 1 });
  await expect(result).resolves.toBe(mongoose);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(cache.conn).toBe(mongoose);
});


it('does not destroy a connected pool when its probe waits behind busy queries', async () => {
  await connectMongo();
  cache.lastSuccessfulOpAt = 0;
  const ping = deferred<{ ok: number }>();
  command.mockReturnValueOnce(ping.promise);
  const calls = Promise.all(Array.from({ length: 20 }, () => connectMongo()));
  await jest.advanceTimersByTimeAsync(3000);
  expect(await calls).toEqual(Array(20).fill(mongoose));
  expect(disconnect).not.toHaveBeenCalled();
  expect(connect).toHaveBeenCalledTimes(1);
  ping.resolve({ ok: 1 });
});
