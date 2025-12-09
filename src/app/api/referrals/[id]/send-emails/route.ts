import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { logReferralActivity } from '@/lib/server/activities';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { buildContactActionLink, buildReferralLink, getReferralAppBaseUrl } from '@/lib/referral-links';

interface Params {
  params: { id: string };
}

type BasicContact = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

const firstNameFromContact = (contact: BasicContact | null, fallback: string): string => {
  if (contact?.name) {
    const [first] = contact.name.trim().split(/\s+/);
    if (first) return first;
  }
  return fallback;
};

type SendResult = {
  sent: string[];
  skipped: string[];
  errors: string[];
  followUpScheduledFor?: string;
};

const normalizeContact = (contact: unknown): BasicContact | null => {
  if (!contact || typeof contact !== 'object') {
    return null;
  }

  const candidate = contact as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name : null;
  const email = typeof candidate.email === 'string' ? candidate.email : null;
  const phone = typeof candidate.phone === 'string' ? candidate.phone : null;

  if (!name && !email && !phone) {
    return null;
  }

  return { name, email, phone };
};

const coerceContactField = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractMcContact = (referral: any): BasicContact | null => {
  const lenderContact = normalizeContact(referral.lender);
  if (lenderContact) return lenderContact;

  const fallbackEmail =
    coerceContactField(referral.lenderEmail) ||
    coerceContactField(referral.borrower?.loanOfficerEmail) ||
    coerceContactField(referral.borrower?.lenderEmail) ||
    coerceContactField(referral.inboundEmail?.fields?.loanofficeremail);

  const fallbackName =
    coerceContactField(referral.borrower?.loanOfficerName) ||
    coerceContactField(referral.inboundEmail?.fields?.loanofficername) ||
    coerceContactField(referral.inboundEmail?.fields?.mcname);

  const fallbackPhone =
    coerceContactField(referral.borrower?.loanOfficerPhone) ||
    coerceContactField(referral.inboundEmail?.fields?.loanofficerphone) ||
    coerceContactField(referral.inboundEmail?.fields?.mcphone);

  if (!fallbackEmail && !fallbackName && !fallbackPhone) {
    return null;
  }

  return {
    name: fallbackName,
    email: fallbackEmail,
    phone: fallbackPhone,
  };
};

