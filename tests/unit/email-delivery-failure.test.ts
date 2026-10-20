import { recordEmailDeliveryFailure } from '@/lib/server/email-delivery-failure';
import { logReferralActivity } from '@/lib/server/activities';
import { createAdminNotifications } from '@/lib/server/notifications';
import { Notification } from '@/models/notification';
import { Referral } from '@/models/referral';

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn(),
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn(),
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(),
  },
}));

jest.mock('@/models/notification', () => ({
  Notification: {
    find: jest.fn(),
  },
}));

const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<
  typeof logReferralActivity
>;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
>;
const mockedReferralFindById = Referral.findById as jest.Mock;
const mockedNotificationFind = Notification.find as jest.Mock;

const REFERRAL_ID = '507f1f77bcf86cd799439011';

const stubReferral = (referral: unknown) => {
  mockedReferralFindById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(referral),
    }),
  });
};

/** Existing bell items inside the dedupe window. */
const stubRecentNotifications = (notifications: { content: string }[]) => {
  mockedNotificationFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(notifications),
    }),
  });
};

const baseOptions = {
  referralId: REFERRAL_ID as string | null,
  subject: 'Scheduled Update: Jane Doe',
  recipients: ['agent@example.com'],
  reason: 'Mailbox full' as string | null,
};

describe('recordEmailDeliveryFailure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubReferral({ borrower: { name: 'Jane Doe' } });
    stubRecentNotifications([]);
  });

  it('logs a timeline note and notifies admins when a message bounces', async () => {
    await recordEmailDeliveryFailure({ ...baseOptions, kind: 'bounced' });

    expect(mockedLogReferralActivity).toHaveBeenCalledTimes(1);
    expect(mockedLogReferralActivity.mock.calls[0][0]).toMatchObject({
      channel: 'email',
      actorRole: null,
      content:
        '"Scheduled Update: Jane Doe" could not be delivered to agent@example.com. Reason: Mailbox full',
    });

    expect(mockedCreateAdminNotifications).toHaveBeenCalledTimes(1);
    expect(mockedCreateAdminNotifications.mock.calls[0][0]).toMatchObject({
      type: 'email_delivery_failed',
      borrowerName: 'Jane Doe',
      actorRole: 'system',
      actorName: 'System',
      content:
        '"Scheduled Update: Jane Doe" could not be delivered to agent@example.com. Reason: Mailbox full',
    });
  });

  it('describes a spam complaint differently from a bounce', async () => {
    await recordEmailDeliveryFailure({ ...baseOptions, reason: null, kind: 'complained' });

    expect(mockedCreateAdminNotifications.mock.calls[0][0].content).toBe(
      '"Scheduled Update: Jane Doe" was marked as spam by agent@example.com.'
    );
  });

  it('explains a suppressed send as a repeat bouncer', async () => {
    await recordEmailDeliveryFailure({ ...baseOptions, reason: null, kind: 'suppressed' });

    expect(mockedCreateAdminNotifications.mock.calls[0][0].content).toBe(
      '"Scheduled Update: Jane Doe" was not sent to agent@example.com because that address keeps bouncing.'
    );
  });

  it('reports a rejected send as never leaving the building', async () => {
    await recordEmailDeliveryFailure({
      ...baseOptions,
      reason: 'Invalid recipient',
      kind: 'send_failed',
    });

    expect(mockedCreateAdminNotifications.mock.calls[0][0].content).toBe(
      '"Scheduled Update: Jane Doe" could not be sent to agent@example.com. Reason: Invalid recipient'
    );
  });

  it('falls back to a generic recipient when Resend does not name one', async () => {
    await recordEmailDeliveryFailure({ ...baseOptions, recipients: [], kind: 'bounced' });

    expect(mockedCreateAdminNotifications.mock.calls[0][0].content).toBe(
      '"Scheduled Update: Jane Doe" could not be delivered to a recipient. Reason: Mailbox full'
    );
  });

  it('still records the timeline note but skips a duplicate bell for a retried message', async () => {
    stubRecentNotifications([
      {
        content:
          '"Scheduled Update: Jane Doe" could not be delivered to agent@example.com. Reason: Mailbox full',
      },
    ]);

    await recordEmailDeliveryFailure({ ...baseOptions, kind: 'bounced' });

    expect(mockedLogReferralActivity).toHaveBeenCalledTimes(1);
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
  });

  it('notifies when a recent failure was for a different email', async () => {
    stubRecentNotifications([
      { content: '"Welcome to Referrio" could not be delivered to agent@example.com.' },
    ]);

    await recordEmailDeliveryFailure({ ...baseOptions, kind: 'bounced' });

    expect(mockedCreateAdminNotifications).toHaveBeenCalledTimes(1);
  });

  it('does nothing for mail that is not tied to a referral', async () => {
    await recordEmailDeliveryFailure({ ...baseOptions, referralId: null, kind: 'bounced' });

    expect(mockedReferralFindById).not.toHaveBeenCalled();
    expect(mockedLogReferralActivity).not.toHaveBeenCalled();
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
  });

  it('does nothing when the referral no longer exists', async () => {
    stubReferral(null);

    await recordEmailDeliveryFailure({ ...baseOptions, kind: 'bounced' });

    expect(mockedLogReferralActivity).not.toHaveBeenCalled();
    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
  });

  it('never lets a bookkeeping failure escape to the caller', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedReferralFindById.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await expect(
      recordEmailDeliveryFailure({ ...baseOptions, kind: 'bounced' })
    ).resolves.toBeUndefined();

    expect(mockedCreateAdminNotifications).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
