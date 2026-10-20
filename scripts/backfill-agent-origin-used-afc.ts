/**
 * Lists agent-origin buy-side payments that still have usedAfc=false
 * (historically forced false on create). Never auto-flips all candidates —
 * ops must confirm each deal financed with AFC, then pass explicit IDs.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-agent-origin-used-afc.ts
 *   pnpm tsx scripts/backfill-agent-origin-used-afc.ts --apply --payment-ids=<id1>,<id2>
 */

import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

const APPLY = process.argv.includes('--apply');
const paymentIdsArg = process.argv.find((arg) => arg.startsWith('--payment-ids='));
const paymentIdsToApply = paymentIdsArg
  ? paymentIdsArg
      .slice('--payment-ids='.length)
      .split(',')
      .map((value) => value.trim())
      .filter((value) => Types.ObjectId.isValid(value))
  : [];

const CLOSED_LIKE = new Set(['closed', 'payment_sent', 'paid']);

async function run() {
  await connectMongo();

  const agentOriginReferrals = await Referral.find({
    deletedAt: null,
    origin: 'agent',
  })
    .select('_id borrower.name')
    .lean<{ _id: Types.ObjectId; borrower?: { name?: string | null } }[]>();

  const referralIds = agentOriginReferrals.map((referral) => referral._id);
  const referralNameById = new Map(
    agentOriginReferrals.map((referral) => [
      referral._id.toString(),
      referral.borrower?.name?.trim() || 'Unknown',
    ])
  );

  if (referralIds.length === 0) {
    console.log('[backfill-agent-origin-used-afc] No agent-origin referrals found.');
    return;
  }

  const candidates = await Payment.find({
    referralId: { $in: referralIds },
    side: { $ne: 'sell' },
    usedAfc: false,
  })
    .select('_id referralId status side usedAfc')
    .lean<
      {
        _id: Types.ObjectId;
        referralId?: Types.ObjectId | null;
        status?: string | null;
        side?: string | null;
        usedAfc?: boolean | null;
      }[]
    >();

  console.log(
    `[backfill-agent-origin-used-afc] Candidates (agent-origin, non-sell, usedAfc=false): ${candidates.length}`
  );

  for (const payment of candidates) {
    const referralId = payment.referralId?.toString() ?? 'n/a';
    const borrower = referralNameById.get(referralId) ?? 'Unknown';
    const closedLike = payment.status && CLOSED_LIKE.has(payment.status) ? 'closed-like' : payment.status;
    console.log(
      `  payment=${payment._id.toString()} referral=${referralId} borrower="${borrower}" status=${closedLike} side=${payment.side ?? 'null'}`
    );
  }

  if (!APPLY) {
    console.log(
      '[backfill-agent-origin-used-afc] Dry-run only. After ops confirms AFC-financed deals, run:'
    );
    console.log(
      '  pnpm tsx scripts/backfill-agent-origin-used-afc.ts --apply --payment-ids=<id1>,<id2>'
    );
    return;
  }

  if (paymentIdsToApply.length === 0) {
    console.error(
      '[backfill-agent-origin-used-afc] --apply requires --payment-ids=<comma-separated ObjectIds> of confirmed AFC deals.'
    );
    process.exit(1);
  }

  const candidateIdSet = new Set(candidates.map((payment) => payment._id.toString()));
  const confirmedIds = paymentIdsToApply.filter((id) => candidateIdSet.has(id));
  const skipped = paymentIdsToApply.filter((id) => !candidateIdSet.has(id));

  if (skipped.length > 0) {
    console.warn(
      `[backfill-agent-origin-used-afc] Skipping IDs not in candidate set: ${skipped.join(', ')}`
    );
  }

  if (confirmedIds.length === 0) {
    console.log('[backfill-agent-origin-used-afc] No confirmed candidate IDs to update.');
    return;
  }

  const result = await Payment.updateMany(
    { _id: { $in: confirmedIds.map((id) => new Types.ObjectId(id)) } },
    { $set: { usedAfc: true } }
  );

  console.log(
    `[backfill-agent-origin-used-afc] Updated: matched=${result.matchedCount ?? 0}, modified=${result.modifiedCount ?? 0}`
  );
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[backfill-agent-origin-used-afc] Failed', error);
    process.exit(1);
  });
