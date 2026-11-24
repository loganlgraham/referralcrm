import mongoose from 'mongoose';
import { databaseTargetFromUri, productionDatabaseAllowed, PRODUCTION_MONGO_DATABASE, PRODUCTION_MONGO_HOST } from '../src/lib/intelligence/access-control';
import { bootstrapAccountOwner, inspectAccountOwner } from '../src/lib/server/fub-access';
import { connectMongo } from '../src/lib/mongoose';

/**
 * Read-only unless both `--commit` and REFERRIO_OWNER_BOOTSTRAP=confirm are set.
 * The target host and database are fixed to Referrio production. This script does
 * not load `.env.local`, so a sandbox URI in the shell is refused before connect.
 */
async function main() {
  const target = databaseTargetFromUri(process.env.MONGODB_URI ?? '');
  const allowed = productionDatabaseAllowed(target);
  if (!allowed.ok || !target) {
    console.log(JSON.stringify(allowed.ok ? { ok: false, reason: 'database', host: null, databaseName: null } : allowed));
    process.exitCode = 2;
    return;
  }
  const commit = process.argv.includes('--commit');
  if (commit && process.env.REFERRIO_OWNER_BOOTSTRAP !== 'confirm') {
    console.log(JSON.stringify({ ok: false, reason: 'confirmation' }));
    process.exitCode = 1;
    return;
  }
  await connectMongo();
  const actualDatabase = mongoose.connection.db?.databaseName ?? '';
  if (target.host !== PRODUCTION_MONGO_HOST || actualDatabase !== PRODUCTION_MONGO_DATABASE) {
    console.log(JSON.stringify({ ok: false, reason: 'database', host: target.host, databaseName: actualDatabase }));
    process.exitCode = 2;
    return;
  }
  const resolved = { host: target.host, databaseName: actualDatabase };
  if (!commit) {
    const inspection = await inspectAccountOwner(resolved);
    console.log(JSON.stringify(inspection));
    process.exitCode = inspection.ok ? 0 : 2;
    return;
  }
  const result = await bootstrapAccountOwner({
    target: resolved,
    expectedUserId: process.env.REFERRIO_OWNER_USER_ID ?? '',
    at: new Date().toISOString(),
    commit: true,
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]') : 'connection_failed';
    console.log(JSON.stringify({ ok: false, reason: 'connection', message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
