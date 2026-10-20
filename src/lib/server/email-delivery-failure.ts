import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { logReferralActivity } from '@/lib/server/activities';
import { createAdminNotifications } from '@/lib/server/notifications';
import { Notification } from '@/models/notification';
import { Referral } from '@/models/referral';

export type EmailFailureKind = 'bounced' | 'complained' | 'suppressed' | 'send_failed';

interface RecordEmailDeliveryFailureOptions {
  referralId: Types.ObjectId | string | null | undefined;
  subject: string | null | undefined;
  /** The addresses that did not receive the message. May be empty when Resend does not name them. */
  recipients: string[];
  reason: string | null | undefined;
  kind: EmailFailureKind;
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function describeFailure(kind: EmailFailureKind, recipients: string[]): string {
  const who = recipients.length > 0 ? recipients.join(', ') : 'a recipient';

  switch (kind) {
    case 'bounced':
      return `could not be delivered to ${who}`;
    case 'complained':
      return `was marked as spam by ${who}`;
    case 'suppressed':
      return `was not sent to ${who} because that address keeps bouncing`;
    case 'send_failed':
      return `could not be sent to ${who}`;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Records an undelivered email on the referral timeline and rings the admin bell.
 *
 * Only referral-linked mail is reported, since a notification has to point somewhere the
 * reader can open. Everything is best-effort: a failure here must never take down the send
 * or webhook that called it.
 */
export async function recordEmailDeliveryFailure({
  referralId,
  subject,
  recipients,
  reason,
  kind,
}: RecordEmailDeliveryFailureOptions): Promise<void> {
  if (!referralId) {
    return;
  }

  try {
    await connectMongo();

    const normalizedReferralId =
      typeof referralId === 'string' && Types.ObjectId.isValid(referralId)
        ? new Types.ObjectId(referralId)
        : referralId;

    const referral = await Referral.findById(normalizedReferralId)
      .select('borrower.name')
      .lean<{ borrower?: { name?: string } } | null>();

    if (!referral) {
      return;
    }

    const borrowerName = referral.borrower?.name || 'a referral';
    // Quoting the subject also gives the dedupe check below something stable to match on.
    const subjectLabel = subject ? `"${subject}"` : 'An email';
    const detail = reason ? ` Reason: ${reason}` : '';
    const content = `${subjectLabel} ${describeFailure(kind, recipients)}.${detail}`;

    await logReferralActivity({
      referralId: normalizedReferralId,
      actorRole: null,
      channel: 'email',
      content,
    });

    // A retried message would otherwise stack up an identical bell item each attempt.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await Notification.find({
      referralId: normalizedReferralId,
      type: 'email_delivery_failed',
      createdAt: { $gte: since },
    })
      .select('content')
      .lean<{ content: string }[]>();

    const alreadyNotified = recent.some((notification) =>
      notification.content.startsWith(`${subjectLabel} `)
    );

    if (alreadyNotified) {
      return;
    }

    await createAdminNotifications({
      type: 'email_delivery_failed',
      referralId: normalizedReferralId,
      borrowerName,
      actorRole: 'system',
      actorName: 'System',
      content,
    });
  } catch (error) {
    console.error('[EmailDeliveryFailure] Failed to record undelivered email', error);
  }
}
