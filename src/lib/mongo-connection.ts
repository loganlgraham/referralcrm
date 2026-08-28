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
