import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import { emailButton, emailParagraph } from '@/lib/email-templates/primitives';

export function renderMagicLinkEmail(data: { host: string; url: string }): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `Sign in to ${data.host}`,
    heading: 'Sign in to Referrio',
    bodyHtml: [
      emailParagraph(`Click the button below to sign in to ${escapeHtml(data.host)}.`),
      emailButton(data.url, 'Sign in'),
    ].join(''),
  });
  const text = renderEmailText(`Sign in to ${data.host}:\n${data.url}`);
  return { html, text };
}

export function renderPasswordResetEmail(data: {
  name: string;
  resetUrl: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: 'Reset your Referral CRM password',
    heading: 'Reset your password',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.name)},`),
      emailParagraph(
        'We received a request to reset your Referral CRM password. Click the button below to set a new password:'
      ),
      emailButton(data.resetUrl, 'Reset password'),
      emailParagraph('This link will expire in 30 minutes. If you did not request this, you can safely ignore this email.', {
        muted: true,
      }),
    ].join(''),
  });
  const text = renderEmailText(
    `Hi ${data.name},\n\nUse the link below to reset your Referral CRM password. This link expires in 30 minutes.\n${data.resetUrl}\n\nIf you did not request this, you can ignore this email.`
  );
  return { html, text };
}
