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

const buildBorrowerName = (borrower: any): string => {
  const parts = [borrower?.firstName, borrower?.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  if (typeof borrower?.name === 'string' && borrower.name.trim()) return borrower.name.trim();
  return 'the buyer';
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
  const borrowerName = buildBorrowerName(borrower);
  const borrowerEmail = typeof borrower.email === 'string' ? borrower.email : null;
  const borrowerPhone = typeof borrower.phone === 'string' ? borrower.phone : null;
  const referralLinkBase = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const referralLink = referralLinkBase ? `${referralLinkBase}/referrals/${referral._id.toString()}` : '';

  const result: SendResult = { sent: [], skipped: [], errors: [] };

  await trySendEmail(
    primaryAgent?.email ?? null,
    'New referral introduction',
    [
      `<p>Hi ${primaryAgent?.name ?? 'there'},</p>`,
      `<p>Thanks for partnering with American Financing's Buyer Concierge Service on ${borrowerName}.` +
        " We're excited to help them on their home search.</p>",
      '<p>Here are the key details so you can reach out confidently:</p>',
      '<ul>',
      `<li><strong>Borrower:</strong> ${borrowerName}</li>`,
      borrowerEmail ? `<li><strong>Email:</strong> ${borrowerEmail}</li>` : null,
      borrowerPhone ? `<li><strong>Phone:</strong> ${borrowerPhone}</li>` : null,
      lenderContact
        ? '<li><strong>Mortgage Consultant:</strong><br/>' +
          formatContactLines(lenderContact, 'Mortgage Consultant').join('<br/>') +
          '</li>'
        : null,
      '</ul>',
      referralLink ? `<p>Referral workspace: <a href="${referralLink}">${referralLink}</a></p>` : null,
      '<p>Thank you for taking great care of this client.</p>',
    ],
    [
      `Hi ${primaryAgent?.name ?? 'there'},`,
      `Thanks for partnering with American Financing's Buyer Concierge Service on ${borrowerName}. We're excited to help them on their home search.`,
      'Here are the key details so you can reach out confidently:',
      `Borrower: ${borrowerName}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null,
      lenderContact
        ? `Mortgage Consultant: ${formatContactLines(lenderContact, 'Mortgage Consultant').join(' | ')}`
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
      `<p>Thank you for supporting ${borrowerName} through American Financing's Buyer Concierge Service.</p>`,
      '<p>Here is what you need to reach out:</p>',
      '<ul>',
      `<li><strong>Borrower:</strong> ${borrowerName}</li>`,
      borrowerEmail ? `<li><strong>Email:</strong> ${borrowerEmail}</li>` : null,
      borrowerPhone ? `<li><strong>Phone:</strong> ${borrowerPhone}</li>` : null,
      primaryAgent
        ? '<li><strong>Partner agent:</strong><br/>' +
          formatContactLines(primaryAgent, 'Agent').join('<br/>') +
          '</li>'
        : null,
      '</ul>',
      referralLink ? `<p>Referral workspace: <a href="${referralLink}">${referralLink}</a></p>` : null,
      '<p>Please keep the agent updated after you connect with the borrower.</p>',
    ],
    [
      `Hi ${lenderContact?.name ?? 'there'},`,
      `Thank you for supporting ${borrowerName} through American Financing's Buyer Concierge Service.`,
      'Here is what you need to reach out:',
      `Borrower: ${borrowerName}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null,
      primaryAgent
        ? `Partner agent: ${formatContactLines(primaryAgent, 'Agent').join(' | ')}`
        : null,
      referralLink ? `Referral workspace: ${referralLink}` : null,
      'Please keep the agent updated after you connect with the borrower.',
    ],
    'mc',
    result
  );

  await trySendEmail(
    borrowerEmail,
    "Welcome to American Financing's Buyer Concierge Service",
    [
      `<p>Hi ${borrowerName},</p>`,
      "<p>Thank you for choosing American Financing's Buyer Concierge Service. We're thrilled to support your home search and make the process easy.</p>",
      primaryAgent
        ? `<p>Your agent, ${primaryAgent.name ?? 'your partner agent'}, is here to help every step of the way.</p>`
        : '<p>Your partner agent is excited to help every step of the way.</p>',
      '<p>You can reach your agent at:</p>',
      '<ul>',
      primaryAgent?.name ? `<li><strong>Name:</strong> ${primaryAgent.name}</li>` : null,
      primaryAgent?.email ? `<li><strong>Email:</strong> ${primaryAgent.email}</li>` : null,
      primaryAgent?.phone ? `<li><strong>Phone:</strong> ${primaryAgent.phone}</li>` : null,
      '</ul>',
      '<p>If you have any questions or need support, just let us know. Happy home hunting!</p>',
    ],
    [
      `Hi ${borrowerName},`,
      "Thank you for choosing American Financing's Buyer Concierge Service. We're thrilled to support your home search and make the process easy.",
      primaryAgent
        ? `Your agent, ${primaryAgent.name ?? 'your partner agent'}, is here to help every step of the way.`
        : 'Your partner agent is excited to help every step of the way.',
      'You can reach your agent at:',
      primaryAgent?.name ? `Name: ${primaryAgent.name}` : null,
      primaryAgent?.email ? `Email: ${primaryAgent.email}` : null,
      primaryAgent?.phone ? `Phone: ${primaryAgent.phone}` : null,
      'If you have any questions or need support, just let us know. Happy home hunting!',
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
