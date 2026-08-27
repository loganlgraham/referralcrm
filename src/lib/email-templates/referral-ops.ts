import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import {
  emailButton,
  emailCard,
  emailLink,
  emailList,
  emailMetaRows,
  emailParagraph,
  emailQuote,
} from '@/lib/email-templates/primitives';

export function renderNewReferralNotificationEmail(data: {
  borrowerLabel: string;
  summaryFields: string[];
  referralLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `New referral for ${data.borrowerLabel}`,
    heading: 'New referral',
    bodyHtml: [
      emailParagraph(`A new referral has been created for <strong>${escapeHtml(data.borrowerLabel)}</strong>.`),
      emailList(data.summaryFields),
      emailButton(data.referralLink, 'View the referral'),
    ].join(''),
  });
  const text = renderEmailText(
    `A new referral has been created for ${data.borrowerLabel}.\n\n${data.summaryFields.join('\n')}\n\nView the referral: ${data.referralLink}`
  );
  return { html, text };
}

export function renderAfcAdminNotificationEmail(data: {
  agentName: string;
  borrowerLabel: string;
  summaryFields: string[];
  referralLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `New AFC referral from ${data.agentName}`,
    heading: 'New AFC referral',
    bodyHtml: [
      emailParagraph(
        `<strong>${escapeHtml(data.agentName)}</strong> created a new AFC referral for <strong>${escapeHtml(data.borrowerLabel)}</strong>.`
      ),
      emailList(data.summaryFields),
      emailParagraph('Assign a mortgage consultant from the referral page.'),
      emailButton(data.referralLink, 'View the referral'),
    ].join(''),
  });
  const text = renderEmailText(
    `${data.agentName} created a new AFC referral for ${data.borrowerLabel}.\n\n${data.summaryFields.join('\n')}\n\nAssign a mortgage consultant from the referral page.\n\nView the referral: ${data.referralLink}`
  );
  return { html, text };
}

export function renderAgentReferralReceiptEmail(data: {
  agentGreeting: string;
  borrowerLabel: string;
  referralLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `We received your referral for ${data.borrowerLabel}`,
    heading: 'We received your referral',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.agentGreeting)},`),
      emailParagraph(
        `Thank you so much for introducing <strong>${escapeHtml(data.borrowerLabel)}</strong> to AFC — we truly appreciate you trusting us with your client.`
      ),
      emailParagraph(
        "We've received your referral and our team is already on it. We'll pair them with a mortgage consultant shortly and email you again as soon as that happens so you have everything you need."
      ),
      emailButton(data.referralLink, 'View the referral'),
      emailParagraph("We're grateful for the partnership. Thank you again!"),
    ].join(''),
  });
  const text = renderEmailText(`Hi ${data.agentGreeting},

Thank you so much for introducing ${data.borrowerLabel} to AFC — we truly appreciate you trusting us with your client.

We've received your referral and our team is already on it. We'll pair them with a mortgage consultant shortly and email you again as soon as that happens so you have everything you need.

View the referral: ${data.referralLink}

We're grateful for the partnership. Thank you again!`);
  return { html, text };
}

export function renderInboundConfirmationEmail(data: {
  borrowerName: string;
  summaryFields: string[];
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `Referral received for ${data.borrowerName}`,
    heading: 'Referral received',
    bodyHtml: [
      emailParagraph(`Referral received for <strong>${escapeHtml(data.borrowerName)}</strong>.`),
      emailList(data.summaryFields),
    ].join(''),
  });
  const text = renderEmailText([`Referral received for ${data.borrowerName}.`, ...data.summaryFields].join('\n'));
  return { html, text };
}

export function renderMcAssignmentEmail(data: {
  greetingName: string;
  borrowerLines: string[];
  agentLines: string[];
  referralLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: 'You have been assigned a new referral',
    heading: 'New referral assigned',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.greetingName)},`),
      emailParagraph('You have been assigned a new referral.'),
      emailList(data.borrowerLines),
      data.agentLines.length > 0 ? emailCard('Agent who sent it', emailList(data.agentLines)) : '',
      emailButton(data.referralLink, 'View the referral'),
    ].join(''),
  });
  const text = renderEmailText(`Hi ${data.greetingName},

