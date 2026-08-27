import { describe, expect, it } from '@jest/globals';
import { NEEDS_UPDATE_THRESHOLD_DAYS, resolveNeedsUpdate } from '@/utils/sla-insights';

const NOW = new Date('2026-08-26T15:00:00.000Z');

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('resolveNeedsUpdate', () => {
  it('flags an active referral with no note since the status change', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: daysAgo(17),
      createdAt: daysAgo(20),
      lastNoteAt: null,
      now: NOW,
    });

    expect(result.needsUpdate).toBe(true);
    expect(result.hasNoteSinceStatusChange).toBe(false);
    expect(result.daysInStatus).toBe(17);
  });

  it('clears an active referral with a note logged after the status change and under the threshold', () => {
    const result = resolveNeedsUpdate({
      status: 'Under Contract',
      statusChangedAt: daysAgo(4),
      createdAt: daysAgo(40),
      lastNoteAt: daysAgo(2),
      now: NOW,
    });

    expect(result.hasNoteSinceStatusChange).toBe(true);
    expect(result.daysInStatus).toBe(4);
    expect(result.needsUpdate).toBe(false);
  });

  it('flags an active referral that has a recent note but exceeds the status threshold', () => {
    const daysInStatus = NEEDS_UPDATE_THRESHOLD_DAYS['Under Contract'] + 1;
    const result = resolveNeedsUpdate({
      status: 'Under Contract',
      statusChangedAt: daysAgo(daysInStatus),
      createdAt: daysAgo(90),
      lastNoteAt: daysAgo(1),
      now: NOW,
    });

    expect(result.hasNoteSinceStatusChange).toBe(true);
    expect(result.daysInStatus).toBe(daysInStatus);
    expect(result.needsUpdate).toBe(true);
  });

  it('treats a note written before the status change as stale', () => {
    const result = resolveNeedsUpdate({
      status: 'In Communication',
      statusChangedAt: daysAgo(1),
      createdAt: daysAgo(30),
      lastNoteAt: daysAgo(5),
      now: NOW,
    });

    expect(result.hasNoteSinceStatusChange).toBe(false);
    expect(result.needsUpdate).toBe(true);
  });

  it('normalizes the legacy Showing Homes alias onto the Active Lead threshold', () => {
    const withinThreshold = resolveNeedsUpdate({
      status: 'Showing Homes',
      statusChangedAt: daysAgo(NEEDS_UPDATE_THRESHOLD_DAYS['Active Lead']),
      createdAt: daysAgo(30),
      lastNoteAt: daysAgo(1),
      now: NOW,
    });

    expect(withinThreshold.needsUpdate).toBe(false);
  });

  it('never flags a referral that is not in an active status', () => {
    for (const status of ['New Lead', 'Closed', 'Lost', 'Terminated']) {
      const result = resolveNeedsUpdate({
        status,
        statusChangedAt: daysAgo(200),
        createdAt: daysAgo(400),
        lastNoteAt: null,
        now: NOW,
      });

      expect(result.needsUpdate).toBe(false);
    }
  });

  it('anchors on the earliest of referralDate and createdAt when the status never changed', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: null,
      createdAt: daysAgo(3),
      referralDate: daysAgo(60),
      lastNoteAt: null,
      now: NOW,
    });

    expect(result.daysInStatus).toBe(60);
    expect(result.needsUpdate).toBe(true);
  });

  it('returns a zeroed result when there are no timestamps at all', () => {
    const result = resolveNeedsUpdate({ status: 'Paired', now: NOW });

    expect(result.daysInStatus).toBe(0);
    expect(result.hasNoteSinceStatusChange).toBe(false);
    expect(result.needsUpdate).toBe(true);
  });

  it('does not report a negative day count for a future status change', () => {
    const result = resolveNeedsUpdate({
      status: 'Paired',
      statusChangedAt: new Date(NOW.getTime() + 86_400_000),
      createdAt: daysAgo(10),
      now: NOW,
    });

    expect(result.daysInStatus).toBe(0);
  });
});
