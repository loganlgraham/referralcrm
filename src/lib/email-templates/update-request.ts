import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import { emailButton, emailCard, emailMetaRows, emailParagraph } from '@/lib/email-templates/primitives';

export type UpdateRequestContactBlock = {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  status: string;
  lenderName: string;
  lenderEmail: string;
  lenderPhone: string;
  loanFileNumber: string;
};

const COORDINATOR = {
  name: 'Kristen Truong',
  email: 'kristen.truong@americanhomeagents.com',
  phone: '303-557-4230',
};

function updateRequestCards(data: UpdateRequestContactBlock): string {
  return [
    emailCard(
      'Buyer Info',
      emailMetaRows([
        { label: 'Buyer', value: data.buyerName },
        { label: 'Email', value: data.buyerEmail },
        { label: 'Phone', value: data.buyerPhone },
        { label: 'Current Status', value: data.status },
      ])
    ),
    emailCard(
      'Mortgage Consultant at AFC',
      emailMetaRows([
        { label: 'Name', value: data.lenderName },
        { label: 'Email', value: data.lenderEmail },
        { label: 'Phone', value: data.lenderPhone },
        { label: 'File Number', value: data.loanFileNumber },
      ])
    ),
    emailCard(
      'Agent Relationship Coordinator',
      emailMetaRows([
        { label: 'Name', value: COORDINATOR.name },
        { label: 'Email', value: COORDINATOR.email },
        { label: 'Phone', value: COORDINATOR.phone },
      ])
    ),
  ].join('');
}

function updateRequestTextCards(data: UpdateRequestContactBlock): string {
  return `Buyer Info
Buyer: ${data.buyerName}
Email: ${data.buyerEmail}
Phone: ${data.buyerPhone}
Current Status: ${data.status}

Mortgage Consultant at AFC
Name: ${data.lenderName}
Email: ${data.lenderEmail}
Phone: ${data.lenderPhone}
File Number: ${data.loanFileNumber}

Agent Relationship Coordinator
Name: ${COORDINATOR.name}
Email: ${COORDINATOR.email}
Phone: ${COORDINATOR.phone}`;
}

export function renderManualUpdateRequestEmail(data: {
  agentFirstName: string;
  buyerFirstName: string;
  buyerName: string;
  referralUrl: string;
  contacts: UpdateRequestContactBlock;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `Update requested for ${data.buyerName}`,
    heading: 'Update requested',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.agentFirstName)},`),
      emailParagraph(
        `Hope everything's going well with ${escapeHtml(data.buyerFirstName)}. When you have a moment, please log in to the referral portal to add a brief update and confirm the current status. Quick notes like "showing homes this weekend," "submitting an offer," or "still in touch but pausing for now" help us stay aligned and best support the client.`
      ),
      emailButton(data.referralUrl, 'Log in to Referral Portal'),
      updateRequestCards(data.contacts),
      emailParagraph('Thanks,<br>Referrio', { muted: true }),
    ].join(''),
  });
  const text = renderEmailText(`Action Needed: Update requested for ${data.buyerName}

Hi ${data.agentFirstName},

Hope everything's going well with ${data.buyerFirstName}. When you have a moment, please log in to the referral portal to add a brief update and confirm the current status. Quick notes like "showing homes this weekend," "submitting an offer," or "still in touch but pausing for now" help us stay aligned and best support the client.

Log in to Referral Portal:
${data.referralUrl}

${updateRequestTextCards(data.contacts)}

Thanks,
Referrio`);
  return { html, text };
}

export function renderScheduledUpdateReminderEmail(data: {
  agentFirstName: string;
  buyerName: string;
  daysSincePairing: number;
  referralUrl: string;
  contacts: UpdateRequestContactBlock;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `Scheduled update for ${data.buyerName}`,
    heading: 'Scheduled update reminder',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.agentFirstName)},`),
      emailParagraph(
        `This is an automated reminder to update one of your referrals (Day ${data.daysSincePairing} since pairing):`
      ),
      updateRequestCards(data.contacts),
      emailParagraph('Please log in to update the status and add any relevant notes:'),
      emailButton(data.referralUrl, 'View Referral'),
      emailParagraph(
        '<strong>Automated reminders are enabled for this referral.</strong><br>Schedule: Day 1, 3, 7, 14, then every 2 weeks from agent pairing.',
        { muted: true, size: 13 }
      ),
      emailParagraph('Thanks,<br>Referrio', { muted: true }),
    ].join(''),
  });
  const text = renderEmailText(`Scheduled Update: ${data.buyerName}

Hi ${data.agentFirstName},

This is an automated reminder to update one of your referrals (Day ${data.daysSincePairing} since pairing):

${updateRequestTextCards(data.contacts)}

Please log in to update the status and add any relevant notes:
${data.referralUrl}

Automated reminders are enabled for this referral.
Schedule: Day 1, 3, 7, 14, then every 2 weeks from agent pairing.

Thanks,
Referrio`);
  return { html, text };
}
