import { Referral } from '@/models/referral';
import { calculateBusinessMinutesBetween } from '@/utils/sla-insights';

/** Record the first observed attempt and conversation independently. A conversation is also an attempt. */
export async function recordContactTiming(
  referralId: unknown,
  pairedAt: Date,
  eventAt: Date,
  reached: boolean,
) {
  const minutes = calculateBusinessMinutesBetween(pairedAt, eventAt);
  if (minutes == null || eventAt < pairedAt) return;
  const hours = Math.round(minutes / 6) / 10;
  const firstFields = (dateKey: string, hoursKey: string) => {
    const date = `sla.${dateKey}`;
    const duration = `sla.${hoursKey}`;
    // A historical duration without its original timestamp is still a real measurement.
    const earlier = {
      $or: [
        {
          $and: [
            { $eq: [{ $ifNull: [`$${date}`, null] }, null] },
            { $eq: [{ $ifNull: [`$${duration}`, null] }, null] },
          ],
        },
        { $gt: [`$${date}`, eventAt] },
      ],
    };
    return {
      [date]: { $cond: [earlier, eventAt, `$${date}`] },
      [duration]: { $cond: [earlier, hours, `$${duration}`] },
    };
  };
  await Referral.updateOne({ _id: referralId }, [
    {
      $set: {
        ...firstFields('firstAgentAttemptAt', 'timeToFirstAgentAttemptHours'),
        ...(reached
          ? firstFields(
              'firstSuccessfulContactAt',
              'timeToFirstAgentContactHours',
            )
          : {}),
      },
    },
  ]);
}
