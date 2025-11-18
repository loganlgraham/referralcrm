import mongoose from 'mongoose';
import {
  MongoNetworkError,
  MongoServerSelectionError
} from 'mongodb';

const resolvedMongoUri =
  process.env.MONGODB_URI ??
  (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);

if (!resolvedMongoUri) {
  throw new Error('Missing MONGODB_URI environment variable');
}

const MONGODB_URI = resolvedMongoUri;

let modelsRegistered = false;

const MAX_CONNECTION_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 500;
let retryAttempt = 1;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    import('@/models/referral'),
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

const shouldRetryConnection = (error: unknown) => {
  const isPoolClearedError = (candidate: unknown) =>
    (candidate as { name?: string } | null)?.name === 'MongoPoolClearedError';

  if (
    error instanceof MongoNetworkError ||
    error instanceof MongoServerSelectionError ||
    isPoolClearedError(error)
  ) {
    return true;
  }

  const candidate = error as { errorLabelSet?: Set<string>; cause?: unknown } | null;
  if (candidate?.errorLabelSet?.has('ResetPool') || candidate?.errorLabelSet?.has('PoolRequstedRetry')) {
    return true;
  }

  if (candidate?.cause) {
    const cause = candidate.cause as { errorLabelSet?: Set<string>; name?: string } | null;
    return Boolean(
      cause?.errorLabelSet?.has('ResetPool') ||
      cause?.errorLabelSet?.has('PoolRequstedRetry') ||
      isPoolClearedError(cause)
    );
  }

  return false;
};

const resetCachedConnection = async () => {
  if (cached?.conn) {
    try {
      await cached.conn.connection.close(false);
    } catch {
      /* ignore close errors while resetting */
    }
  }

  cached!.conn = null;
  cached!.promise = null;
};

export async function connectMongo(): Promise<typeof mongoose> {
  if (cached?.conn && cached.conn.connection.readyState === 1) {
    retryAttempt = 1;
    await registerModels();
    return cached.conn;
  }

  if (!cached?.promise) {
    cached!.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000
      })
      .catch((error) => {
        cached!.promise = null;
        throw error;
      });
  }

  try {
    cached!.conn = await cached!.promise;
    retryAttempt = 1;
    await registerModels();
    return cached!.conn;
  } catch (error) {
    const shouldRetry = shouldRetryConnection(error);
    const message = error instanceof Error ? error.message : 'Unknown Mongo connection error';

    console.error('[mongo] Failed to establish connection', error);

    await resetCachedConnection();

    if (shouldRetry && retryAttempt <= MAX_CONNECTION_RETRIES) {
      const backoffMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** (retryAttempt - 1), 5000);
      console.warn(
        `[mongo] Retrying mongoose connection after transient failure (attempt ${retryAttempt} of ${MAX_CONNECTION_RETRIES}) after ${backoffMs}ms`
      );
      retryAttempt += 1;

      cached!.promise = mongoose
        .connect(MONGODB_URI, {
          bufferCommands: false,
          serverSelectionTimeoutMS: 5000
        })
        .catch((connectError) => {
          cached!.promise = null;
          throw connectError;
        });

      await delay(backoffMs);
      return connectMongo();
    }

    retryAttempt = 1;
    throw new Error(`Failed to connect to MongoDB: ${message}`);
  }
}
