import { describe, expect, it } from '@jest/globals';
import {
  getLastUpdateRequestSentAt,
  hasPendingUpdateRequest,
} from '@/utils/update-request-pending';

const AUTO = new Date('2026-08-20T15:00:00.000Z');
const MANUAL = new Date('2026-08-22T15:00:00.000Z');
const BEFORE = new Date('2026-08-19T15:00:00.000Z');
const AFTER = new Date('2026-08-23T15:00:00.000Z');

describe('getLastUpdateRequestSentAt', () => {
  it('returns null when no request has been sent', () => {
    expect(getLastUpdateRequestSentAt({})).toBeNull();
    expect(
      getLastUpdateRequestSentAt({
        lastAutoReminderSentAt: null,
        lastManualReminderSentAt: null,
      })
    ).toBeNull();
  });

  it('returns the later of auto and manual sends', () => {
    expect(
      getLastUpdateRequestSentAt({
        lastAutoReminderSentAt: AUTO,
        lastManualReminderSentAt: MANUAL,
      })
    ).toEqual(MANUAL);

    expect(
      getLastUpdateRequestSentAt({
        lastAutoReminderSentAt: AUTO,
        lastManualReminderSentAt: null,
      })
    ).toEqual(AUTO);
  });
});

describe('hasPendingUpdateRequest', () => {
  it('is false when no email has been sent', () => {
    expect(hasPendingUpdateRequest({})).toBe(false);
  });

  it('is true when an auto send has no later response', () => {
    expect(
      hasPendingUpdateRequest({
        lastAutoReminderSentAt: AUTO,
        lastManualReminderSentAt: null,
        lastUpdateRequestResponseNotifiedAt: null,
      })
    ).toBe(true);
  });

  it('is true when a manual send has no later response', () => {
    expect(
      hasPendingUpdateRequest({
        lastAutoReminderSentAt: null,
        lastManualReminderSentAt: MANUAL,
        lastUpdateRequestResponseNotifiedAt: null,
      })
    ).toBe(true);
  });

  it('is false when the agent responded after the latest send', () => {
    expect(
      hasPendingUpdateRequest({
        lastAutoReminderSentAt: AUTO,
        lastManualReminderSentAt: MANUAL,
        lastUpdateRequestResponseNotifiedAt: AFTER,
      })
    ).toBe(false);
  });

  it('is true again when a newer send happens after a response', () => {
    expect(
      hasPendingUpdateRequest({
        lastAutoReminderSentAt: AUTO,
        lastManualReminderSentAt: MANUAL,
        lastUpdateRequestResponseNotifiedAt: BEFORE,
      })
    ).toBe(true);
  });

  it('treats a response timestamp equal to the send as already answered', () => {
    expect(
      hasPendingUpdateRequest({
        lastAutoReminderSentAt: AUTO,
        lastUpdateRequestResponseNotifiedAt: AUTO,
      })
    ).toBe(false);
  });
});
