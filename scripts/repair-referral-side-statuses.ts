import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { deriveReferralStatusFromSides } from '@/lib/server/referral-sides';
import { REFERRAL_STATUSES, type ReferralStatus } from '@/constants/referrals';

// One-off repair for referrals that were silently side-routed to the wrong
// status field because of a UI + API bug where `dealSide` (which defaults to
// 'buy') was trusted over `clientType` on single-sided referrals.
//
// For `clientType='Seller'` referrals whose `buyStatus` advanced past
// `New Lead` while `sellStatus` stayed at `New Lead`, we move the buy-side
// value onto the sell side (and vice versa for `clientType='Buyer'`), reset
// the wrong side back to 'New Lead', recompute the aggregated status, and
// append an audit entry so the change is traceable.

const NON_NEUTRAL_STATUSES = new Set<ReferralStatus>(
  REFERRAL_STATUSES.filter((status) => status !== 'New Lead')
);

const DRY_RUN = process.argv.includes('--dry-run');

type ReferralLean = {
  _id: { toString(): string };
  clientType?: 'Seller' | 'Buyer' | 'Both' | null;
  status?: string | null;
  buyStatus?: string | null;
  sellStatus?: string | null;
  statusLastUpdated?: Date | null;
};

async function run() {
  await connectMongo();

  const candidates = await Referral.find({
    clientType: { $in: ['Seller', 'Buyer'] },
    $or: [
      { clientType: 'Seller', buyStatus: { $nin: ['New Lead', null] } },
      { clientType: 'Buyer', sellStatus: { $nin: ['New Lead', null] } },
    ],
  })
    .select('_id clientType status buyStatus sellStatus statusLastUpdated')
    .lean<ReferralLean[]>();

  let repairedCount = 0;
  let skippedCount = 0;

  for (const referral of candidates) {
    const wrongSide: 'buy' | 'sell' = referral.clientType === 'Seller' ? 'buy' : 'sell';
    const correctSide: 'buy' | 'sell' = wrongSide === 'buy' ? 'sell' : 'buy';

    const wrongValue = wrongSide === 'buy' ? referral.buyStatus : referral.sellStatus;
    const correctValue = correctSide === 'buy' ? referral.buyStatus : referral.sellStatus;

    if (!wrongValue || !NON_NEUTRAL_STATUSES.has(wrongValue as ReferralStatus)) {
      skippedCount += 1;
      continue;
    }

    // If the correct side already has a non-default status, the correct side
    // is the source of truth and we should NOT overwrite it from the wrong
    // side -- leave it alone and just clear the wrong side.
    const correctSideAlreadySet =
      Boolean(correctValue) && correctValue !== 'New Lead';

    const nextBuyStatus =
      wrongSide === 'buy'
        ? 'New Lead'
        : correctSideAlreadySet
          ? referral.buyStatus ?? 'New Lead'
          : (wrongValue as ReferralStatus);
    const nextSellStatus =
      wrongSide === 'sell'
        ? 'New Lead'
        : correctSideAlreadySet
          ? referral.sellStatus ?? 'New Lead'
          : (wrongValue as ReferralStatus);

    const nextAggregatedStatus = deriveReferralStatusFromSides(
      nextBuyStatus,
      nextSellStatus,
      referral.clientType ?? null
    );

    const now = new Date();
    const auditEntry = {
      actorRole: 'system',
      field: 'sideStatusRepair',
      previousValue: {
        status: referral.status ?? null,
        buyStatus: referral.buyStatus ?? null,
        sellStatus: referral.sellStatus ?? null,
      },
      newValue: {
        status: nextAggregatedStatus,
        buyStatus: nextBuyStatus,
        sellStatus: nextSellStatus,
        reason: correctSideAlreadySet
          ? 'wrong-side-status-cleared'
          : 'wrong-side-status-moved-to-correct-side',
      },
      timestamp: now,
    };

    console.log(
      `[repair-referral-side-statuses] ${DRY_RUN ? '[dry-run] ' : ''}` +
        `referral=${referral._id.toString()} clientType=${referral.clientType} ` +
        `${referral.buyStatus ?? '-'}/${referral.sellStatus ?? '-'} -> ` +
        `${nextBuyStatus}/${nextSellStatus} status=${nextAggregatedStatus}`
    );

    if (DRY_RUN) {
      repairedCount += 1;
      continue;
    }

    await Referral.updateOne(
      { _id: referral._id },
      {
        $set: {
          buyStatus: nextBuyStatus,
          sellStatus: nextSellStatus,
          status: nextAggregatedStatus,
        },
        $push: { audit: auditEntry },
      }
    );
    repairedCount += 1;
  }

  console.log(
    `[repair-referral-side-statuses] Inspected ${candidates.length} referrals; ` +
      `repaired ${repairedCount}; skipped ${skippedCount}${DRY_RUN ? ' (dry run)' : ''}`
  );
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[repair-referral-side-statuses] Failed:', error);
    process.exit(1);
  });
