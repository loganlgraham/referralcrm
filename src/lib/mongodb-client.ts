import { MongoClient } from 'mongodb';

let client: MongoClient | null = null;

export function getMongoClient(): MongoClient {
  const uri = process.env.MONGODB_URI ?? (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);
  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }
  if (!client) {
    client = new MongoClient(uri, {});
  }
  return client;
}

export function getClientPromise(): Promise<MongoClient> {
  return getMongoClient().connect();
}

export default getMongoClient;
