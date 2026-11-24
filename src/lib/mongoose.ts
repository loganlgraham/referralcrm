import mongoose from 'mongoose';
import { attachDatabasePool } from '@vercel/functions';
import {
  isCachedConnectionFresh,
  MONGO_PING_TIMEOUT_MS,
  MONGO_POOL_OPTIONS,
  raceWithTimeout,
  shouldCloseBeforeConnect,
  summarizeMongoConnectError,
} from '@/lib/mongo-connection';

const resolvedMongoUri =
  process.env.MONGODB_URI ??
  (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);

if (!resolvedMongoUri) {
  throw new Error('Missing MONGODB_URI environment variable');
}

const MONGODB_URI = resolvedMongoUri;
const ALLOW_INSECURE_TLS = process.env.MONGODB_ALLOW_INVALID_CERTS === 'true';

/**
 * Determine if TLS is required based on the connection URI
 */
function requiresTLS(uri: string): boolean {
  // mongodb+srv:// always requires TLS
  if (uri.startsWith('mongodb+srv://')) {
    return true;
  }
  // Check if URI explicitly specifies TLS
  if (uri.includes('tls=true') || uri.includes('ssl=true')) {
    return true;
  }
  // For production environments, assume TLS is required unless explicitly disabled
  if (process.env.NODE_ENV === 'production' && !uri.includes('tls=false') && !uri.includes('ssl=false')) {
    return true;
  }
  return false;
}

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

let modelsRegistered = false;

const registerModels = async () => {
  if (modelsRegistered) {
    return;
  }

  await Promise.all([
    import('@/models/activity'),
    import('@/models/admin-task'),
    import('@/models/agent'),
    import('@/models/coverage-suggestion'),
    import('@/models/email-address-health'),
    import('@/models/email-message'),
    import('@/models/lender'),
    import('@/models/notification'),
    import('@/models/payment'),
    import('@/models/pre-approval-metric'),
    import('@/models/referral'),
    import('@/models/referral-metadata'),
    import('@/models/server-document'),
    import('@/models/user'),
    import('@/models/zip')
  ]);

  modelsRegistered = true;
};

interface GlobalWithMongoose {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  lastSuccessfulOpAt: number;
  listenersAttached: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseGlobal: GlobalWithMongoose | undefined;
}

const globalWithMongoose = global as typeof global & {
  mongooseGlobal?: GlobalWithMongoose;
};

let cached = globalWithMongoose.mongooseGlobal;

