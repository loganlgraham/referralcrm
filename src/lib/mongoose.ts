import mongoose from 'mongoose';

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
    import('@/models/agent'),
    import('@/models/buyer'),
    import('@/models/coverage-suggestion'),
    import('@/models/lender'),
    import('@/models/payment'),
    import('@/models/pre-approval-metric'),
    import('@/models/follow-up-task-state'),
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
  cached = globalWithMongoose.mongooseGlobal = { conn: null, promise: null };
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
  return (
    cached?.conn?.connection?.readyState === mongoose.ConnectionStates.connected ||
    cached?.conn?.connection?.readyState === mongoose.ConnectionStates.connecting
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
      error instanceof Error ? error.message : String(error)
    );

    await sleep(delay);
    return retryConnection(fn, attempt + 1, maxAttempts);
  }
}

export async function connectMongo(): Promise<typeof mongoose> {
  // Check if we have a cached connection that's still healthy
  if (cached?.conn && isConnectionHealthy()) {
    await registerModels();
    return cached.conn;
  }

  // If connection is stale, clear it
  if (cached?.conn && !isConnectionHealthy()) {
    console.warn('Mongoose connection is stale, reconnecting...');
    cached.conn = null;
    cached.promise = null;
  }

  // Create new connection with retry logic
  if (!cached?.promise) {
    const needsTLS = requiresTLS(MONGODB_URI);
    
    const connectionOptions: Parameters<typeof mongoose.connect>[1] = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 30000, // Increased from 15000 for serverless cold starts
      socketTimeoutMS: 45000, // Add socket timeout
      connectTimeoutMS: 30000, // Add connection timeout
      maxPoolSize: 10, // Increased from 1 to allow parallel queries within a single request
      minPoolSize: 0, // Reduced from 1 to avoid keeping unnecessary connections open
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true,
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
      // Set certificate validation options only if explicitly needed
      // For mongodb+srv://, only set these if ALLOW_INSECURE_TLS is true
      // Otherwise, let MongoDB handle TLS with default secure settings
      if (ALLOW_INSECURE_TLS) {
        connectionOptions.tlsAllowInvalidCertificates = true;
        connectionOptions.tlsAllowInvalidHostnames = true;
      }
    }

    cached!.promise = retryConnection(async () => {
      try {
        const conn = await mongoose.connect(MONGODB_URI, connectionOptions);
        
        // Wait for connection to be ready (mongoose.connect should already wait, but verify)
        // State 2 is "connecting", so we wait a bit if it's still connecting
        let attempts = 0;
        while (conn.connection.readyState === mongoose.ConnectionStates.connecting && attempts < 10) {
          await sleep(100);
          attempts++;
        }
        
        // Verify connection is actually ready
        if (conn.connection.readyState !== mongoose.ConnectionStates.connected) {
          throw new Error(`Connection not ready, state: ${conn.connection.readyState} (expected: ${mongoose.ConnectionStates.connected})`);
        }
        
        return conn;
      } catch (error) {
        // Clear the cached promise on failure so we can retry
        cached!.promise = null;
        cached!.conn = null;
        
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
              ? 'Invalid certificates are allowed but connection still failed.' 
              : 'Consider setting MONGODB_ALLOW_INVALID_CERTS=true if using self-signed certificates.')
          );
          enhancedError.cause = error;
          console.error('MongoDB SSL/TLS connection error:', {
            message: errorMessage,
            allowInsecureTLS: ALLOW_INSECURE_TLS,
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
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSSLError = errorMessage.includes('SSL') || 
                        errorMessage.includes('TLS') || 
                        errorMessage.includes('tlsv1') ||
                        errorMessage.includes('certificate');
      
      if (isSSLError) {
        console.error('MongoDB SSL/TLS connection failed after retries:', {
          message: errorMessage,
          allowInsecureTLS: ALLOW_INSECURE_TLS,
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
    await registerModels();
    return cached!.conn;
  } catch (error) {
    // Clear cache on error to allow retry
    cached!.promise = null;
    cached!.conn = null;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isSSLError = errorMessage.includes('SSL') || 
                      errorMessage.includes('TLS') || 
                      errorMessage.includes('tlsv1') ||
                      errorMessage.includes('certificate');
    
    if (isSSLError) {
      console.error('MongoDB SSL/TLS connection failed:', {
        message: errorMessage,
        allowInsecureTLS: ALLOW_INSECURE_TLS,
        originalError: error,
      });
    } else {
      console.error('MongoDB connection failed:', error);
    }
    throw error;
  }
}
