import { MongoClient } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

let client: MongoClient | null = null;

export function getMongoClient(): MongoClient {
  const uri = process.env.MONGODB_URI ?? (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);
  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }
  if (!client) {
    const options = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    };
    client = new MongoClient(uri, options);
    // Attach Vercel's database pool for serverless optimization
    if (process.env.VERCEL) {
      attachDatabasePool(client);
    }
  }
  return client;
}

export function getClientPromise(): Promise<MongoClient> {
  return getMongoClient().connect().catch((error) => {
    console.error('MongoDB client connection error:', error);
    throw error;
  });
}

export default getMongoClient;
