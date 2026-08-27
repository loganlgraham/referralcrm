/**
 * Shared “pending update request” signal used by the agent Waiting on you list,
 * the admin No action yet chip, and the admin-notify-on-response path.
 *
 * Pending means an auto or manual request email was sent, and no agent CRM
 * action has been recorded for that send yet.
 */

export interface UpdateRequestPendingInput {
  lastAutoReminderSentAt?: string | Date | null;
  lastManualReminderSentAt?: string | Date | null;
  lastUpdateRequestResponseNotifiedAt?: string | Date | null;
}

const toTime = (value?: string | Date | null): number => {
  if (value == null || value === '') {
    return 0;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const getLastUpdateRequestSentAt = (
  input: UpdateRequestPendingInput
): Date | null => {
  const lastRequest = Math.max(
    toTime(input.lastAutoReminderSentAt),
    toTime(input.lastManualReminderSentAt)
  );
  return lastRequest > 0 ? new Date(lastRequest) : null;
};

export const hasPendingUpdateRequest = (input: UpdateRequestPendingInput): boolean => {
  const lastRequest = Math.max(
    toTime(input.lastAutoReminderSentAt),
    toTime(input.lastManualReminderSentAt)
  );
  if (lastRequest === 0) {
    return false;
  }
  return toTime(input.lastUpdateRequestResponseNotifiedAt) < lastRequest;
};
