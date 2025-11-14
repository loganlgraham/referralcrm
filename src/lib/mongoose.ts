import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI ??
  (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);

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

if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI environment variable');
}

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
    cached!.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false
    });
  }

  cached!.conn = await cached!.promise;
  await registerModels();
  return cached!.conn;
}
