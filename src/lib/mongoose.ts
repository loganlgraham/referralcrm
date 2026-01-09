import mongoose from 'mongoose';

const resolvedMongoUri =
  process.env.MONGODB_URI ??
  (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);

if (!resolvedMongoUri) {
  throw new Error('Missing MONGODB_URI environment variable');
}

const MONGODB_URI = resolvedMongoUri;
const ALLOW_INSECURE_TLS = process.env.MONGODB_ALLOW_INVALID_CERTS === 'true';

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

export async function connectMongo(): Promise<typeof mongoose> {
  if (cached?.conn) {
    await registerModels();
    return cached.conn;
  }

  if (!cached?.promise) {
    const connectionOptions: Parameters<typeof mongoose.connect>[1] = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 30000, // Increased from 15000 for serverless cold starts
      socketTimeoutMS: 45000, // Add socket timeout
      connectTimeoutMS: 30000, // Add connection timeout
      maxPoolSize: 1, // Reduce pool size for serverless (single connection per function)
      minPoolSize: 1,
      maxIdleTimeMS: 30000,
    };
    if (ALLOW_INSECURE_TLS) {
      connectionOptions.tlsAllowInvalidCertificates = true;
      connectionOptions.tlsAllowInvalidHostnames = true;
    }
    cached!.promise = mongoose.connect(MONGODB_URI, connectionOptions).catch((error) => {
      // Clear the cached promise on failure so we can retry
      cached!.promise = null;
      cached!.conn = null;
      console.error('MongoDB connection error:', error);
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
    console.error('MongoDB connection failed:', error);
    throw error;
  }
}
