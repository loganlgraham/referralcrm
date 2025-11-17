import { MongoClient } from 'mongodb';

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

export function getMongoClient(): MongoClient {
  const uri =
    process.env.MONGODB_URI ??
    (process.env.NODE_ENV === 'development' ? 'mongodb://localhost:27017/referralcrm' : undefined);

  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }

  if (!client) {
    client = new MongoClient(uri, {});
  }

  return client;
}

export function getClientPromise(): Promise<MongoClient> {
  if (!clientPromise) {
    const mongoClient = getMongoClient();

    clientPromise = mongoClient.connect().catch((error) => {
      clientPromise = null;

      const message = error instanceof Error ? error.message : 'Unknown Mongo connection error';
      console.error('[mongo] Failed to establish connection via MongoClient', error);

      try {
        void mongoClient.close();
      } catch {
        /* ignore close errors when cleaning up failed connections */
      }

      throw new Error(`Failed to connect to MongoDB: ${message}`);
    });
  }

  return clientPromise;
}

export default getMongoClient;
