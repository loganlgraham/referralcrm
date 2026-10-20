import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import { emailButton, emailParagraph } from '@/lib/email-templates/primitives';

export function renderBorrowerCloseEmail(data: {
  borrowerFirstName: string;
  agentName: string;
  surveyUrl: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: 'Congratulations on your new home',
    heading: 'Congrats on your new home',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.borrowerFirstName)},`),
      emailParagraph(
        `Congratulations on closing on your home! 🎉 If you have a quick moment, we'd really appreciate you leaving a rating for your agent, ${escapeHtml(data.agentName)}—your feedback means a lot and helps others tremendously. Wishing you all the best!`
      ),
      emailButton(data.surveyUrl, 'Rate Your Agent'),
    ].join(''),
  });
  const text = renderEmailText(
    `Hi ${data.borrowerFirstName},\n\nCongratulations on closing on your home! 🎉 If you have a quick moment, we'd really appreciate you leaving a rating for your agent, ${data.agentName}—your feedback means a lot and helps others tremendously. Wishing you all the best!\n\nRate your agent: ${data.surveyUrl}`
  );
  return { html, text };
}

export function renderAgentCloseEmail(data: {
  agentFirstName: string;
  borrowerDisplayName: string;
  lenderSurveyUrl?: string | null;
}): { html: string; text: string } {
  const mcQuestion =
    'If you have a quick moment: on a scale of 0-10, how likely are you to recommend American Financing to a client or colleague?';
  const mcHtml = data.lenderSurveyUrl
    ? [emailParagraph(mcQuestion), emailButton(data.lenderSurveyUrl, 'Rate Your Mortgage Consultant')].join('')
    : '';
  const mcText = data.lenderSurveyUrl
    ? `\n\n${mcQuestion}\n\nRate your mortgage consultant: ${data.lenderSurveyUrl}`
    : '';

  const html = renderEmailHtml({
    preheader: 'Congratulations on your closed deal',
    heading: 'Congratulations on your closed deal',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.agentFirstName)},`),
      emailParagraph(
        `Congratulations on closing your deal with ${escapeHtml(data.borrowerDisplayName)}! Great work getting this referral across the finish line.`
      ),
      mcHtml,
    ].join(''),
  });
  const text = renderEmailText(
    `Hi ${data.agentFirstName},\n\nCongratulations on closing your deal with ${data.borrowerDisplayName}! Great work getting this referral across the finish line.${mcText}`
  );
  return { html, text };
}

export function renderNpsSurveyEmail(data: {
  firstName: string;
  question: string;
  surveyUrl: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: 'Help us improve',
    heading: 'Help us improve',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.firstName)},`),
      emailParagraph(escapeHtml(data.question)),
      emailButton(data.surveyUrl, 'Take the survey'),
      emailParagraph('This link will expire in 30 days.', { muted: true }),
    ].join(''),
  });
  const text = renderEmailText(`Help us improve

Hi ${data.firstName},

${data.question}

Take the survey: ${data.surveyUrl}

This link will expire in 30 days.`);
  return { html, text };
}

export function renderPaymentSentEmail(data: {
  agentName: string;
  borrowerName: string;
  formattedAmount: string;
  referralLink?: string | null;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `${data.agentName} sent a referral payment`,
    heading: 'Referral payment sent',
    bodyHtml: [
      emailParagraph(
        `${escapeHtml(data.agentName)} marked the referral fee as <strong>Payment Sent</strong> for ${escapeHtml(data.borrowerName)}.`
      ),
      emailParagraph(`Amount: <strong>${escapeHtml(data.formattedAmount)}</strong>`),
      data.referralLink ? emailButton(data.referralLink, 'View referral details') : '',
    ].join(''),
  });
  const text = renderEmailText(
    [
      `${data.agentName} marked the referral fee as Payment Sent for ${data.borrowerName}.`,
      `Amount: ${data.formattedAmount}.`,
      data.referralLink ? `View the referral: ${data.referralLink}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { html, text };
}
