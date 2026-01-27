import { Resend } from 'resend';

type EmailPayload = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  scheduledAt?: Date;
  cc?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer | string; // base64 string or Buffer
  }>;
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

export async function sendTransactionalEmail(payload: EmailPayload): Promise<boolean> {
  const fromAddress = process.env.EMAIL_FROM;
  const client = getResendClient();
  if (!client || !fromAddress || payload.to.length === 0) {
    return false;
  }

  try {
    const emailOptions: Parameters<Resend['emails']['send']>[0] & { scheduled_at?: string } = {
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    };

    if (payload.cc && payload.cc.length > 0) {
      emailOptions.cc = payload.cc;
    }

    if (payload.scheduledAt) {
      emailOptions.scheduled_at = payload.scheduledAt.toISOString();
    }

    if (payload.attachments && payload.attachments.length > 0) {
      emailOptions.attachments = payload.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: typeof attachment.content === 'string' 
          ? attachment.content 
          : attachment.content.toString('base64'),
      }));
    }

    await enqueueRateLimited(() => client.emails.send(emailOptions));
    return true;
  } catch (error) {
    console.error('Failed to send transactional email', error);
    return false;
  }
}
