import { Types } from 'mongoose';
import { Referral } from '@/models/referral';
import { createAdminNotifications } from '@/lib/server/notifications';

interface MaybeNotifyParams {
  referral: {
    _id: Types.ObjectId | string;
    lastAutoReminderSentAt?: Date | null;
    lastManualReminderSentAt?: Date | null;
    lastUpdateRequestResponseNotifiedAt?: Date | null;
    borrower?: { name?: string };
  };
  actorRole: string;
  actorName: string;
  actionAt: Date;
  actionSummary: string;
}

/**
 * Conditionally creates admin notifications when an agent takes action
 * after an update request email was sent.
 * 
 * Rules:
 * - Only triggers for agent actions (actorRole === 'agent')
 * - Only triggers if there was a previous update request (manual or auto)
 * - Only triggers if the action happened after the request
 * - Only triggers once per request cycle (deduplicated)
 * 
 * @returns true if notification was created, false otherwise
 */
export async function maybeNotifyAdminsOnUpdateRequestResponse({
  referral,
  actorRole,
  actorName,
  actionAt,
  actionSummary,
}: MaybeNotifyParams): Promise<boolean> {
  // Only notify for agent actions
  if (actorRole !== 'agent') {
    return false;
  }

  // Calculate the most recent request sent time
  const lastAutoTime = referral.lastAutoReminderSentAt
    ? new Date(referral.lastAutoReminderSentAt).getTime()
    : 0;
  const lastManualTime = referral.lastManualReminderSentAt
    ? new Date(referral.lastManualReminderSentAt).getTime()
    : 0;
  const lastRequestSentAt = Math.max(lastAutoTime, lastManualTime);

  // No request was ever sent
  if (lastRequestSentAt === 0) {
    return false;
  }

  const lastRequestSentDate = new Date(lastRequestSentAt);
  const actionTime = actionAt.getTime();

  // Action happened before or at the same time as the request
  if (actionTime <= lastRequestSentAt) {
    return false;
  }

  // Check if we already notified for this request cycle
  const lastNotifiedTime = referral.lastUpdateRequestResponseNotifiedAt
    ? new Date(referral.lastUpdateRequestResponseNotifiedAt).getTime()
    : 0;

  // Already notified for this request
  if (lastNotifiedTime >= lastRequestSentAt) {
    return false;
  }

  // Create notification for all admins
  const borrowerName = referral.borrower?.name || 'a referral';
  await createAdminNotifications({
    type: 'update_request_response',
    referralId: referral._id,
    borrowerName,
    actorRole,
    actorName,
    content: `${actorName} responded to update request: ${actionSummary}`,
  });

  // Update the referral to mark that we've notified for this request
  await Referral.findByIdAndUpdate(referral._id, {
    $set: { lastUpdateRequestResponseNotifiedAt: actionAt },
  });

  return true;
}
