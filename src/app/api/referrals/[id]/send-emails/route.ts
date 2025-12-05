import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { logReferralActivity } from '@/lib/server/activities';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';

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

  if (session.user.role !== 'admin') {
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

  const primaryAgent =
    normalizeContact(referral.buySideAgent) ||
    normalizeContact(referral.sellSideAgent) ||
    normalizeContact(referral.assignedAgent);
  const lenderContact = normalizeContact(referral.lender);
  const borrower = referral.borrower ?? {};
  const borrowerContact = extractBorrowerContact(referral);
  const borrowerName = borrowerContact.name || buildBorrowerName(borrower);
  const borrowerFirstName = buildBorrowerFirstName(borrower);
  const agentFirstName = firstNameFromContact(primaryAgent, 'your agent');
  const lenderFirstName = firstNameFromContact(lenderContact, 'your mortgage consultant');
  const borrowerEmail = borrowerContact.email ?? null;
  const borrowerPhone = borrowerContact.phone;
  const referralLinkBase = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const referralLink = referralLinkBase ? `${referralLinkBase}/referrals/${referral._id.toString()}` : '';

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

  await trySendEmail(
    lenderContact?.email ?? null,
    'New client referral',
    [
      `<p>Hi ${lenderContact?.name ?? 'there'},</p>`,
      `<p>The agent who will be helping ${borrowerName} is:</p>`,
      '<ul>',
      primaryAgent
        ? '<li>' + formatContactLines(primaryAgent, 'Agent').join('<br/>') + '</li>'
        : null,
      '</ul>',
      referralLink ? `<p>Referral workspace: <a href="${referralLink}">${referralLink}</a></p>` : null,
      `<p>Please reach out to the agent to introduce yourself and fill them in on the details of ${borrowerFirstName}'s financing.</p>`,
    ],
    [
      `Hi ${lenderContact?.name ?? 'there'},`,
      `The agent who will be helping ${borrowerName} is:`,
      primaryAgent
        ? formatContactLines(primaryAgent, 'Agent').join(' | ')
        : null,
      referralLink ? `Referral workspace: ${referralLink}` : null,
      `Please reach out to the agent to introduce yourself and fill them in on the details of ${borrowerFirstName}'s financing.`,
    ],
    'mc',
    result
  );

  await trySendEmail(
    borrowerEmail,
    "Welcome to American Financing's Buyer Concierge Service",
    [
      `<p>Hi ${borrowerFirstName},</p>`,
      "<p>I want to thank you again for your interest in our Buyers Concierge Program. This program is tailored to support Buyers like you as you navigate the home-buying process with American Financing and to connect you with a top-tier local realtor.</p>",
      `<p>I’m excited to introduce you to ${primaryAgent?.name ?? 'a local and trusted Real Estate Specialist'}, a local and trusted Real Estate Specialist who will be assisting you with your home purchase.</p>`,
      `<p>Below are ${agentFirstName}'s contact details. You can expect them to reach out to you shortly:</p>`,
      '<ul>',
      primaryAgent?.name ? `<li>${primaryAgent.name}</li>` : null,
      primaryAgent?.phone ? `<li>${primaryAgent.phone}</li>` : null,
      primaryAgent?.email ? `<li>${primaryAgent.email}</li>` : null,
      '</ul>',
      `<p>If, at any point, you have trouble reaching ${agentFirstName} or are not fully satisfied with the services provided, please don’t hesitate to contact ${lenderFirstName} or me. We are committed to supporting you every step of the way.</p>`,
      '<p>Thank you once again, and happy home shopping!</p>',
    ],
    [
      `Hi ${borrowerFirstName},`,
      'I want to thank you again for your interest in our Buyers Concierge Program. This program is tailored to support Buyers like you as you navigate the home-buying process with American Financing and to connect you with a top-tier local realtor.',
      `I’m excited to introduce you to ${primaryAgent?.name ?? 'a local and trusted Real Estate Specialist'}, a local and trusted Real Estate Specialist who will be assisting you with your home purchase.`,
      `Below are ${agentFirstName}'s contact details. You can expect them to reach out to you shortly:`,
      primaryAgent?.name ? `${primaryAgent.name}` : null,
      primaryAgent?.phone ? `${primaryAgent.phone}` : null,
      primaryAgent?.email ? `${primaryAgent.email}` : null,
      `If, at any point, you have trouble reaching ${agentFirstName} or are not fully satisfied with the services provided, please don’t hesitate to contact ${lenderFirstName} or me. We are committed to supporting you every step of the way.`,
      'Thank you once again, and happy home shopping!',
    ],
    'referral',
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
