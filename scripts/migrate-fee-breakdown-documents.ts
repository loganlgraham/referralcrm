/**
 * Upload fee breakdown PDF attachments into the private MongoDB document store.
 *
 * Dry run:
 *   pnpm migrate:fee-breakdown-documents --dry-run --confirm-host=<mongodb-host> --confirm-db=<database>
 *
 * Execute:
 *   pnpm migrate:fee-breakdown-documents --execute --confirm-host=<mongodb-host> --confirm-db=<database>
 *
 * Optional:
 *   --source-dir=/path/to/pdf-directory
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import mongoose from 'mongoose';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

type Mode = 'dry-run' | 'execute';

type Args = {
  mode: Mode;
  sourceDir: string;
  confirmHost: string;
  confirmDb: string;
};

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseArgs(): Args {
  const dryRun = process.argv.includes('--dry-run');
  const execute = process.argv.includes('--execute');
  if (dryRun === execute) {
    throw new Error('Pass exactly one mode: --dry-run or --execute');
  }

  const confirmHost = readArg('confirm-host');
  const confirmDb = readArg('confirm-db');
  if (!confirmHost || !confirmDb) {
    throw new Error('Both --confirm-host and --confirm-db are required');
  }

  return {
    mode: execute ? 'execute' : 'dry-run',
    sourceDir: readArg('source-dir') ?? process.cwd(),
    confirmHost,
    confirmDb,
  };
}

function getUriHostAndDatabase(uri: string): { host: string; database: string | null } {
  const parsed = new URL(uri);
  const database = parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : null;
  return {
    host: parsed.host,
    database: database || null,
  };
}

function verifyIntendedDatabase(args: Args): void {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  const uriIdentity = getUriHostAndDatabase(uri);
  const actualDb = mongoose.connection.db?.databaseName ?? mongoose.connection.name;

  if (uriIdentity.host !== args.confirmHost) {
    throw new Error('Refusing to run: connected MongoDB host does not match --confirm-host');
  }
  if (actualDb !== args.confirmDb) {
    throw new Error('Refusing to run: connected MongoDB database does not match --confirm-db');
  }
  if (uriIdentity.database && uriIdentity.database !== actualDb) {
    throw new Error('Refusing to run: MongoDB URI database does not match connected database');
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Dynamic imports are required here so dotenv runs before src/lib/mongoose
  // resolves MONGODB_URI at module initialization.
  const { connectMongo } = await import('../src/lib/mongoose');
  const { ServerDocument } = await import('../src/models/server-document');
  const { FEE_BREAKDOWN_DOCUMENTS } = await import('../src/lib/server/fee-breakdown-documents');
  const {
    buildServerDocumentPayload,
    decideServerDocumentWrite,
    readSourcePdfDocuments,
    verifyReadBackDocument,
  } = await import('../src/lib/server/fee-breakdown-document-migration');

  await connectMongo();
  verifyIntendedDatabase(args);

  const sources = readSourcePdfDocuments(FEE_BREAKDOWN_DOCUMENTS, args.sourceDir);
  console.log(`Fee breakdown document migration: ${args.mode}`);
  console.log(`Verified MongoDB target host=${args.confirmHost} database=${args.confirmDb}`);

  const now = new Date();
  for (const source of sources) {
    const { definition, content } = source;
    const existing = await ServerDocument.findOne({
      key: definition.key,
      version: definition.version,
    })
      .select('filename mimeType byteLength sha256 content')
      .lean();
    const decision = decideServerDocumentWrite(definition, existing);
    const payload = buildServerDocumentPayload(definition, content, now);

    console.log(
      `${definition.filename}: ${decision.action} bytes=${definition.byteLength} sha256=${definition.sha256}`
    );

    if (args.mode === 'execute' && decision.action === 'upload') {
      await ServerDocument.updateOne(
        { key: definition.key, version: definition.version },
        { $setOnInsert: payload },
        { upsert: true }
      );
    }
  }

  if (args.mode === 'execute') {
    for (const source of sources) {
      const readBack = await ServerDocument.findOne({
        key: source.definition.key,
        version: source.definition.version,
      })
        .select('filename mimeType byteLength sha256 content')
        .lean();
      verifyReadBackDocument(source.definition, readBack, source.content);
      console.log(`${source.definition.filename}: read-back verified`);
    }
  } else {
    console.log('Dry run complete. No documents were written.');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Fee breakdown document migration failed:', error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
