/**
 * Mongo pool and idle-reuse settings for Vercel Fluid + Atlas.
 * Kept free of mongoose so the numbers and stale-window math stay unit-testable.
 */
export const MONGO_STALE_AFTER_MS = 15_000;
export const MONGO_PING_TIMEOUT_MS = 3_000;

export const MONGO_POOL_OPTIONS = {
  bufferCommands: false,
  // Same-region Atlas; Flex does not auto-pause, so fail over quickly on a dead topology.
  serverSelectionTimeoutMS: 10_000,
  // 2–3× a slow dashboard query; short enough that a dead socket does not freeze the UI for 45s.
  socketTimeoutMS: 20_000,
  connectTimeoutMS: 10_000,
  // Concurrent layout + page + notification poll per Fluid instance. (5+2 monitoring) × 3
  // replica members ≈ 21 sockets/instance, well under the Flex 500-connection cap.
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 10_000,
  waitQueueTimeoutMS: 5_000,
  retryWrites: true,
  retryReads: true,
} as const;

export function isCachedConnectionFresh(
  lastSuccessfulOpAt: number,
  now = Date.now(),
  staleAfterMs = MONGO_STALE_AFTER_MS
): boolean {
  return lastSuccessfulOpAt > 0 && now - lastSuccessfulOpAt < staleAfterMs;
}

/**
 * Mongoose's `openUri` only reuses the existing MongoClient while `connecting`/`connected`;
 * otherwise it builds a new one and orphans the old client, which keeps reconnecting
 * with live monitor sockets. Close whatever exists before opening a fresh client.
 * `readyState` 0 is mongoose's `disconnected`.
 */
export function shouldCloseBeforeConnect(readyState: number, hasClient: boolean): boolean {
  return hasClient || readyState !== 0;
}

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * A Promise-like that does not run `factory` until something actually awaits it.
 * Used so NextAuth's adapter does not open Mongo at module load.
 */
export function lazyThenable<T>(factory: () => Promise<T>): Promise<T> {
  return {
    then(
      onFulfilled?: ((value: T) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null
    ) {
      return factory().then(onFulfilled, onRejected);
    },
  } as Promise<T>;
}

function errorRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function safeErrorText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[redacted MongoDB URI]')
    .replace(/One common reason is that you're trying to access the database from an IP that isn't whitelisted\.[\s\S]*/i, '')
    .trim()
    .slice(0, 240);
}

/** Preserve the underlying network error without logging credentials or full driver objects. */
export function summarizeMongoConnectError(error: unknown) {
  const record = errorRecord(error);
  const topology = errorRecord(record.reason ?? record.cause);
  const servers = topology.servers instanceof Map ? [...topology.servers.values()].slice(0, 3) : [];
  return {
    name: safeErrorText(record.name) ?? 'Error',
    message: safeErrorText(record.message),
    code: typeof record.code === 'number' ? record.code : safeErrorText(record.code),
    topologyType: safeErrorText(topology.type),
    servers: servers.map((value: unknown) => {
      const server = errorRecord(value);
      const cause = errorRecord(server.error);
      return {
        type: safeErrorText(server.type),
        errorName: safeErrorText(cause.name),
        errorCode: typeof cause.code === 'number' ? cause.code : safeErrorText(cause.code),
        errorMessage: safeErrorText(cause.message),
      };
    }),
  };
}