if (!cached) {
  cached = globalWithMongoose.mongooseGlobal = {
    conn: null,
    promise: null,
    lastSuccessfulOpAt: 0,
    listenersAttached: false,
  };
} else {
  cached.lastSuccessfulOpAt ??= 0;
  cached.listenersAttached ??= false;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if mongoose connection is healthy
 */
function isConnectionHealthy(): boolean {
  // Treat only "connected" as healthy. "connecting" should be awaited via cached.promise.
  return cached?.conn?.connection?.readyState === mongoose.ConnectionStates.connected;
}

function invalidateCache(reason: string): void {
  if (cached?.conn || cached?.promise) {
    console.warn(`[mongo] connection ${reason}, clearing cache`);
  }
  if (!cached) {
    return;
  }
  cached.conn = null;
  // Lifecycle events must not release an in-flight recovery owned by another request.
  cached.lastSuccessfulOpAt = 0;
}

function attachLifecycleListeners(connection: mongoose.Connection): void {
  if (cached?.listenersAttached) {
    return;
  }
  if (cached) {
    cached.listenersAttached = true;
  }
  // A transient disconnect is recovered by the driver; keep the client and force a ping
  // on the next request instead of opening a second client next to the reconnecting one.
  connection.on('disconnected', () => {
    if (cached) {
      cached.lastSuccessfulOpAt = 0;
    }
  });
  connection.on('close', () => {
    if (!closingIntentionally) {
      invalidateCache('close');
    }
  });
  connection.on('error', (error: unknown) => {
    console.error('[mongo] connection error', summarizeMongoConnectError(error));
  });
}

let closingIntentionally = false;

async function closeExistingClient(): Promise<void> {
  const connection = mongoose.connection;
  const hasClient = Boolean(connection.getClient?.());
  if (!shouldCloseBeforeConnect(connection.readyState, hasClient)) {
    return;
  }
  closingIntentionally = true;
  try {
    await mongoose.disconnect();
  } catch (error) {
    console.warn(
      '[mongo] closing previous client failed',
      summarizeMongoConnectError(error)
    );
    throw error;
  } finally {
    closingIntentionally = false;
  }
}

async function pingWithTimeout(connection: mongoose.Connection): Promise<boolean> {
  const db = connection.db;
  if (!db) {
    return false;
  }
  const ping = db.admin().command({ ping: 1 }).then(
    () => true,
    () => false
  );
  try {
    return await raceWithTimeout(ping, MONGO_PING_TIMEOUT_MS, 'ping timeout');
  } catch {
    return false;
  }
}

async function resetMongooseConnection(): Promise<void> {
  invalidateCache('reset');
  // A "disconnected" client may still be retrying in the background with live sockets.
  await closeExistingClient();
}

/**
 * Wait until the connection reaches "connected".
 *
 * In serverless cold starts / concurrent route execution, `mongoose.connect()` can
 * return while the connection is still negotiating (readyState === connecting).
 * In that case, we must await the underlying connection rather than throwing.
 */
async function waitForConnected(connection: mongoose.Connection, timeoutMs: number): Promise<void> {
  if (connection.readyState === mongoose.ConnectionStates.connected) return;

  await raceWithTimeout(
    connection.asPromise(),
    timeoutMs,
    `MongoDB connection timed out, state: ${connection.readyState}`
  );
}

/**
 * Retry a connection attempt with exponential backoff
 */
async function retryConnection(
  fn: () => Promise<typeof mongoose>,
  attempt = 1,
  maxAttempts = MAX_RETRY_ATTEMPTS
): Promise<typeof mongoose> {
  try {
    return await fn();
  } catch (error) {
    if (attempt >= maxAttempts) {
      throw error;
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
    console.warn(
      `Mongoose connection attempt ${attempt} failed, retrying in ${delay}ms...`,
      summarizeMongoConnectError(error)
    );

    await sleep(delay);
    return retryConnection(fn, attempt + 1, maxAttempts);
  }
}

const SLOW_CONNECT_MS = 2_000;

export async function connectMongo(): Promise<typeof mongoose> {
  const startedAt = Date.now();
  try {
    return await connectMongoUnchecked();
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_CONNECT_MS) {
      console.warn(
        `[mongo] slow connect: ${durationMs}ms readyState=${cached?.conn?.connection?.readyState ?? 'none'}`
      );
    }
  }
}

async function connectMongoUnchecked(): Promise<typeof mongoose> {
  // Own the entire health-check/recovery sequence, not just mongoose.connect().
  // Publish the promise before any ping/disconnect can yield to another request.
  const cache = cached!;
  if (!cache.promise) {
    const operation = Promise.resolve().then(ensureMongoConnection);
    const shared = operation.finally(() => {
      if (cache.promise === shared) cache.promise = null;
    });
    cache.promise = shared;
  }
  return cache.promise;
}

async function ensureMongoConnection(): Promise<typeof mongoose> {
  const cache = cached!;
  try {
    if (cache.conn) {
      const existing = cache.conn;
      if (isConnectionHealthy() && isCachedConnectionFresh(cache.lastSuccessfulOpAt)) {
        cache.lastSuccessfulOpAt = Date.now();
        await registerModels();
        return existing;
      }

      // Allow the driver's existing client to recover a transient disconnect first.
      // Concurrent callers share this one probe rather than flooding the pool.
      const pingOk = await pingWithTimeout(existing.connection);
      if (pingOk && cache.conn === existing && isConnectionHealthy()) {
        cache.lastSuccessfulOpAt = Date.now();
        await registerModels();
        return existing;
      }
      // A probe can time out waiting behind real queries in a busy pool. Closing
      // a client the driver still considers connected would abort those queries.
      if (cache.conn === existing && isConnectionHealthy()) {
        await registerModels();
        return existing;
      }
      console.warn('[mongo] health check failed, reconnecting shared client');
      await resetMongooseConnection();
    }

    const needsTLS = requiresTLS(MONGODB_URI);
    
    const connectionOptions: Parameters<typeof mongoose.connect>[1] = {
      ...MONGO_POOL_OPTIONS,
    };
    
    // Configure TLS options for secure connections
    // Note: For mongodb+srv://, TLS is already required by the protocol and handled automatically
    // We only need to set certificate validation options if explicitly needed
    const isSRV = MONGODB_URI.startsWith('mongodb+srv://');
    if (needsTLS) {
      // Only set tls: true for non-SRV connections that need TLS
      // For mongodb+srv://, TLS is implicit and MongoDB handles it automatically
      if (!isSRV) {
        connectionOptions.tls = true;
      }
      
      // Set certificate validation options based on environment variable
      // This allows bypassing certificate validation for self-signed certificates
      // or when troubleshooting certificate issues
      if (ALLOW_INSECURE_TLS) {
        // For SRV connections, we need to explicitly set these options
        // as they're not automatically applied
        connectionOptions.tlsAllowInvalidCertificates = true;
        connectionOptions.tlsAllowInvalidHostnames = true;
        
        // Log that insecure TLS is enabled (for debugging)
        if (process.env.NODE_ENV === 'production') {
          console.warn('[MongoDB] WARNING: MONGODB_ALLOW_INVALID_CERTS is enabled. Certificate validation is disabled.');
        }
      } else {
        // Ensure secure defaults - explicitly reject invalid certificates
        // This is the default, but being explicit helps with debugging
        connectionOptions.tlsAllowInvalidCertificates = false;
        connectionOptions.tlsAllowInvalidHostnames = false;
      }
    }

    const conn = await retryConnection(async () => {
      await closeExistingClient();
      try {
        const connected = await mongoose.connect(MONGODB_URI, connectionOptions);
        await waitForConnected(connected.connection, connectionOptions.serverSelectionTimeoutMS ?? 10000);
        attachLifecycleListeners(connected.connection);
        if (process.env.VERCEL) {
          attachDatabasePool(connected.connection.getClient());
        }
        return connected;
      } catch (error) {
        await closeExistingClient();
        throw error;
      }
    });

    cache.conn = conn;
    cache.lastSuccessfulOpAt = Date.now();
    await registerModels();
    return conn;
  } catch (error) {
    // Only the owning operation clears the cache. Waiting callers never clear a
    // newer attempt after a failed shared promise settles.
    cache.conn = null;
    cache.lastSuccessfulOpAt = 0;
    console.error('[mongo] connection failed after recovery', summarizeMongoConnectError(error));
    throw error;
  }
}
