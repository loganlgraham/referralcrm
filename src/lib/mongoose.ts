import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/referralcrm';

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
    return cached.conn;
  }

  if (!cached?.promise) {
    cached!.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false
    });
  }

  cached!.conn = await cached!.promise;
  return cached!.conn;
}
