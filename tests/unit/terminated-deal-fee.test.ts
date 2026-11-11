import {
  resolveTerminatedDealLostFeeCents,
  resolveTerminationReportDate,
  resolveTerminationSnapshotUpdate,
} from '@/lib/server/terminated-deal-fee';

describe('resolveTerminationSnapshotUpdate', () => {
  const now = new Date('2026-11-11T15:00:00.000Z');

  it('captures the fee and time on a fresh termination', () => {
    expect(
      resolveTerminationSnapshotUpdate({
        previousStatus: 'clear_to_close',
        nextStatus: 'terminated',
        expectedAmountBeforeTerminationCents: 375_000,
        now,
      })
    ).toEqual({ terminatedAt: now, terminatedExpectedAmountCents: 375_000 });
  });

  it('captures a legitimate $0 fee', () => {
    expect(
      resolveTerminationSnapshotUpdate({
        previousStatus: 'under_contract',
        nextStatus: 'terminated',
        expectedAmountBeforeTerminationCents: 0,
        now,
      })
    ).toEqual({ terminatedAt: now, terminatedExpectedAmountCents: 0 });
  });

  it('leaves an existing snapshot alone on retry or reason edit', () => {
    expect(
      resolveTerminationSnapshotUpdate({
        previousStatus: 'terminated',
        nextStatus: 'terminated',
        expectedAmountBeforeTerminationCents: 0,
        now,
      })
    ).toEqual({});
    expect(
      resolveTerminationSnapshotUpdate({
        previousStatus: 'terminated',
        nextStatus: undefined,
        expectedAmountBeforeTerminationCents: 0,
        now,
      })
    ).toEqual({});
  });

  it('clears the snapshot on reactivation', () => {
    expect(
      resolveTerminationSnapshotUpdate({
        previousStatus: 'terminated',
        nextStatus: 'under_contract',
        expectedAmountBeforeTerminationCents: 0,
        now,
      })
    ).toEqual({ terminatedAt: null, terminatedExpectedAmountCents: null });
  });
});

describe('resolveTerminatedDealLostFeeCents', () => {
  it('uses the saved amount, including $0, over any recoverable data', () => {
    const dealInputs = { contractPriceCents: 50_000_000, commissionBasisPoints: 300, referralFeeBasisPoints: 2500 };
    expect(resolveTerminatedDealLostFeeCents({ ...dealInputs, terminatedExpectedAmountCents: 412_500 })).toBe(412_500);
    expect(resolveTerminatedDealLostFeeCents({ ...dealInputs, terminatedExpectedAmountCents: 0 })).toBe(0);
  });

  it('recovers older deals from their own price, commission, and referral-fee inputs', () => {
    expect(
      resolveTerminatedDealLostFeeCents({
        expectedAmountCents: 0,
        contractPriceCents: 40_000_000,
        commissionBasisPoints: 300,
        referralFeeBasisPoints: 2500,
      })
    ).toBe(300_000);
    expect(
      resolveTerminatedDealLostFeeCents({ commissionFlatFeeCents: 1_000_000, referralFeeBasisPoints: 2500 })
    ).toBe(250_000);
  });

  it('uses an uncleared fee left on an older deal', () => {
    expect(resolveTerminatedDealLostFeeCents({ expectedAmountCents: 180_000 })).toBe(180_000);
  });

  it('returns $0 for older deals without reliable deal-level data', () => {
    expect(resolveTerminatedDealLostFeeCents({ expectedAmountCents: 0, referralFeeBasisPoints: null })).toBe(0);
    expect(
      resolveTerminatedDealLostFeeCents({ contractPriceCents: 40_000_000, commissionBasisPoints: 300, referralFeeBasisPoints: 0 })
    ).toBe(0);
    expect(
      resolveTerminatedDealLostFeeCents({
        expectedAmountCents: 200_000,
        usedAssignedAgent: false,
        agentAttribution: 'OUTSIDE_AGENT',
      })
    ).toBe(0);
    expect(
      resolveTerminatedDealLostFeeCents({ expectedAmountCents: 200_000, referral: { origin: 'agent' } })
    ).toBe(0);
  });
});

describe('resolveTerminationReportDate', () => {
  const legacyDate = new Date('2026-07-01T12:00:00.000Z');

  it('prefers the termination time over the generic payment date', () => {
    const terminatedAt = new Date('2026-11-11T15:00:00.000Z');
    expect(resolveTerminationReportDate({ terminatedAt }, legacyDate)).toEqual(terminatedAt);
  });

  it('falls back to the generic payment date for older deals', () => {
    expect(resolveTerminationReportDate({ terminatedAt: null }, legacyDate)).toBe(legacyDate);
    expect(resolveTerminationReportDate({}, legacyDate)).toBe(legacyDate);
  });
});
