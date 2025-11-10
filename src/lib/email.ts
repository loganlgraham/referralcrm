import { Resend } from 'resend';

type EmailPayload = {
  to: string[];
  subject: string;
  html: string;
  text: string;
};

let resendClient: Resend | null = null;

const hasResendConfig = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

function getResendClient(): Resend | null {
  if (!hasResendConfig) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY as string);
  }
  return resendClient;
}

export async function sendTransactionalEmail(payload: EmailPayload): Promise<boolean> {
  const fromAddress = process.env.EMAIL_FROM;
  const client = getResendClient();
  if (!client || !fromAddress || payload.to.length === 0) {
    return false;
  }

  try {
    await client.emails.send({
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text
    });
    return true;
  } catch (error) {
    console.error('Failed to send transactional email', error);
    return false;
  }
}
