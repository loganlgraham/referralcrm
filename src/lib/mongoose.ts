import mongoose from 'mongoose';
import { attachDatabasePool } from '@vercel/functions';
import {
  isCachedConnectionFresh,
  MONGO_PING_TIMEOUT_MS,
  MONGO_POOL_OPTIONS,
  raceWithTimeout,
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
  cached.promise = null;
  cached.lastSuccessfulOpAt = 0;
}

function attachLifecycleListeners(connection: mongoose.Connection): void {
  if (cached?.listenersAttached) {
    return;
  }
  if (cached) {
    cached.listenersAttached = true;
  }
  connection.on('disconnected', () => invalidateCache('disconnected'));
  connection.on('close', () => invalidateCache('close'));
  connection.on('error', (error: unknown) => {
    console.error('[mongo] connection error', error instanceof Error ? error.message : String(error));
    invalidateCache('error');
  });
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
  if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) {
    return;
  }
  try {
    await mongoose.disconnect();
  } catch (error) {
    console.warn(
      '[mongo] disconnect during reset failed',
      error instanceof Error ? error.message : String(error)
    );
  }
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

  const timeout = sleep(timeoutMs).then(() => {
    throw new Error(
      `MongoDB connection timed out, state: ${connection.readyState} (expected: ${mongoose.ConnectionStates.connected})`
    );
  });

  const asPromise = (connection as any).asPromise?.bind(connection) as (() => Promise<any>) | undefined;
  if (asPromise) {
    await Promise.race([asPromise(), timeout]);
  } else {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const onConnected = () => {
          cleanup();
          resolve();
        };
        const onError = (err: unknown) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          connection.off('connected', onConnected);
          connection.off('error', onError);
        };
        connection.on('connected', onConnected);
        connection.on('error', onError);
      }),
      timeout,
    ]);
  }
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
      error instanceof Error ? error.message : String(error)
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
  if (cached?.conn && isConnectionHealthy()) {
    if (isCachedConnectionFresh(cached.lastSuccessfulOpAt)) {
      cached.lastSuccessfulOpAt = Date.now();
      await registerModels();
      return cached.conn;
    }

    const pingOk = await pingWithTimeout(cached.conn.connection);
    if (pingOk) {
      cached.lastSuccessfulOpAt = Date.now();
      await registerModels();
      return cached.conn;
    }

    console.warn('Mongoose connection failed ping, reconnecting...');
    await resetMongooseConnection();
  } else if (cached?.conn && !isConnectionHealthy()) {
    console.warn('Mongoose connection is stale, reconnecting...');
    await resetMongooseConnection();
  }

  // Create new connection with retry logic
  if (!cached?.promise) {
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

    cached!.promise = retryConnection(async () => {
      try {
        const conn = await mongoose.connect(MONGODB_URI, connectionOptions);

        // Ensure the underlying connection is actually ready.
        await waitForConnected(conn.connection, connectionOptions.serverSelectionTimeoutMS ?? 10000);

        attachLifecycleListeners(conn.connection);

        // Let Fluid Compute drain pooled connections when the instance suspends,
        // so idle connections don't accumulate against the Atlas connection cap.
        if (process.env.VERCEL) {
          attachDatabasePool(conn.connection.getClient());
        }

        if (cached) {
          cached.lastSuccessfulOpAt = Date.now();
        }

        return conn;
      } catch (error) {
        // Clear the cached promise on failure so we can retry
        cached!.promise = null;
        cached!.conn = null;
        cached!.lastSuccessfulOpAt = 0;
        
        // Enhance error messages for SSL/TLS issues
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isSSLError = errorMessage.includes('SSL') || 
                          errorMessage.includes('TLS') || 
                          errorMessage.includes('tlsv1') ||
                          errorMessage.includes('certificate') ||
                          errorMessage.includes('alert number');
        
        if (isSSLError) {
          const enhancedError = new Error(
            `MongoDB SSL/TLS connection error: ${errorMessage}. ` +
            (ALLOW_INSECURE_TLS 
              ? 'Invalid certificates are allowed but connection still failed. This may indicate a server-side issue or network problem.' 
              : 'This error typically indicates certificate validation failure. ' +
                'If using self-signed certificates or troubleshooting, set MONGODB_ALLOW_INVALID_CERTS=true. ' +
                'Otherwise, check your MongoDB server certificate status and network connectivity.')
          );
          enhancedError.cause = error;
          console.error('MongoDB SSL/TLS connection error:', {
            message: errorMessage,
            allowInsecureTLS: ALLOW_INSECURE_TLS,
            connectionString: MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'), // Mask credentials
            isSRV: MONGODB_URI.startsWith('mongodb+srv://'),
            originalError: error,
          });
          throw enhancedError;
        }
        
        console.error('MongoDB connection error:', error);
        throw error;
      }
    }).catch((error) => {
      // Clear cache on final failure after all retries
      cached!.promise = null;
      cached!.conn = null;
      cached!.lastSuccessfulOpAt = 0;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSSLError = errorMessage.includes('SSL') || 
                        errorMessage.includes('TLS') || 
                        errorMessage.includes('tlsv1') ||
                        errorMessage.includes('certificate') ||
                        errorMessage.includes('alert number');
      
      if (isSSLError) {
        console.error('MongoDB SSL/TLS connection failed after retries:', {
          message: errorMessage,
          allowInsecureTLS: ALLOW_INSECURE_TLS,
          connectionString: MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'), // Mask credentials
          isSRV: MONGODB_URI.startsWith('mongodb+srv://'),
          suggestion: ALLOW_INSECURE_TLS 
            ? 'Connection failed even with certificate validation disabled. Check MongoDB server status and network connectivity.'
            : 'Consider setting MONGODB_ALLOW_INVALID_CERTS=true as a temporary workaround, then investigate certificate issues.',
          originalError: error,
        });
      } else {
        console.error('MongoDB connection failed after retries:', error);
      }
      throw error;
    });
  }

  try {
    cached!.conn = await cached!.promise;
    cached!.lastSuccessfulOpAt = Date.now();
    await registerModels();
    return cached!.conn;
  } catch (error) {
    // Clear cache on error to allow retry
    cached!.promise = null;
    cached!.conn = null;
    cached!.lastSuccessfulOpAt = 0;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isSSLError = errorMessage.includes('SSL') || 
                      errorMessage.includes('TLS') || 
                      errorMessage.includes('tlsv1') ||
                      errorMessage.includes('certificate') ||
                      errorMessage.includes('alert number');
    
    if (isSSLError) {
      console.error('MongoDB SSL/TLS connection failed:', {
        message: errorMessage,
        allowInsecureTLS: ALLOW_INSECURE_TLS,
        connectionString: MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'), // Mask credentials
        isSRV: MONGODB_URI.startsWith('mongodb+srv://'),
        suggestion: ALLOW_INSECURE_TLS 
          ? 'Connection failed even with certificate validation disabled. Check MongoDB server status.'
          : 'Set MONGODB_ALLOW_INVALID_CERTS=true if using self-signed certificates.',
        originalError: error,
      });
    } else {
      console.error('MongoDB connection failed:', error);
    }
    throw error;
  }
}