You have been assigned a new referral.
${data.borrowerLines.join('\n')}

${data.agentLines.length > 0 ? `Agent who sent it:\n${data.agentLines.join('\n')}\n\n` : ''}View the referral: ${data.referralLink}`);
  return { html, text };
}

export function renderAgentMcAssignmentThankYouEmail(data: {
  greeting: string;
  borrowerName: string;
  mcName: string;
  mcLines: string[];
  referralLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: `${data.mcName} is on it for ${data.borrowerName}`,
    heading: 'Your referral is paired',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.greeting)},`),
      emailParagraph(
        `Thank you so much for referring <strong>${escapeHtml(data.borrowerName)}</strong> — we really appreciate you trusting us with your client.`
      ),
      emailParagraph(
        `We've paired them with <strong>${escapeHtml(data.mcName)}</strong>, who will take great care of them as their mortgage consultant. Here's how to reach them:`
      ),
      emailList(data.mcLines),
      emailButton(data.referralLink, 'View the referral'),
      emailParagraph('Thanks again for the referral!'),
    ].join(''),
  });
  const text = renderEmailText(`Hi ${data.greeting},

Thank you so much for referring ${data.borrowerName} — we really appreciate you trusting us with your client.

We've paired them with ${data.mcName}, who will take great care of them as their mortgage consultant. Here's how to reach them:

${data.mcLines.join('\n')}

View the referral: ${data.referralLink}

Thanks again for the referral!`);
  return { html, text };
}

export function renderNoteEmail(data: {
  authorName: string;
  borrowerName: string;
  htmlContent?: string;
  plainContent: string;
  recipientName?: string;
  referralLink?: string;
}): { html: string; text: string } {
  const quotedHtml =
    data.htmlContent ?? escapeHtml(data.plainContent).replace(/\n/g, '<br />');
  const html = renderEmailHtml({
    preheader: `New note on ${data.borrowerName}`,
    heading: 'New note',
    bodyHtml: [
      emailParagraph(
        `${escapeHtml(data.authorName)} added a new note on ${escapeHtml(data.borrowerName)}.`
      ),
      data.recipientName ? emailParagraph(`Recipient: ${escapeHtml(data.recipientName)}`) : '',
      emailQuote(quotedHtml),
      data.referralLink
        ? emailParagraph(`Review the referral: ${emailLink(data.referralLink, data.referralLink)}`)
        : '',
    ].join(''),
  });
  const text = renderEmailText(
    `${data.authorName} added a new note on ${data.borrowerName}.\n\n${data.plainContent}\n\n${
      data.referralLink ? `Review the referral: ${data.referralLink}` : ''
    }`
  );
  return { html, text };
}

export type IntroContact = {
  name: string;
  email: string;
  phone: string;
};

export type AgentIntroEmailData = {
  agentFirstName: string;
  introCopy: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  notes?: string | null;
  oppositeAgent?: { label: string; contact: IntroContact } | null;
  mc?: IntroContact & { loanFileNumber: string } | null;
  isSellerOnly?: boolean;
  borrowerFirstName: string;
  contactMadeLink?: string;
  contactAttemptedLink?: string;
  referralLink?: string;
};

