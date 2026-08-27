import { Types } from 'mongoose';
import { Referral } from '@/models/referral';
import { createAdminNotifications } from '@/lib/server/notifications';
import {
  getLastUpdateRequestSentAt,
  hasPendingUpdateRequest,
} from '@/utils/update-request-pending';

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

  if (!hasPendingUpdateRequest(referral)) {
    return false;
  }

  const lastRequestSentAt = getLastUpdateRequestSentAt(referral);
  if (!lastRequestSentAt) {
    return false;
  }

  // Action happened before or at the same time as the request
  if (actionAt.getTime() <= lastRequestSentAt.getTime()) {
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