const buildBorrowerName = (borrower: any): string => {
  const parts = [borrower?.firstName, borrower?.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  if (typeof borrower?.name === 'string' && borrower.name.trim()) return borrower.name.trim();
  return 'the buyer';
};

const buildBorrowerFirstName = (borrower: any): string => {
  const firstName = typeof borrower?.firstName === 'string' ? borrower.firstName.trim() : '';
  if (firstName) return firstName;

  if (typeof borrower?.name === 'string' && borrower.name.trim()) {
    const [first] = borrower.name.trim().split(/\s+/);
    if (first) return first;
  }

  const borrowerName = buildBorrowerName(borrower);
  const [firstFromFull] = borrowerName.split(/\s+/);
  return firstFromFull || 'the buyer';
};

const formatContactLines = (contact: BasicContact | null, label: string) => {
  if (!contact) return [] as string[];
  const lines: (string | null)[] = [
    `<strong>${label}:</strong> ${contact.name ?? 'Not provided'}`,
    contact.email ? `<strong>Email:</strong> ${contact.email}` : null,
    contact.phone ? `<strong>Phone:</strong> ${contact.phone}` : null,
  ];
  return lines.filter(Boolean) as string[];
};

const extractBorrowerContact = (referral: any): BasicContact => {
  const borrower = referral?.borrower ?? {};
  const normalizedName = buildBorrowerName(borrower);

  const emailCandidates: Array<unknown> = [
    borrower.email,
    borrower.emailAddress,
    borrower.contactEmail,
    borrower.contact?.email,
    referral.borrowerEmail,
    referral.contactEmail,
    referral.inboundEmail?.from?.email,
    referral.inboundEmail?.fields?.email,
    referral.inboundEmail?.fields?.borroweremail,
  ];

  const phoneCandidates: Array<unknown> = [
    borrower.phone,
    borrower.phoneNumber,
    borrower.contact?.phone,
    referral.borrowerPhone,
    referral.contactPhone,
    referral.inboundEmail?.fields?.phone,
    referral.inboundEmail?.fields?.borrowerphone,
  ];

  const firstNonEmpty = (values: Array<unknown>) => {
    for (const value of values) {
      const coerced = coerceContactField(value);
      if (coerced) return coerced;
    }
    return null;
  };

  return {
    name: normalizedName,
    email: firstNonEmpty(emailCandidates),
    phone: firstNonEmpty(phoneCandidates),
  };
};

const trySendEmail = async (
  toAddress: string | null,
  subject: string,
  htmlLines: Array<string | null>,
  textLines: Array<string | null>,
  label: string,
  result: SendResult
) => {
  const to = typeof toAddress === 'string' && toAddress.trim().length > 0 ? toAddress.trim() : null;
  if (!to) {
    result.skipped.push(label);
    return;
  }

  const success = await sendTransactionalEmail({
    to: [to],
    subject,
    html: htmlLines.filter(Boolean).join(''),
    text: textLines.filter(Boolean).join('\n'),
  });

  if (success) {
    result.sent.push(label);
  } else {
    result.errors.push(label);
  }
};

export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const allowedRoles = new Set(['admin', 'manager', 'mc', 'agent']);
  if (!allowedRoles.has(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json(
      { error: 'Transactional email is not configured.' },
      { status: 503 }
    );
  }

  await connectMongo();
  const referral = await Referral.findOne({ _id: params.id, deletedAt: null })
    .populate('assignedAgent', 'name email phone')
    .populate('buySideAgent', 'name email phone')
    .populate('sellSideAgent', 'name email phone')
    .populate('lender', 'name email phone');

  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  const buySideContact = normalizeContact(referral.buySideAgent);
  const sellSideContact = normalizeContact(referral.sellSideAgent);
  const primaryAgent = buySideContact || sellSideContact || normalizeContact(referral.assignedAgent);
  const lenderContact = extractMcContact(referral);
  const borrower = referral.borrower ?? {};
  const borrowerContact = extractBorrowerContact(referral);
  const borrowerName = borrowerContact.name || buildBorrowerName(borrower);
  const borrowerFirstName = buildBorrowerFirstName(borrower);
  const agentFirstName = firstNameFromContact(primaryAgent, 'your agent');
  const lenderFirstName = firstNameFromContact(lenderContact, 'your mortgage consultant');
  const borrowerEmail = borrowerContact.email ?? null;
  const borrowerPhone = borrowerContact.phone;
  const referralLinkBase = getReferralAppBaseUrl();
  const referralLink = referralLinkBase ? buildReferralLink(referral._id.toString()) : '';
  const contactMadeLink = referralLinkBase
    ? buildContactActionLink(referral._id.toString(), 'contact-made')
    : '';
  const contactAttemptedLink = referralLinkBase
    ? buildContactActionLink(referral._id.toString(), 'contact-attempted')
    : '';

  const result: SendResult = { sent: [], skipped: [], errors: [] };

  await trySendEmail(
    primaryAgent?.email ?? null,
    'New referral introduction',
    [
      `<p>Hi ${primaryAgent?.name ?? 'there'},</p>`,
      `<p>Thanks for partnering with American Home Agents Buyer Concierge Service on ${borrowerName}.` +
        " We're excited to help them with their home search.</p>",
      '<p>Here are the key details so you can reach out confidently:</p>',
      '<ul>',
      `<li><strong>Buyer:</strong> ${borrowerName}</li>`,
      borrowerEmail ? `<li><strong>Email:</strong> ${borrowerEmail}</li>` : null,
      borrowerPhone ? `<li><strong>Phone:</strong> ${borrowerPhone}</li>` : null,
      lenderContact
        ? '<li>' + formatContactLines(lenderContact, 'Mortgage Consultant').join('<br/>') + '</li>'
        : null,
      '</ul>',
      referralLink ? `<p>Referral workspace: <a href="${referralLink}">${referralLink}</a></p>` : null,
      '<p>Thank you for taking great care of this client.</p>',
    ],
    [
      `Hi ${primaryAgent?.name ?? 'there'},`,
      `Thanks for partnering with American Home Agents Buyer Concierge Service on ${borrowerName}. We're excited to help them with their home search.`,
      'Here are the key details so you can reach out confidently:',
      `Buyer: ${borrowerName}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null,
      lenderContact
        ? formatContactLines(lenderContact, 'Mortgage Consultant').join(' | ')
        : null,
      referralLink ? `Referral workspace: ${referralLink}` : null,
      'Thank you for taking great care of this client.',
    ],
    'agent',
    result
  );

  const followUpSendTime = new Date(Date.now() + 4 * 60 * 60 * 1000);

  if (primaryAgent?.email && contactMadeLink && contactAttemptedLink) {
    const followUpScheduled = await sendTransactionalEmail({
      to: [primaryAgent.email],
      subject: `Quick check-in for ${borrowerName}`,
      html: [
        `<p>Hi ${primaryAgent?.name ?? 'there'},</p>`,
        `<p>Were you able to connect with ${borrowerName}? Let us know:</p>`,
        '<ul>',
        `<li><a href="${contactMadeLink}">Made contact</a></li>`,
        `<li><a href="${contactAttemptedLink}">Unable to make contact</a></li>`,
        '</ul>',
        referralLink
          ? `<p>You can also review the details here: <a href="${referralLink}">${referralLink}</a></p>`
          : null,
        `<p>Thank you for keeping us updated.</p>`,
      ].filter(Boolean).join(''),
      text: [
        `Hi ${primaryAgent?.name ?? 'there'},`,
        `Were you able to connect with ${borrowerName}? Let us know:`,
        `Made contact: ${contactMadeLink}`,
        `Unable to make contact: ${contactAttemptedLink}`,
        referralLink ? `Referral workspace: ${referralLink}` : null,
        'Thank you for keeping us updated.',
      ]
        .filter(Boolean)
        .join('\n'),
      scheduledAt: followUpSendTime,
    });

    if (followUpScheduled) {
      result.followUpScheduledFor = followUpSendTime.toISOString();
    }
  }

  const mcAgentContacts: Array<{ label: string; contact: BasicContact }> = [];

  const pairedFallbackContact = primaryAgent ?? normalizeContact(referral.assignedAgent);

  if (buySideContact || pairedFallbackContact) {
    mcAgentContacts.push({ label: 'Buying Agent', contact: buySideContact ?? pairedFallbackContact! });
  }

  if (sellSideContact || pairedFallbackContact) {
    mcAgentContacts.push({ label: 'Selling Agent', contact: sellSideContact ?? pairedFallbackContact! });
  }

  if (mcAgentContacts.length === 0 && primaryAgent) {
    mcAgentContacts.push({ label: 'Agent', contact: primaryAgent });
  }

  const mcEmailHtmlLines: Array<string | null> = [
    `<p>Hi ${lenderContact?.name ?? 'there'},</p>`,
    `<p>The agent team who will be helping ${borrowerName} is:</p>`,
    '<ul>',
    ...mcAgentContacts.map(
      ({ label, contact }) => `<li>${formatContactLines(contact, label).join('<br/>')}</li>`
    ),
    '</ul>',
  ];

  const mcEmailTextLines: Array<string | null> = [
    `Hi ${lenderContact?.name ?? 'there'},`,
    `The agent team who will be helping ${borrowerName} is:`,
    mcAgentContacts.length > 0
      ? mcAgentContacts
          .map(({ label, contact }) => formatContactLines(contact, label).join(' | '))
          .join(' || ')
      : null,
  ];

  if (session.user.role === 'agent') {
    mcEmailHtmlLines.push(
      `<p>Borrower contact details to connect directly:</p>`,
      '<ul>',
      `<li><strong>Borrower:</strong> ${borrowerName}</li>`,
      borrowerEmail ? `<li><strong>Email:</strong> ${borrowerEmail}</li>` : null,
      borrowerPhone ? `<li><strong>Phone:</strong> ${borrowerPhone}</li>` : null,
      '</ul>'
    );

    mcEmailTextLines.push(
      'Borrower contact details to connect directly:',
      `Borrower: ${borrowerName}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null
    );
  }

  mcEmailHtmlLines.push(
    referralLink ? `<p>Referral workspace: <a href="${referralLink}">${referralLink}</a></p>` : null,
    `<p>Please reach out to the agent to introduce yourself and fill them in on the details of ${borrowerFirstName}'s financing.</p>`
  );

  mcEmailTextLines.push(
    referralLink ? `Referral workspace: ${referralLink}` : null,
    `Please reach out to the agent to introduce yourself and fill them in on the details of ${borrowerFirstName}'s financing.`
  );

  await trySendEmail(
    lenderContact?.email ?? null,
    'New client referral',
    mcEmailHtmlLines.filter(Boolean),
    mcEmailTextLines.filter(Boolean),
    'mc',
    result
  );

  if (result.sent.length > 0) {
    await logReferralActivity({
      referralId: referral._id,
      actorRole: session.user.role,
      actorId: session.user.id,
      channel: 'email',
      content: `Admin sent intro emails to: ${result.sent.join(', ')}`,
    });
  }

  return NextResponse.json(result);
}