export function renderAgentIntroEmail(data: AgentIntroEmailData): { html: string; text: string } {
  const clientRows = [
    { label: 'Client Name', value: data.borrowerName },
    { label: 'Email', value: data.borrowerEmail },
    { label: 'Phone', value: data.borrowerPhone },
    data.notes ? { label: 'Notes', value: data.notes } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  const contactHtml =
    data.contactMadeLink && data.contactAttemptedLink
      ? [
          emailParagraph(
            `Please select one of the following after attempting to contact ${escapeHtml(data.borrowerFirstName)}:`
          ),
          emailParagraph(
            `${emailLink(data.contactMadeLink, 'Made Contact')}<br>${emailLink(
              data.contactAttemptedLink,
              'Unable to reach after first attempt'
            )}`
          ),
        ].join('')
      : '';

  const oppositeHtml = data.oppositeAgent
    ? emailCard(
        data.oppositeAgent.label,
        emailMetaRows([
          { label: 'Name', value: data.oppositeAgent.contact.name },
          { label: 'Email', value: data.oppositeAgent.contact.email },
          { label: 'Phone', value: data.oppositeAgent.contact.phone },
        ])
      )
    : '';

  const mcHtml = data.isSellerOnly
    ? ''
    : data.mc
      ? emailCard(
          'Mortgage Consultant at American Financing',
          emailMetaRows([
            { label: 'Name', value: data.mc.name },
            { label: 'Email', value: data.mc.email },
            { label: 'Phone', value: data.mc.phone },
            { label: 'Loan File Number', value: data.mc.loanFileNumber },
          ])
        )
      : emailCard(
          'Mortgage Consultant at American Financing',
          emailMetaRows([
            { label: 'Name', value: 'Not provided' },
            { label: 'Loan File Number', value: 'N/A' },
          ])
        );

  const html = renderEmailHtml({
    preheader: `New referral for ${data.borrowerName}`,
    heading: 'New referral',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.agentFirstName)},`),
      emailParagraph(escapeHtml(data.introCopy)),
      emailParagraph('Here are the key details so you can reach out confidently:'),
      emailCard('Client', emailMetaRows(clientRows)),
      oppositeHtml,
      mcHtml,
      contactHtml,
      data.referralLink
        ? emailParagraph(`Referral workspace: ${emailLink(data.referralLink, data.referralLink)}`)
        : '',
      emailParagraph(`Thank you for taking great care of ${escapeHtml(data.borrowerFirstName)}!`),
    ].join(''),
  });

  const oppositeText = data.oppositeAgent
    ? [
        `${data.oppositeAgent.label}: ${data.oppositeAgent.contact.name}`,
        `Email: ${data.oppositeAgent.contact.email}`,
        `Phone: ${data.oppositeAgent.contact.phone}`,
      ]
    : [];
  const mcText = data.isSellerOnly
    ? null
    : data.mc
      ? `Mortgage Consultant at American Financing: ${data.mc.name} | Email: ${data.mc.email} | Phone: ${data.mc.phone} | Loan File Number: ${data.mc.loanFileNumber}`
      : 'Mortgage Consultant at American Financing: Not provided | Loan File Number: N/A';

  const text = renderEmailText(
    [
      `Hi ${data.agentFirstName},`,
      data.introCopy,
      'Here are the key details so you can reach out confidently:',
      `Client Name: ${data.borrowerName}`,
      `Email: ${data.borrowerEmail}`,
      `Phone: ${data.borrowerPhone}`,
      data.notes ? `Notes: ${data.notes}` : null,
      ...oppositeText,
      mcText,
      data.contactMadeLink && data.contactAttemptedLink
        ? `Please select one of the following after attempting to contact ${data.borrowerFirstName}:`
        : null,
      data.contactMadeLink ? `Made Contact: ${data.contactMadeLink}` : null,
      data.contactAttemptedLink
        ? `Unable to reach after first attempt: ${data.contactAttemptedLink}`
        : null,
      data.referralLink ? `Referral workspace: ${data.referralLink}` : null,
      `Thank you for taking great care of ${data.borrowerFirstName}!`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n')
  );
  return { html, text };
}

export type McIntroContact = { label: string; name: string; email: string; phone: string };

export function renderMcIntroEmail(data: {
  lenderFirstName: string;
  borrowerName: string;
  loanFileNumber: string;
  agents: McIntroContact[];
  includeBorrowerDetails?: boolean;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  borrowerFirstName: string;
  referralLink?: string;
}): { html: string; text: string } {
  const agentCards = data.agents
    .map((agent) =>
      emailCard(
        agent.label,
        emailMetaRows([
          { label: 'Name', value: agent.name },
          { label: 'Email', value: agent.email },
          { label: 'Phone', value: agent.phone },
        ])
      )
    )
    .join('');

  const html = renderEmailHtml({
    preheader: `Agent helping ${data.borrowerName}`,
    heading: 'Agent team assigned',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.lenderFirstName)},`),
      emailParagraph(
        `The agent team who will be helping ${escapeHtml(data.borrowerName)}, file number ${escapeHtml(data.loanFileNumber)}, is:`
      ),
      agentCards,
      data.includeBorrowerDetails
        ? emailCard(
            'Borrower contact details',
            emailMetaRows(
              [
                { label: 'Borrower', value: data.borrowerName },
                data.borrowerEmail ? { label: 'Email', value: data.borrowerEmail } : null,
                data.borrowerPhone ? { label: 'Phone', value: data.borrowerPhone } : null,
              ].filter((row): row is { label: string; value: string } => Boolean(row))
            )
          )
        : '',
      data.referralLink
        ? emailParagraph(`Referral workspace: ${emailLink(data.referralLink, data.referralLink)}`)
        : '',
      emailParagraph(
        `Please reach out to the agent to introduce yourself and fill them in on the details of ${escapeHtml(
          data.borrowerFirstName || data.borrowerName || 'the borrower'
        )}'s financing and add their contact information to the LOS.`
      ),
    ].join(''),
  });

  const textLines = [
    `Hi ${data.lenderFirstName},`,
    `The agent team who will be helping ${data.borrowerName}, file number ${data.loanFileNumber}, is:`,
    '',
    ...data.agents.flatMap((agent) => [
      `${agent.label}: ${agent.name}`,
      `Email: ${agent.email}`,
      `Phone: ${agent.phone}`,
      '',
    ]),
  ];
  if (data.includeBorrowerDetails) {
    textLines.push(
      'Borrower contact details to connect directly:',
      `Borrower: ${data.borrowerName}`,
      data.borrowerEmail ? `Email: ${data.borrowerEmail}` : '',
      data.borrowerPhone ? `Phone: ${data.borrowerPhone}` : ''
    );
  }
  if (data.referralLink) {
    textLines.push(`Referral workspace: ${data.referralLink}`);
  }
  textLines.push(
    `Please reach out to the agent to introduce yourself and fill them in on the details of ${
      data.borrowerFirstName || data.borrowerName || 'the borrower'
    }'s financing and add their contact information to the LOS.`
  );

  const text = renderEmailText(textLines.filter((line) => line !== '').join('\n'));
  return { html, text };
}

