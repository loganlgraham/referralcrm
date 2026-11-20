import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from 'dotenv';
import mongoose from 'mongoose';

import {
  buildDealZipRollbackFilter,
  type DealZipBackfillManifestEntry,
} from '@/lib/server/deal-property-zip-backfill';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';

config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

type ManifestFile = {
  runId: string;
  target: string;
  entries: DealZipBackfillManifestEntry[];
};

function readFlagValue(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function getTargetConfirmation(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required.');
  }
  const parsed = new URL(uri);
  const host = parsed.host;
  const dbName = mongoose.connection.db?.databaseName ?? parsed.pathname.replace(/^\//, '');
  if (!host || !dbName) {
    throw new Error('Could not determine MongoDB host and database.');
  }
  return `${host}/${dbName}`;
}

async function main() {
  const manifestPath = readFlagValue('--manifest');
  const confirmTarget = readFlagValue('--confirm-target');
  const apply = process.argv.includes('--apply');

  if (!manifestPath) {
    throw new Error('Missing --manifest=<path>');
  }

  await connectMongo();
  const target = getTargetConfirmation();
  if (confirmTarget !== target) {
    throw new Error(`Refusing rollback. Re-run with --confirm-target=${target}.`);
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestFile;
  if (manifest.target !== target) {
    throw new Error(`Manifest target ${manifest.target} does not match current target ${target}.`);
  }

  console.log(`[deal-zip-rollback] target=${target}`);
  console.log(`[deal-zip-rollback] mode=${apply ? 'apply' : 'dry-run'} runId=${manifest.runId}`);
  console.log(`[deal-zip-rollback] entries=${manifest.entries.length}`);

  if (!apply) {
    console.log('[deal-zip-rollback] dry run complete. Add --apply after reviewing target and manifest.');
    return;
  }

  let restored = 0;
  let skipped = 0;
  for (const entry of manifest.entries) {
    const result = await Payment.updateOne(
      buildDealZipRollbackFilter(entry),
      {
        $set: {
          propertyPostalCode: entry.previousZip,
          propertyPostalCodeSource: entry.previousSource,
        },
      }
    );
    if (result.modifiedCount === 1) {
      restored += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`[deal-zip-rollback] restored=${restored} skipped=${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[deal-zip-rollback] failed', error);
    process.exit(1);
  });
