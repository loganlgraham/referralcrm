import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { EmailMessage, type EmailMessageStatus } from '@/models/email-message';
import { logReferralActivity } from '@/lib/server/activities';
import { recordBounce, recordDelivery } from '@/lib/server/email-address-health';
import {
  resolveResendSignatureHeader,
  resolveResendTimestampHeader,
  verifyResendWebhookSignature
} from '@/lib/server/resend-webhook-signature';

const HANDLED_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.delivery_delayed'
] as const;

type HandledEvent = (typeof HANDLED_EVENTS)[number];

const isHandledEvent = (value: string): value is HandledEvent =>
  (HANDLED_EVENTS as readonly string[]).includes(value);

function resolveStatus(event: HandledEvent): EmailMessageStatus {
  switch (event) {
    case 'email.sent':
      return 'sent';
    case 'email.delivered':
      return 'delivered';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    case 'email.delivery_delayed':
      return 'delayed';
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function resolveEventSecret(): string | undefined {
  return process.env.RESEND_EVENTS_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET;
}

const EMAIL_IN_TEXT = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g;

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

/**
 * Resend reports a bounce against the whole message rather than naming the recipient, so a
 * CC address that fails makes the message look bounced for everyone on it. Pull the address
 * out of the bounce text when possible and only act when it maps to a known recipient; if it
 * stays ambiguous we would rather record nothing than suppress an address that is fine.
 */
function resolveFailedRecipients(
  bounceMessage: string | null,
  knownRecipients: string[]
): string[] {
  const normalizedKnown = knownRecipients.map((entry) => entry.toLowerCase());

  if (bounceMessage) {
    const mentioned = (bounceMessage.match(EMAIL_IN_TEXT) ?? []).map((entry) =>
      entry.toLowerCase()
    );
    const matched = normalizedKnown.filter((recipient) => mentioned.includes(recipient));
    if (matched.length > 0) {
      return matched;
    }
  }

  // With a single recipient there is nothing to disambiguate.
  return normalizedKnown.length === 1 ? normalizedKnown : [];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = resolveEventSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'Email event signing secret is not configured.' },
      { status: 500 }
    );
  }

  const signatureHeader = resolveResendSignatureHeader(request.headers);
  if (!signatureHeader) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const timestampHeader = resolveResendTimestampHeader(request.headers);
  const svixMessageId = request.headers.get('svix-id') ?? undefined;
  const rawBody = await request.text();

  if (
    !verifyResendWebhookSignature(rawBody, signatureHeader, secret, timestampHeader, svixMessageId)
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Unable to parse event payload.' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Event payload is malformed.' }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const eventType = typeof record.type === 'string' ? record.type : '';
  if (!isHandledEvent(eventType)) {
    return NextResponse.json({ status: 'ignored', reason: 'event_type_unhandled' }, { status: 200 });
  }

  const data = (record.data ?? {}) as Record<string, unknown>;
  const resendId = typeof data.email_id === 'string' ? data.email_id : null;
  if (!resendId) {
    return NextResponse.json({ status: 'ignored', reason: 'missing_email_id' }, { status: 200 });
  }

  const status = resolveStatus(eventType);
  const bounce = (data.bounce ?? {}) as Record<string, unknown>;
  const bounceMessage = typeof bounce.message === 'string' ? bounce.message : null;

  try {
    await connectMongo();

    const message = await EmailMessage.findOne({ resendId })
      .select('to cc referralId subject')
      .lean<{
        to?: string[];
        cc?: string[];
        referralId?: unknown;
        subject?: string;
      } | null>();

    // Fall back to the payload for messages sent before we started recording them.
    const knownRecipients = message
      ? [...(message.to ?? []), ...(message.cc ?? [])]
      : [...toStringArray(data.to), ...toStringArray(data.cc)];

    const isFailure = status === 'bounced' || status === 'complained';
    const failedRecipients = isFailure
      ? resolveFailedRecipients(bounceMessage, knownRecipients)
      : [];

    await EmailMessage.updateOne(
      { resendId },
      {
        $set: {
          status,
          lastEventAt: new Date(),
          ...(isFailure
            ? { failedRecipients, failureReason: bounceMessage }
            : {}),
        },
      }
    );

    if (isFailure && failedRecipients.length > 0) {
      await recordBounce(failedRecipients, bounceMessage);
    }

    if (status === 'delivered') {
      await recordDelivery(knownRecipients);
    }

    if (isFailure && message?.referralId) {
      const who =
        failedRecipients.length > 0 ? failedRecipients.join(', ') : 'a recipient';
      const subject = message.subject ? `"${message.subject}"` : 'an email';
      const detail = bounceMessage ? ` Reason: ${bounceMessage}` : '';
      const verb = status === 'complained' ? 'was marked as spam by' : 'could not be delivered to';
      await logReferralActivity({
        referralId: message.referralId as never,
        actorRole: null,
        channel: 'email',
        content: `${subject} ${verb} ${who}.${detail}`,
      });
    }

    if (isFailure) {
      console.warn(
        `[EmailEvents] ${status} for ${resendId}` +
          (failedRecipients.length > 0
            ? ` (${failedRecipients.join(', ')})`
            : ' (recipient could not be identified)') +
          (bounceMessage ? `: ${bounceMessage}` : '')
      );
    }
  } catch (error) {
    console.error('[EmailEvents] Failed to process event', error);
    // Still acknowledge so Resend does not retry or disable the endpoint over our own bug.
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
