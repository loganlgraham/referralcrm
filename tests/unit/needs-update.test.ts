import { describe, expect, it } from '@jest/globals';
import { resolveNeedsUpdate } from '@/utils/sla-insights';

const NOW = new Date('2026-08-26T15:00:00.000Z');

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('resolveNeedsUpdate', () => {
  it('flags an active referral with an unanswered auto reminder', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: daysAgo(17),
      createdAt: daysAgo(20),
      lastAutoReminderSentAt: daysAgo(2),
      lastUpdateRequestResponseNotifiedAt: null,
      now: NOW,
    });

    expect(result.needsUpdate).toBe(true);
    expect(result.daysInStatus).toBe(17);
  });

  it('flags an active referral with an unanswered admin request', () => {
    const result = resolveNeedsUpdate({
      status: 'In Communication',
      statusChangedAt: daysAgo(4),
      createdAt: daysAgo(40),
      lastManualReminderSentAt: daysAgo(1),
      lastUpdateRequestResponseNotifiedAt: null,
      now: NOW,
    });

    expect(result.needsUpdate).toBe(true);
  });

  it('clears after a later lastUpdateRequestResponseNotifiedAt', () => {
    const result = resolveNeedsUpdate({
      status: 'Under Contract',
      statusChangedAt: daysAgo(4),
      createdAt: daysAgo(40),
      lastAutoReminderSentAt: daysAgo(3),
      lastUpdateRequestResponseNotifiedAt: daysAgo(1),
      now: NOW,
    });

    expect(result.needsUpdate).toBe(false);
  });

  it('re-flags when a newer send happens after a response', () => {
    const result = resolveNeedsUpdate({
      status: 'Active Lead',
      statusChangedAt: daysAgo(10),
      createdAt: daysAgo(30),
      lastAutoReminderSentAt: daysAgo(5),
      lastManualReminderSentAt: daysAgo(1),
      lastUpdateRequestResponseNotifiedAt: daysAgo(4),
      now: NOW,
    });

    expect(result.needsUpdate).toBe(true);
  });

  it('never flags Closed, Lost, or Terminated even with an unanswered request', () => {
    for (const status of ['Closed', 'Lost', 'Terminated']) {
      const result = resolveNeedsUpdate({
        status,
        statusChangedAt: daysAgo(200),
        createdAt: daysAgo(400),
        lastAutoReminderSentAt: daysAgo(1),
        lastUpdateRequestResponseNotifiedAt: null,
        now: NOW,
      });

      expect(result.needsUpdate).toBe(false);
    }
  });

  it('never flags an active file with no send', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: daysAgo(17),
      createdAt: daysAgo(20),
      lastNoteAt: null,
      now: NOW,
    });

    expect(result.needsUpdate).toBe(false);
    expect(result.hasNoteSinceStatusChange).toBe(false);
    expect(result.daysInStatus).toBe(17);
  });

  it('still reports daysInStatus from referralDate when the status never changed', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: null,
      createdAt: daysAgo(3),
      referralDate: daysAgo(60),
      lastAutoReminderSentAt: daysAgo(1),
      now: NOW,
    });

    expect(result.daysInStatus).toBe(60);
    expect(result.needsUpdate).toBe(true);
  });

  it('returns a zeroed result when there are no timestamps at all', () => {
    const result = resolveNeedsUpdate({ status: 'Paired', now: NOW });

    expect(result.daysInStatus).toBe(0);
    expect(result.hasNoteSinceStatusChange).toBe(false);
    expect(result.needsUpdate).toBe(false);
  });

  it('does not report a negative day count for a future status change', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: new Date(NOW.getTime() + 86_400_000),
      createdAt: daysAgo(10),
      now: NOW,
    });

    expect(result.daysInStatus).toBe(0);
    expect(result.needsUpdate).toBe(false);
  });
});
