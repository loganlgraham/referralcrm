import {
  MongoClient,
  MongoNetworkError,
  MongoServerSelectionError
} from 'mongodb';

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

const MAX_CONNECTION_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 500;

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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectWithRetry = async (attempt = 1): Promise<MongoClient> => {
  const mongoClient = getMongoClient();

  try {
    return await mongoClient.connect();
  } catch (error) {
    const shouldRetry = shouldRetryConnection(error);
    const message = error instanceof Error ? error.message : 'Unknown Mongo connection error';

    console.error('[mongo] Failed to establish connection via MongoClient', error);

    await resetClientState();

    if (shouldRetry && attempt <= MAX_CONNECTION_RETRIES) {
      const backoffMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), 5000);
      console.warn(
        `[mongo] Retrying MongoClient connection after transient failure (attempt ${attempt} of ${MAX_CONNECTION_RETRIES}) after ${backoffMs}ms`
      );
      await delay(backoffMs);
      return connectWithRetry(attempt + 1);
    }

    throw new Error(`Failed to connect to MongoDB: ${message}`);
  }
};

export function getClientPromise(): Promise<MongoClient> {
  if (!clientPromise) {
    clientPromise = connectWithRetry();
  }

  return clientPromise;
}

export default getMongoClient;
