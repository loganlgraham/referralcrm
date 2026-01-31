/**
 * One-off migration: fix backfilled referral dates.
 *
 * For referrals where createdAt was manually set back (e.g. to 2025 for historical
 * closings), move that date into referralDate and reset createdAt to the ObjectId
 * timestamp (when the record was actually inserted).
 *
 * Migration rules:
 * - If createdAt is meaningfully earlier than the ObjectId timestamp (> 7 days), treat as backfill
 * - Set referralDate = current createdAt (the historical date)
 * - Set createdAt = objectIdTimestamp(_id)
 * - Leave already-correct rows alone
 *
 * Run: pnpm migrate:referral-dates [--dry-run] [--threshold-days=7]
 * Loads .env and .env.local (Next.js convention) before connecting to MongoDB.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import type { Types } from 'mongoose';
import { differenceInDays, differenceInMinutes } from 'date-fns';

// Load env before mongoose is imported (dynamic import in main)
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

const DRY_RUN = process.argv.includes('--dry-run');
const THRESHOLD_ARG = process.argv.find((a) => a.startsWith('--threshold-days='));
const THRESHOLD_DAYS = THRESHOLD_ARG ? parseInt(THRESHOLD_ARG.split('=')[1] ?? '7', 10) : 7;

function getObjectIdTimestamp(id: Types.ObjectId): Date {
  return (id as unknown as { getTimestamp: () => Date }).getTimestamp();
}

async function main() {
  const { connectMongo } = await import('../src/lib/mongoose');
  const { Referral } = await import('../src/models/referral');

  await connectMongo();

  console.log(
    `Migrating backfilled referral dates (threshold: ${THRESHOLD_DAYS} days)${DRY_RUN ? ' [DRY RUN - no changes]' : ''}\n`
  );

  const referrals = await Referral.find({ deletedAt: null })
    .select('_id createdAt referralDate sla')
    .lean<
      Array<{
        _id: Types.ObjectId;
        createdAt: Date;
        referralDate?: Date | null;
        sla?: {
          lastPairedAt?: Date | string | null;
          timeToAssignmentHours?: number | null;
          timeToFirstAgentContactHours?: number | null;
          daysToContract?: number | null;
          daysToClose?: number | null;
        } | null;
      }>
    >();

  const toMigrate: Array<{
    _id: Types.ObjectId;
    createdAt: Date;
    referralDate: Date;
    sla?: {
      lastPairedAt?: Date | string | null;
      timeToAssignmentHours?: number | null;
      timeToFirstAgentContactHours?: number | null;
      daysToContract?: number | null;
      daysToClose?: number | null;
    } | null;
  }> = [];
  let skipped = 0;

  for (const r of referrals) {
    const objectIdTime = getObjectIdTimestamp(r._id);
    const createdAt = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
    const daysDiff = differenceInDays(objectIdTime, createdAt);

    // If createdAt is earlier than ObjectId by more than threshold, treat as backfill
    if (daysDiff > THRESHOLD_DAYS) {
      toMigrate.push({
        _id: r._id,
        createdAt,
        referralDate: createdAt,
        sla: r.sla ?? undefined,
      });
    } else {
      skipped++;
    }
  }

  console.log(`Total referrals: ${referrals.length}`);
  console.log(`To migrate (backfilled): ${toMigrate.length}`);
  console.log(`Skipped (already correct): ${skipped}\n`);

  if (toMigrate.length > 0) {
    console.log('Sample IDs to migrate (first 5):');
    toMigrate.slice(0, 5).forEach((r) => {
      const objectIdTime = getObjectIdTimestamp(r._id);
      const lastPairedAt = r.sla?.lastPairedAt
        ? r.sla.lastPairedAt instanceof Date
          ? r.sla.lastPairedAt
          : new Date(r.sla.lastPairedAt as string)
        : null;
      const newTimeToAssignment =
        lastPairedAt && lastPairedAt > objectIdTime
          ? Math.round((differenceInMinutes(lastPairedAt, objectIdTime) / 60) * 10) / 10
          : null;
      const oldTimeToAssignment = r.sla?.timeToAssignmentHours ?? null;
      const oldTimeToFirstContact = r.sla?.timeToFirstAgentContactHours ?? null;
      const oldDaysToContract = r.sla?.daysToContract ?? null;
      const oldDaysToClose = r.sla?.daysToClose ?? null;
      console.log(
        `  ${r._id} | timeToAssignment: ${oldTimeToAssignment ?? 'null'}h -> ${newTimeToAssignment ?? 'null'}h | timeToFirstContact: ${oldTimeToFirstContact ?? 'null'}h -> null | daysToContract: ${oldDaysToContract ?? 'null'} -> null | daysToClose: ${oldDaysToClose ?? 'null'} -> null`
      );
    });
  }

  if (!DRY_RUN && toMigrate.length > 0) {
    let updated = 0;
    for (const r of toMigrate) {
      const objectIdTime = getObjectIdTimestamp(r._id);
      const lastPairedAt = r.sla?.lastPairedAt
        ? r.sla.lastPairedAt instanceof Date
          ? r.sla.lastPairedAt
          : new Date(r.sla.lastPairedAt as string)
        : null;
      const newTimeToAssignment =
        lastPairedAt && !Number.isNaN(lastPairedAt.getTime()) && lastPairedAt > objectIdTime
          ? Math.round((differenceInMinutes(lastPairedAt, objectIdTime) / 60) * 10) / 10
          : null;

      await Referral.collection.updateOne(
        { _id: r._id },
        {
          $set: {
            referralDate: r.referralDate,
            createdAt: objectIdTime,
            'sla.timeToAssignmentHours': newTimeToAssignment ?? null,
            'sla.timeToFirstAgentContactHours': null,
            'sla.daysToContract': null,
            'sla.daysToClose': null,
          },
        }
      );
      updated++;
      if (updated <= 10 || updated === toMigrate.length) {
        console.log(`  ✓ Updated ${r._id} (${updated}/${toMigrate.length})`);
      }
    }
    console.log(`\nDone. Updated ${updated} referral(s).`);
  } else if (DRY_RUN && toMigrate.length > 0) {
    console.log('\nDry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\nNothing to migrate.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
