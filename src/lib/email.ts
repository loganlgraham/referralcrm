import { Resend } from 'resend';

import { connectMongo } from '@/lib/mongoose';
import { EmailMessage } from '@/models/email-message';
import { partitionByHealth } from '@/lib/server/email-address-health';
import { recordEmailDeliveryFailure } from '@/lib/server/email-delivery-failure';

type EmailContext = {
  referralId?: string | null;
  agentId?: string | null;
  lenderId?: string | null;
};

type EmailPayload = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  scheduledAt?: Date;
  cc?: string[];
  attachments?: Array<{
    filename: string;
    /** Raw bytes as Buffer, or a pre-encoded base64 string. */
    content: Buffer | string;
  }>;
  /** Optional links so a later bounce webhook can be traced back to what it belonged to. */
  context?: EmailContext;
};

export type SendEmailResult = {
  ok: boolean;
  /** Resend's message id, used to correlate delivery webhooks. Null when the send failed. */
  id: string | null;
  error: string | null;
  /** To addresses dropped because they are in a bounce backoff window. */
  withheldTo: string[];
  /** CC addresses dropped because they are in a bounce backoff window. */
  withheldCc: string[];
  /**
   * True when the message was deliberately not sent because every To recipient was bouncing,
   * as opposed to a send that was attempted and failed.
   */
  suppressed: boolean;
};

let resendClient: Resend | null = null;
const EMAIL_RATE_LIMIT_INTERVAL_MS = 600;
let rateLimitChain: Promise<unknown> = Promise.resolve();
let lastSendTimestamp = 0;

function hasResendConfiguration(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function getResendClient(): Resend | null {
  if (!hasResendConfiguration()) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY as string);
  }
  return resendClient;
}

export function isTransactionalEmailConfigured(): boolean {
  return hasResendConfiguration();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function enqueueRateLimited<T>(operation: () => Promise<T>): Promise<T> {
  rateLimitChain = rateLimitChain.then(async () => {
    const now = Date.now();
    const elapsed = now - lastSendTimestamp;
    const waitMs = Math.max(0, EMAIL_RATE_LIMIT_INTERVAL_MS - elapsed);
    if (waitMs > 0) {
      await delay(waitMs);
    }
    lastSendTimestamp = Date.now();
    return operation();
  });

  return rateLimitChain as Promise<T>;
}

type RecordedMessage = {
  resendId: string | null;
  status: 'sent' | 'suppressed';
  to: string[];
  cc: string[];
  withheldTo: string[];
  withheldCc: string[];
};

async function recordMessage(payload: EmailPayload, message: RecordedMessage): Promise<void> {
  try {
    await connectMongo();
    await EmailMessage.create({
      ...message,
      subject: payload.subject,
      referralId: payload.context?.referralId ?? null,
      agentId: payload.context?.agentId ?? null,
      lenderId: payload.context?.lenderId ?? null,
      sentAt: new Date(),
    });
  } catch (error) {
    // Never let bookkeeping stop mail from going out.
    console.error('[Email] Failed to record message', error);
  }
}

export async function sendTransactionalEmailWithResult(
  payload: EmailPayload
): Promise<SendEmailResult> {
  const fromAddress = process.env.EMAIL_FROM;
  const client = getResendClient();
  if (!client || !fromAddress || payload.to.length === 0) {
    return {
      ok: false,
      id: null,
      error: 'Transactional email is not configured.',
      withheldTo: [],
      withheldCc: [],
      suppressed: false,
    };
  }

  // An address that is currently bouncing would fail the whole message, so hold it back until
  // its backoff window lapses rather than letting it mask everyone else's delivery.
  const [toPartition, ccPartition] = await Promise.all([
    partitionByHealth(payload.to),
    partitionByHealth(payload.cc ?? []),
  ]);
  const { healthy: to, withheld: withheldTo } = toPartition;
  const { healthy: cc, withheld: withheldCc } = ccPartition;

  if (withheldCc.length > 0) {
    console.warn(
      `[Email] Withholding bouncing CC recipient(s) from "${payload.subject}": ${withheldCc.join(', ')}`
    );
  }

  // Every intended recipient is in a backoff window, so sending would only add another
  // bounce against the domain's reputation without reaching anyone.
  if (to.length === 0) {
    console.warn(
      `[Email] Suppressing "${payload.subject}": all To recipient(s) are bouncing: ${withheldTo.join(', ')}`
    );
    await recordMessage(payload, {
      resendId: null,
      status: 'suppressed',
      to: [],
      cc,
      withheldTo,
      withheldCc,
    });
    await recordEmailDeliveryFailure({
      referralId: payload.context?.referralId,
      subject: payload.subject,
      recipients: withheldTo,
      reason: null,
      kind: 'suppressed',
    });

    return {
      ok: false,
      id: null,
      error: 'All recipients are currently bouncing, so the message was not sent.',
      withheldTo,
      withheldCc,
      suppressed: true,
    };
  }

  if (withheldTo.length > 0) {
    console.warn(
      `[Email] Withholding bouncing To recipient(s) from "${payload.subject}": ${withheldTo.join(', ')}`
    );
  }

  try {
    const emailOptions: Parameters<Resend['emails']['send']>[0] & { scheduled_at?: string } = {
      from: fromAddress,
      to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    };

    if (cc.length > 0) {
      emailOptions.cc = cc;
    }

    if (payload.scheduledAt) {
      emailOptions.scheduled_at = payload.scheduledAt.toISOString();
    }

    if (payload.attachments && payload.attachments.length > 0) {
      emailOptions.attachments = payload.attachments.map((attachment) => ({
        filename: attachment.filename,
        // Resend accepts Buffer directly. String values must already be base64.
        content: attachment.content,
      }));
    }

    const response = await enqueueRateLimited(() => client.emails.send(emailOptions));

    // The SDK resolves rather than throwing on API rejections, so an unchecked call reports
    // suppressed addresses and invalid recipients as successful sends.
    if (response.error) {
      console.error('Failed to send transactional email', response.error);
      const reason = response.error.message ?? 'Resend rejected the message.';
      await recordEmailDeliveryFailure({
        referralId: payload.context?.referralId,
        subject: payload.subject,
        recipients: to,
        reason,
        kind: 'send_failed',
      });
      return {
        ok: false,
        id: null,
        error: reason,
        withheldTo,
        withheldCc,
        suppressed: false,
      };
    }

    const resendId = response.data?.id ?? null;
    if (resendId) {
      await recordMessage(payload, {
        resendId,
        status: 'sent',
        to,
        cc,
        withheldTo,
        withheldCc,
      });
    }

    return { ok: true, id: resendId, error: null, withheldTo, withheldCc, suppressed: false };
  } catch (error) {
    console.error('Failed to send transactional email', error);
    const reason = error instanceof Error ? error.message : 'Unknown email failure.';
    await recordEmailDeliveryFailure({
      referralId: payload.context?.referralId,
      subject: payload.subject,
      recipients: to,
      reason,
      kind: 'send_failed',
    });
    return {
      ok: false,
      id: null,
      error: reason,
      withheldTo,
      withheldCc,
      suppressed: false,
    };
  }
}

export async function sendTransactionalEmail(payload: EmailPayload): Promise<boolean> {
  const result = await sendTransactionalEmailWithResult(payload);
  return result.ok;
}