export function renderPairingSummaryEmail(data: {
  borrowerName: string;
  loanFileNumber: string;
  clientType: string;
  pairedMembers: Array<{ label: string; name: string; email?: string; phone?: string }>;
  referralLink?: string;
  introLinks: Array<{ label: string; url: string }>;
}): { html: string; text: string } {
  const membersHtml =
    data.pairedMembers.length > 0
      ? emailList(
          data.pairedMembers.map((member) => {
            const extras = [member.email, member.phone].filter(Boolean).join(' — ');
            return extras ? `${member.label}: ${member.name} (${extras})` : `${member.label}: ${member.name}`;
          })
        )
      : emailParagraph('No team members paired yet.');

  const introHtml = data.introLinks
    .map((link) => emailParagraph(emailLink(link.url, `Send Introduction Email to ${link.label}`)))
    .join('');

  const html = renderEmailHtml({
    preheader: `Referral paired: ${data.borrowerName}`,
    heading: 'Referral paired',
    bodyHtml: [
      emailParagraph('A referral has been paired:'),
      emailMetaRows([
        { label: 'Borrower', value: data.borrowerName },
        { label: 'Loan File Number', value: data.loanFileNumber },
        { label: 'Client Type', value: data.clientType },
      ]),
      data.pairedMembers.length > 0 ? emailParagraph('<strong>Paired Team Members:</strong>') : '',
      membersHtml,
      data.referralLink ? emailButton(data.referralLink, 'View the referral') : '',
      introHtml,
    ].join(''),
  });

  const text = renderEmailText(
    [
      'A referral has been paired:',
      `Borrower: ${data.borrowerName}`,
      `Loan File Number: ${data.loanFileNumber}`,
      `Client Type: ${data.clientType}`,
      data.pairedMembers.length > 0
        ? `Paired Team Members:\n${data.pairedMembers
            .map(
              (member) =>
                `${member.label}: ${member.name}${member.email ? ` (${member.email})` : ''}${
                  member.phone ? ` - ${member.phone}` : ''
                }`
            )
            .join('\n')}`
        : 'No team members paired yet.',
      data.referralLink ? `View the referral: ${data.referralLink}` : '',
      ...data.introLinks.map((link) => `Send Introduction Email to ${link.label}: ${link.url}`),
    ]
      .filter(Boolean)
      .join('\n\n')
  );
  return { html, text };
}

