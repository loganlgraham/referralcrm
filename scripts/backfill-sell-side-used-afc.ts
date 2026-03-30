import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

async function run() {
  await connectMongo();

  const directSellResult = await Payment.updateMany(
    {
      side: 'sell',
      usedAfc: { $ne: false },
    },
    {
      $set: { usedAfc: false },
    }
  );

  const candidatePayments = await Payment.find({
    $or: [{ side: null }, { side: { $exists: false } }],
    usedAfc: { $ne: false },
  })
    .select('_id referralId')
    .lean<{ _id: Types.ObjectId; referralId?: Types.ObjectId | null }[]>();

  const referralIds = [
    ...new Set(
      candidatePayments
        .map((payment) => payment.referralId?.toString())
        .filter((value): value is string => Boolean(value))
    ),
  ];

  let inferredSellResult = { matchedCount: 0, modifiedCount: 0 };

  if (referralIds.length > 0) {
    const referrals = await Referral.find({
      _id: { $in: referralIds.map((id) => new Types.ObjectId(id)) },
    })
      .select('_id clientType dealSide')
      .lean<{ _id: Types.ObjectId; clientType?: string | null; dealSide?: 'buy' | 'sell' | null }[]>();

    const sellReferralIds = new Set(
      referrals
        .filter((referral) => referral.clientType === 'Seller' || referral.dealSide === 'sell')
        .map((referral) => referral._id.toString())
    );

    const paymentIdsToNormalize = candidatePayments
      .filter((payment) => {
        const referralId = payment.referralId?.toString();
        return referralId ? sellReferralIds.has(referralId) : false;
      })
      .map((payment) => payment._id);

    if (paymentIdsToNormalize.length > 0) {
      const updateResult = await Payment.updateMany(
        { _id: { $in: paymentIdsToNormalize }, usedAfc: { $ne: false } },
        { $set: { usedAfc: false } }
      );
      inferredSellResult = {
        matchedCount: updateResult.matchedCount ?? 0,
        modifiedCount: updateResult.modifiedCount ?? 0,
      };
    }
  }

  console.log(
    `[backfill-sell-side-used-afc] Direct sell updates: matched=${directSellResult.matchedCount ?? 0}, modified=${
      directSellResult.modifiedCount ?? 0
    }`
  );
  console.log(
    `[backfill-sell-side-used-afc] Inferred sell updates (missing side): matched=${inferredSellResult.matchedCount}, modified=${inferredSellResult.modifiedCount}`
  );
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[backfill-sell-side-used-afc] Failed:', error);
    process.exit(1);
  });
