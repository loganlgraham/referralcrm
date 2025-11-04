import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/referralcrm';
const options = {};

let client: MongoClient | null = null;
let promise: Promise<MongoClient> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | null | undefined;
}

if (!process.env.MONGODB_URI) {
  console.warn('Using fallback MongoDB URI for local development.');
}

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  promise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  promise = client.connect();
}

export default promise!;
