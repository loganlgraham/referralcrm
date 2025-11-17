import mongoose from 'mongoose';
import {
  MongoNetworkError,
  MongoPoolClearedError,
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
  if (
    error instanceof MongoNetworkError ||
    error instanceof MongoServerSelectionError ||
    error instanceof MongoPoolClearedError
  ) {
    return true;
  }

  const candidate = error as { errorLabelSet?: Set<string>; cause?: unknown } | null;
  if (candidate?.errorLabelSet?.has('ResetPool')) {
    return true;
  }

  if (candidate?.cause) {
    const cause = candidate.cause as { errorLabelSet?: Set<string> } | null;
    return Boolean(cause?.errorLabelSet?.has('ResetPool'));
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
    await registerModels();
    return cached.conn;
  }

  if (!cached?.promise) {
    cached!.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false
      })
      .catch((error) => {
        cached!.promise = null;
        throw error;
      });
  }

  try {
    cached!.conn = await cached!.promise;
    await registerModels();
    return cached!.conn;
  } catch (error) {
    const shouldRetry = shouldRetryConnection(error);
    const message = error instanceof Error ? error.message : 'Unknown Mongo connection error';

    console.error('[mongo] Failed to establish connection', error);

    await resetCachedConnection();

    if (shouldRetry) {
      console.warn('[mongo] Retrying mongoose connection after transient failure');
      return connectMongo();
    }

    throw new Error(`Failed to connect to MongoDB: ${message}`);
  }
}
