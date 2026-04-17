import { runNoResponseChecks } from '@/lib/server/auto-update-reminders';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { createAdminNotifications } from '@/lib/server/notifications';

jest.mock('@/models/payment', () => ({
  Payment: {
    distinct: jest.fn(),
  },
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

const mockedPaymentDistinct = Payment.distinct as jest.MockedFunction<typeof Payment.distinct>;
const mockedReferralFind = Referral.find as jest.Mock;
const mockedReferralFindByIdAndUpdate = Referral.findByIdAndUpdate as jest.Mock;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;

function mockReferralFindResults(referrals: unknown[]) {
  mockedReferralFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(referrals),
    }),
  });
}

describe('runNoResponseChecks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPaymentDistinct.mockResolvedValue([]);
    mockedReferralFindByIdAndUpdate.mockResolvedValue(undefined);
  });

  it('queries using latest auto/manual request timestamp and 24h cutoff semantics', async () => {
    mockReferralFindResults([]);
    const now = new Date('2026-04-17T16:00:00.000Z');

    await runNoResponseChecks({ now });

    expect(mockedReferralFind).toHaveBeenCalledTimes(1);
    const query = mockedReferralFind.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      autoUpdateRemindersEnabled: true,
      deletedAt: null,
    });

    const expr = query?.$expr;
    expect(expr?.$let?.vars?.latestRequestAt?.$max).toEqual([
      { $ifNull: ['$lastAutoReminderSentAt', new Date(0)] },
      { $ifNull: ['$lastManualReminderSentAt', new Date(0)] },
    ]);
    expect(expr?.$let?.in?.$and).toEqual(
      expect.arrayContaining([
        { $gt: ['$$latestRequestAt', new Date(0)] },
        { $lte: ['$$latestRequestAt', new Date(now.getTime() - 24 * 60 * 60 * 1000)] },
        {
          $or: [
            { $eq: ['$lastUpdateRequestResponseNotifiedAt', null] },
            { $lt: ['$lastUpdateRequestResponseNotifiedAt', '$$latestRequestAt'] },
          ],
        },
      ])
    );
  });

  it('notifies admins when no response after a manual request older than 24h', async () => {
    const now = new Date('2026-04-17T16:00:00.000Z');
    mockReferralFindResults([
      {
        _id: 'ref-manual',
        borrower: { name: 'Manual Borrower' },
        lastAutoReminderSentAt: null,
        lastManualReminderSentAt: new Date('2026-04-16T10:00:00.000Z'),
        lastNoResponse24hNotifiedAt: null,
      },
    ]);

    const results = await runNoResponseChecks({ now });

    expect(results).toEqual([
      {
        referralId: 'ref-manual',
        borrowerName: 'Manual Borrower',
        status: 'notified',
      },
    ]);
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith({
      type: 'checkin_no_response_24h',
      referralId: 'ref-manual',
      borrowerName: 'Manual Borrower',
      actorRole: 'system',
      actorName: 'System',
      content: 'Agent has not responded to update request for Manual Borrower (24+ hours)',
    });
    expect(mockedReferralFindByIdAndUpdate).toHaveBeenCalledWith('ref-manual', {
      $set: { lastNoResponse24hNotifiedAt: now },
    });
  });

  it('skips notification when this reminder cycle was already notified using latest request timestamp', async () => {
    const now = new Date('2026-04-17T16:00:00.000Z');
    mockReferralFindResults([
      {
        _id: 'ref-dedupe',
        borrower: { name: 'Dedupe Borrower' },
        lastAutoReminderSentAt: new Date('2026-04-16T07:00:00.000Z'),
        lastManualReminderSentAt: new Date('2026-04-16T12:00:00.000Z'),
        lastNoResponse24hNotifiedAt: new Date('2026-04-16T12:30:00.000Z'),
      },
    ]);

    const results = await runNoResponseChecks({ now });

    expect(results).toEqual([
      {
        referralId: 'ref-dedupe',
        borrowerName: 'Dedupe Borrower',
        status: 'skipped',
        reason: 'Already notified for this reminder cycle',
      },
    ]);
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
    expect(mockedReferralFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('notifies admins when no response after an automated request older than 24h', async () => {
    const now = new Date('2026-04-17T16:00:00.000Z');
    mockReferralFindResults([
      {
        _id: 'ref-auto',
        borrower: { name: 'Auto Borrower' },
        lastAutoReminderSentAt: new Date('2026-04-16T08:00:00.000Z'),
        lastManualReminderSentAt: null,
        lastNoResponse24hNotifiedAt: null,
      },
    ]);

    const results = await runNoResponseChecks({ now });

    expect(results).toEqual([
      {
        referralId: 'ref-auto',
        borrowerName: 'Auto Borrower',
        status: 'notified',
      },
    ]);
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkin_no_response_24h',
        referralId: 'ref-auto',
      })
    );
  });
});
