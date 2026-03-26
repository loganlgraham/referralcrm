import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';

async function run() {
  await connectMongo();

  const referrals = await Referral.find({}).select('_id status buyStatus sellStatus').lean<
    { _id: { toString(): string }; status?: string | null; buyStatus?: string | null; sellStatus?: string | null }[]
  >();

  let updatedCount = 0;

  for (const referral of referrals) {
    const fallbackStatus = referral.status ?? 'New Lead';
    const nextBuyStatus = referral.buyStatus ?? fallbackStatus;
    const nextSellStatus = referral.sellStatus ?? fallbackStatus;

    const shouldUpdate =
      referral.buyStatus !== nextBuyStatus || referral.sellStatus !== nextSellStatus;

    if (!shouldUpdate) {
      continue;
    }

    await Referral.updateOne(
      { _id: referral._id },
      {
        $set: {
          buyStatus: nextBuyStatus,
          sellStatus: nextSellStatus,
        },
      }
    );
    updatedCount += 1;
  }

  console.log(`[backfill-referral-side-statuses] Updated ${updatedCount} referrals`);
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[backfill-referral-side-statuses] Failed:', error);
    process.exit(1);
  });
