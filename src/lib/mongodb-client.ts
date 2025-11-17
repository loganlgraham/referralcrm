import {
  MongoClient,
  MongoNetworkError,
  MongoPoolClearedError,
  MongoServerSelectionError
} from 'mongodb';

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

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

const resetClientState = async () => {
  if (client) {
    try {
      await client.close();
    } catch {
      /* ignore close errors when cleaning up failed connections */
    }
  }

  client = null;
  clientPromise = null;
};

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

    clientPromise = mongoClient.connect().catch(async (error) => {
      const shouldRetry = shouldRetryConnection(error);
      const message = error instanceof Error ? error.message : 'Unknown Mongo connection error';

      console.error('[mongo] Failed to establish connection via MongoClient', error);

      await resetClientState();

      if (shouldRetry) {
        console.warn('[mongo] Retrying MongoClient connection after transient failure');
        return getClientPromise();
      }

      throw new Error(`Failed to connect to MongoDB: ${message}`);
    });
  }

  return clientPromise;
}

export default getMongoClient;
