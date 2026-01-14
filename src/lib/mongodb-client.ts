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

export function getMongoClient(): MongoClient {
  const uri = process.env.MONGODB_URI ?? (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);
  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }
  if (!cached!.client) {
    const options = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true,
      heartbeatFrequencyMS: 10000,
    };
    cached!.client = new MongoClient(uri, options);
    // Attach Vercel's database pool for serverless optimization
    if (process.env.VERCEL) {
      attachDatabasePool(cached!.client);
    }
  }
  return cached!.client;
}

export function getClientPromise(): Promise<MongoClient> {
  if (cached!.promise) {
    return cached!.promise;
  }

  const client = getMongoClient();
  cached!.promise = client.connect().catch((error) => {
    // Clear the cached promise on failure so we can retry
    cached!.promise = null;
    console.error('MongoDB client connection error:', error);
    throw error;
  });

  return cached!.promise;
}

export default getMongoClient;
