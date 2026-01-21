import { MongoClient } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

interface GlobalWithMongoClient {
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongoClientGlobal: GlobalWithMongoClient | undefined;
}

const globalWithMongoClient = global as typeof global & {
  mongoClientGlobal?: GlobalWithMongoClient;
};

let cached = globalWithMongoClient.mongoClientGlobal;

if (!cached) {
  cached = globalWithMongoClient.mongoClientGlobal = { client: null, promise: null };
}

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a connection attempt with exponential backoff
 */
async function retryConnection<T>(
  fn: () => Promise<T>,
  attempt = 1,
  maxAttempts = MAX_RETRY_ATTEMPTS
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempt >= maxAttempts) {
      throw error;
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
    console.warn(
      `MongoDB connection attempt ${attempt} failed, retrying in ${delay}ms...`,
      error instanceof Error ? error.message : String(error)
    );

    await sleep(delay);
    return retryConnection(fn, attempt + 1, maxAttempts);
  }
}

/**
 * Check if a MongoDB client is connected and healthy
 */
async function isClientConnected(client: MongoClient): Promise<boolean> {
  try {
    // Use admin ping as a lightweight health check
    await client.db().admin().ping();
    return true;
  } catch {
    return false;
  }
}

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

export function getMongoClient(): MongoClient {
  const uri =
    process.env.MONGODB_URI ??
    (process.env.NODE_ENV === 'development'
      ? 'mongodb://localhost:27017/referralcrm'
      : undefined);
  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }
  if (!cached!.client) {
    const ALLOW_INSECURE_TLS = process.env.MONGODB_ALLOW_INVALID_CERTS === 'true';
    const needsTLS = requiresTLS(uri);
    
    const options: {
      serverSelectionTimeoutMS: number;
      socketTimeoutMS: number;
      connectTimeoutMS: number;
      maxPoolSize: number;
      minPoolSize: number;
      maxIdleTimeMS: number;
      retryWrites: boolean;
      retryReads: boolean;
      heartbeatFrequencyMS: number;
      directConnection: boolean;
      tls?: boolean;
      tlsAllowInvalidCertificates?: boolean;
      tlsAllowInvalidHostnames?: boolean;
    } = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true,
      heartbeatFrequencyMS: 10000,
      // Add direct connection option for better serverless handling
      directConnection: false, // Keep false for replica sets
    };

    // Add TLS configuration for secure connections
    // Note: For mongodb+srv://, TLS is already required by the protocol and handled automatically
    // We only need to set certificate validation options if explicitly needed
    const isSRV = uri.startsWith('mongodb+srv://');
    if (needsTLS) {
      // Only set tls: true for non-SRV connections that need TLS
      // For mongodb+srv://, TLS is implicit and MongoDB handles it automatically
      if (!isSRV) {
        options.tls = true;
      }
      // Set certificate validation options only if explicitly needed
      // For mongodb+srv://, only set these if ALLOW_INSECURE_TLS is true
      // Otherwise, let MongoDB handle TLS with default secure settings
      if (ALLOW_INSECURE_TLS) {
        options.tlsAllowInvalidCertificates = true;
        options.tlsAllowInvalidHostnames = true;
      }
    }

    cached!.client = new MongoClient(uri, options);
    // Attach Vercel's database pool for serverless optimization
    if (process.env.VERCEL) {
      attachDatabasePool(cached!.client);
    }
  }
  return cached!.client;
}

/**
 * Get a connected MongoDB client with retry logic and health checks
 * This function ensures the client is actually connected before returning it
 */
export async function getClientPromise(): Promise<MongoClient> {
  // If we have a cached promise, check if it's still valid
  if (cached!.promise) {
    try {
      const client = await cached!.promise;
      // Verify the connection is still healthy
      const isConnected = await isClientConnected(client).catch(() => false);
      if (isConnected) {
        return client;
      }
      // Connection is stale, clear it and reconnect
      console.warn('MongoDB client connection is stale, reconnecting...');
      cached!.promise = null;
      cached!.client = null;
    } catch (error) {
      // Previous promise failed, clear it
      console.warn('Previous MongoDB connection promise failed, clearing cache...');
      cached!.promise = null;
    }
  }

  // Create new connection with retry logic
  const client = getMongoClient();

  cached!.promise = retryConnection(async () => {
    try {
      await client.connect();
      // Verify connection after connect
      const isConnected = await isClientConnected(client);
      if (!isConnected) {
        throw new Error('Connection established but health check failed');
      }
      return client;
    } catch (error) {
      // Clear the promise on failure so we can retry
      cached!.promise = null;
      
      // Enhance error messages for SSL/TLS issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSSLError = errorMessage.includes('SSL') || 
                        errorMessage.includes('TLS') || 
                        errorMessage.includes('tlsv1') ||
                        errorMessage.includes('certificate') ||
                        errorMessage.includes('alert number');
      
      if (isSSLError) {
        const ALLOW_INSECURE_TLS = process.env.MONGODB_ALLOW_INVALID_CERTS === 'true';
        console.error('MongoDB client SSL/TLS connection error:', {
          message: errorMessage,
          allowInsecureTLS: ALLOW_INSECURE_TLS,
          originalError: error,
        });
      } else {
        console.error('MongoDB client connection error:', error);
      }
      throw error;
    }
  }).catch((error) => {
    // Clear cache on final failure
    cached!.promise = null;
    cached!.client = null;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isSSLError = errorMessage.includes('SSL') || 
                      errorMessage.includes('TLS') || 
                      errorMessage.includes('tlsv1') ||
                      errorMessage.includes('certificate') ||
                      errorMessage.includes('alert number');
    
    if (isSSLError) {
      const ALLOW_INSECURE_TLS = process.env.MONGODB_ALLOW_INVALID_CERTS === 'true';
      console.error('MongoDB client SSL/TLS connection failed after retries:', {
        message: errorMessage,
        allowInsecureTLS: ALLOW_INSECURE_TLS,
        originalError: error,
      });
    } else {
      console.error('MongoDB client connection failed after retries:', error);
    }
    // Don't throw unhandled rejection - let the caller handle it
    // But we need to throw so the promise chain knows it failed
    throw error;
  });

  return cached!.promise;
}

export default getMongoClient;
