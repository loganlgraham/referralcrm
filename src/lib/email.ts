import { Resend } from 'resend';

type EmailPayload = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  scheduledAt?: Date;
};

let resendClient: Resend | null = null;

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

    if (payload.scheduledAt) {
      emailOptions.scheduled_at = payload.scheduledAt.toISOString();
    }

    await client.emails.send(emailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send transactional email', error);
    return false;
  }
}
