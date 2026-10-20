import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { type LostReason } from '@/constants/referrals';
import { isFunnelStage, stageIndex, type FunnelStageName } from '@/lib/server/conversion-funnel';

/**
 * Classifies pre-existing Lost referrals that predate reason capture.
 *
 * Runs as a dry run by default; pass --apply to write. Inferred reasons are marked
 * with lostReasonSource: 'inferred' so dashboards can separate them from reasons a
 * human actually reported.
 */

const LOG_PREFIX = '[backfill-lost-reasons]';
const IN_COMMUNICATION_INDEX = stageIndex('In Communication');

interface AuditRow {
  field?: string | null;
  newValue?: unknown;
  timestamp?: Date | string | null;
}

interface LostReferralRow {
  _id: { toString(): string };
  status?: string | null;
  lostReason?: string | null;
  audit?: AuditRow[] | null;
  sla?: { timeToFirstAgentContactHours?: number | null } | null;
}

function normalizeStage(value: unknown): FunnelStageName | null {
  if (typeof value !== 'string') return null;
  const normalized = value === 'Showing Homes' ? 'Active Lead' : value;
  return isFunnelStage(normalized) ? normalized : null;
}

/** Highest funnel stage the referral is known to have reached, or -1 if unknown. */
function maxStageReached(referral: LostReferralRow): number {
  let maxIndex = -1;
  for (const entry of referral.audit ?? []) {
    if (entry?.field !== 'status') continue;
    const stage = normalizeStage(entry.newValue);
    if (stage) {
      maxIndex = Math.max(maxIndex, stageIndex(stage));
    }
  }
  return maxIndex;
}

function inferLostReason(referral: LostReferralRow): LostReason {
  const reachedCommunication = maxStageReached(referral) >= IN_COMMUNICATION_INDEX;
  const loggedFirstContact = referral.sla?.timeToFirstAgentContactHours != null;

  if (!reachedCommunication && !loggedFirstContact) {
    return 'never_connected';
  }
  return 'chose_other_agent_postcontact';
}

async function run() {
  const apply = process.argv.includes('--apply');

  await connectMongo();

  const referrals = await Referral.find({
    status: 'Lost',
    $or: [{ lostReason: null }, { lostReason: { $exists: false } }]
  })
    .select('_id status lostReason audit.field audit.newValue audit.timestamp sla.timeToFirstAgentContactHours')
    .lean<LostReferralRow[]>();

  const counts = new Map<LostReason, number>();
  const updates: { id: LostReferralRow['_id']; reason: LostReason }[] = [];

  for (const referral of referrals) {
    const reason = inferLostReason(referral);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    updates.push({ id: referral._id, reason });
  }

  console.log(`${LOG_PREFIX} Found ${referrals.length} Lost referrals with no reason on file.`);
  for (const [reason, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`${LOG_PREFIX}   ${reason}: ${count}`);
  }

  if (!apply) {
    console.log(`${LOG_PREFIX} Dry run only. Re-run with --apply to write these values.`);
    return;
  }

  let updatedCount = 0;
  for (const update of updates) {
    await Referral.updateOne(
      { _id: update.id },
      { $set: { lostReason: update.reason, lostReasonSource: 'inferred' } }
    );
    updatedCount += 1;
  }

  console.log(`${LOG_PREFIX} Updated ${updatedCount} referrals.`);
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`${LOG_PREFIX} Failed:`, error);
    process.exit(1);
  });
