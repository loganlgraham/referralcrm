import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from 'dotenv';
import mongoose from 'mongoose';

import {
  buildDealZipApplyFilter,
  lookupZipWithCensusGeocoder,
  resolveDealZipBackfillPlans,
  type DealZipBackfillCandidate,
  type DealZipBackfillManifestEntry,
} from '@/lib/server/deal-property-zip-backfill';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import type { DealPropertyZipSource } from '@/utils/deal-property-zip';

config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

type Args = {
  apply: boolean;
  confirmTarget: string | null;
  limit: number | null;
  maxExternalLookups: number;
  outDir: string;
  runId: string;
};

type ReportRow = {
  paymentId: string;
  outcome: string;
  reason?: string;
  zip?: string;
  source?: string;
};

const DEFAULT_MAX_EXTERNAL_LOOKUPS = 500;

function readFlagValue(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseArgs(): Args {
  const limitArg = readFlagValue('--limit');
  const maxLookupsArg = readFlagValue('--max-external-lookups');
  const outDir = readFlagValue('--out-dir') ?? '.tmp/deal-property-zip-backfill';
  const runId =
    readFlagValue('--run-id') ??
    `deal-zip-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  return {
    apply: process.argv.includes('--apply'),
    confirmTarget: readFlagValue('--confirm-target'),
    limit: limitArg ? Number.parseInt(limitArg, 10) : null,
    maxExternalLookups: maxLookupsArg
      ? Number.parseInt(maxLookupsArg, 10)
      : DEFAULT_MAX_EXTERNAL_LOOKUPS,
    outDir,
    runId,
  };
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

function candidateFromPayment(payment: {
  _id: unknown;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyPostalCode?: string | null;
  propertyPostalCodeSource?: DealPropertyZipSource | null;
  updatedAt?: Date | string | null;
}): DealZipBackfillCandidate {
  return {
    _id: String(payment._id),
    propertyAddress: payment.propertyAddress ?? null,
    propertyCity: payment.propertyCity ?? null,
    propertyState: payment.propertyState ?? null,
    propertyPostalCode: payment.propertyPostalCode ?? null,
    propertyPostalCodeSource: payment.propertyPostalCodeSource ?? null,
    updatedAt: payment.updatedAt ?? null,
  };
}

async function main() {
  const args = parseArgs();
  await connectMongo();
  const target = getTargetConfirmation();
  console.log(`[deal-zip-backfill] target=${target}`);
  console.log(`[deal-zip-backfill] mode=${args.apply ? 'apply' : 'dry-run'} runId=${args.runId}`);
  console.log(`[deal-zip-backfill] Census Geocoder has no API fee; external lookup cap=${args.maxExternalLookups}`);

  if (args.apply && args.confirmTarget !== target) {
    throw new Error(
      `Refusing to apply. Re-run with --confirm-target=${target} after reviewing the dry run.`
    );
  }

  const query = Payment.find({
    propertyAddress: { $nin: [null, ''] },
  })
    .sort({ _id: 1 })
    .select(
      '_id propertyAddress propertyCity propertyState propertyPostalCode propertyPostalCodeSource updatedAt'
    )
    .lean<
      Array<{
        _id: unknown;
        propertyAddress?: string | null;
        propertyCity?: string | null;
        propertyState?: string | null;
        propertyPostalCode?: string | null;
        propertyPostalCodeSource?: DealPropertyZipSource | null;
        updatedAt?: Date | string | null;
      }>
    >();

  if (args.limit && args.limit > 0) {
    query.limit(args.limit);
  }

  const candidates = (await query).map(candidateFromPayment);
  let externalLookups = 0;
  const plans = await resolveDealZipBackfillPlans(candidates, {
    lookup: async (address) => {
      externalLookups += 1;
      if (externalLookups > args.maxExternalLookups) {
        return { status: 'error', message: 'external_lookup_cap_exceeded' };
      }
      return lookupZipWithCensusGeocoder(address);
    },
  });

  const reportRows: ReportRow[] = plans.map((plan) => ({
    paymentId: plan.paymentId,
    outcome: plan.outcome,
    reason: plan.outcome === 'unresolved' ? plan.reason : undefined,
    zip: plan.outcome === 'update' ? plan.zip : undefined,
    source: plan.outcome === 'update' ? plan.source : undefined,
  }));
  const counts = reportRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    if (row.reason) {
      acc[`unresolved:${row.reason}`] = (acc[`unresolved:${row.reason}`] ?? 0) + 1;
    }
    return acc;
  }, {});

  await mkdir(args.outDir, { recursive: true });
  const reportPath = path.join(args.outDir, `${args.runId}-report.json`);
  await writeFile(
    reportPath,
    JSON.stringify({ runId: args.runId, target, counts, externalLookups, rows: reportRows }, null, 2)
  );

  console.log(`[deal-zip-backfill] scanned=${candidates.length}`);
  console.log(`[deal-zip-backfill] counts=${JSON.stringify(counts)}`);
  console.log(`[deal-zip-backfill] externalLookups=${externalLookups}`);
  console.log(`[deal-zip-backfill] report=${reportPath}`);

  if (!args.apply) {
    console.log(`[deal-zip-backfill] dry run complete. Apply with --apply --confirm-target=${target}`);
    return;
  }

  const manifest: DealZipBackfillManifestEntry[] = [];
  for (const plan of plans) {
    if (plan.outcome !== 'update') {
      continue;
    }

    const result = await Payment.updateOne(
      buildDealZipApplyFilter(plan.candidate),
      {
        $set: {
          propertyPostalCode: plan.zip,
          propertyPostalCodeSource: plan.source,
        },
      }
    );

    if (result.modifiedCount === 1) {
      manifest.push({
        runId: args.runId,
        paymentId: plan.paymentId,
        previousZip: plan.candidate.propertyPostalCode ?? null,
        previousSource: plan.candidate.propertyPostalCodeSource ?? null,
        nextZip: plan.zip,
        nextSource: plan.source,
        propertyAddress: plan.candidate.propertyAddress ?? null,
        propertyCity: plan.candidate.propertyCity ?? null,
        propertyState: plan.candidate.propertyState ?? null,
        appliedAt: new Date().toISOString(),
      });
    }
  }

  const manifestPath = path.join(args.outDir, `${args.runId}-manifest.json`);
  await writeFile(manifestPath, JSON.stringify({ runId: args.runId, target, entries: manifest }, null, 2));
  console.log(`[deal-zip-backfill] updated=${manifest.length}`);
  console.log(`[deal-zip-backfill] manifest=${manifestPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[deal-zip-backfill] failed', error);
    process.exit(1);
  });
