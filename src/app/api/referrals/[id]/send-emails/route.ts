import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { logReferralActivity } from '@/lib/server/activities';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { buildContactActionLink, buildReferralLink, getReferralAppBaseUrl } from '@/lib/referral-links';
import {
  renderAgentIntroEmail,
  renderMcIntroEmail,
  renderPairingSummaryEmail,
} from '@/lib/email-templates/referral-ops';
import {
  buildCcList,
  getReferralNotificationRecipients,
  parseCcRecipients,
} from '@/lib/server/cc-recipients';


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

const extractMcContact = (referral: any): BasicContact | null => {
  const lenderContact = normalizeContact(referral.lender);
  if (lenderContact) return lenderContact;

  const fallbackEmail =
    coerceContactField(referral.lenderEmail) ||
    coerceContactField(referral.borrower?.loanOfficerEmail) ||
    coerceContactField(referral.borrower?.lenderEmail) ||
    coerceContactField(referral.inboundEmail?.fields?.loanofficeremail) ||
    coerceContactField(referral.inboundEmail?.fields?.mcemail);

  const fallbackName =
    coerceContactField(referral.borrower?.loanOfficerName) ||
    coerceContactField(referral.inboundEmail?.fields?.loanofficername) ||
    coerceContactField(referral.inboundEmail?.fields?.mcname) ||
    coerceContactField(referral.lenderName);

  const fallbackPhone =
    coerceContactField(referral.borrower?.loanOfficerPhone) ||
    coerceContactField(referral.inboundEmail?.fields?.loanofficerphone) ||
    coerceContactField(referral.inboundEmail?.fields?.mcphone) ||
    coerceContactField(referral.lenderPhone);

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
  html: string,
  text: string,
  label: string,
  result: SendResult,
  cc?: string[]
) => {
  const to = typeof toAddress === 'string' && toAddress.trim().length > 0 ? toAddress.trim() : null;
  if (!to) {
    result.skipped.push(label);
    return;
  }

  const success = await sendTransactionalEmail({
    to: [to],
    subject,
    html,
    text,
    cc: cc ? buildCcList(cc, [], to) : undefined,
  });

  if (success) {
    result.sent.push(label);
  } else {
    result.errors.push(label);
  }
};

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
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

  let notes: string | null = null;
  let agentCcExtras: string[] = [];
  let mcCcExtras: string[] = [];
  try {
    const body = await request.json();
    if (typeof body?.notes === 'string' && body.notes.trim()) {
      notes = body.notes.trim();
    }

    const agentCc = parseCcRecipients(body?.agentCcRecipients);
    const mcCc = parseCcRecipients(body?.mcCcRecipients);
    const invalid = [...agentCc.invalid, ...mcCc.invalid];
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid CC email address(es): ${invalid.join(', ')}` },
        { status: 400 }
      );
    }

    agentCcExtras = agentCc.emails;
    mcCcExtras = mcCc.emails;
  } catch {
    // Body is empty or not JSON, which is fine
  }

  await connectMongo();
  const referral = await Referral.findOne({ _id: params.id, deletedAt: null })
    .populate('assignedAgent', 'name email phone ahaDesignation')
    .populate('buySideAgent', 'name email phone ahaDesignation')
    .populate('sellSideAgent', 'name email phone ahaDesignation')
    .populate('lender', 'name email phone');

  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Check if any attached agent has AGIT designation - skip all automated emails
  const hasAgitAgent =
    (referral.assignedAgent as any)?.ahaDesignation === 'AGIT' ||
    (referral.buySideAgent as any)?.ahaDesignation === 'AGIT' ||
    (referral.sellSideAgent as any)?.ahaDesignation === 'AGIT';

  if (hasAgitAgent) {
    return NextResponse.json({
      sent: [],
      skipped: ['agent', 'mc', 'admin'],
      errors: [],
      message: 'Emails skipped - AGIT agent attached to referral'
    });
  }

  const buySideContact = normalizeContact(referral.buySideAgent);
  const sellSideContact = normalizeContact(referral.sellSideAgent);
  const primaryAgent = buySideContact || sellSideContact || normalizeContact(referral.assignedAgent);
  const lenderContact = extractMcContact(referral);
  const borrower = referral.borrower ?? {};
  const borrowerContact = extractBorrowerContact(referral);
  const borrowerName = borrowerContact.name || buildBorrowerName(borrower);
  const borrowerFirstName = buildBorrowerFirstName(borrower);
  const loanFileNumber = referral.loanFileNumber?.trim() || 'N/A';
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

  // CC email for intro emails, plus any extras the admin added in the send confirmation
  const defaultIntroEmailCC = getReferralNotificationRecipients();
  const agentEmailCC = buildCcList(defaultIntroEmailCC, agentCcExtras);
  const mcEmailCC = buildCcList(defaultIntroEmailCC, mcCcExtras);

  const shouldEmailAgent = referral.origin !== 'agent';
  const isSellerOnly = referral.clientType === 'Seller';
  const agentEmailSubject =
    session.user.role === 'admin' ? 'American Home Agents - New Referral!' : `New referral for ${borrowerName}`;
  const buildAgentIntroCopy = (side: 'buy' | 'sell') => {
    if (side === 'sell' || isSellerOnly) {
      return session.user.role === 'admin'
        ? `Thanks for partnering with the American Home Agents Concierge Service to help our referral, ${borrowerName}, sell their home!`
        : `Thanks for partnering with the American Home Agents Concierge Service to help ${borrowerName} sell their home!`;
    }

    return session.user.role === 'admin'
      ? `Thanks for partnering with the American Home Agents Concierge Service to help our referral, ${borrowerName}. We're excited to get them in their new home!`
      : `Thanks for partnering with the American Home Agents Concierge Service to help ${borrowerName}. We're excited to get them in their new home!`;
  };

  if (shouldEmailAgent) {
    const agentTargets: Array<{ label: string; side: 'buy' | 'sell'; contact: BasicContact | null }> = [];

    if (referral.clientType === 'Both') {
      if (buySideContact) {
        agentTargets.push({ label: 'agent-buy', side: 'buy', contact: buySideContact });
      }
      if (sellSideContact) {
        agentTargets.push({ label: 'agent-sell', side: 'sell', contact: sellSideContact });
      }
    } else if (isSellerOnly) {
      agentTargets.push({ label: 'agent', side: 'sell', contact: sellSideContact || primaryAgent });
    } else {
      agentTargets.push({ label: 'agent', side: 'buy', contact: buySideContact || primaryAgent });
    }

    if (agentTargets.length === 0 && primaryAgent) {
      agentTargets.push({ label: 'agent', side: 'buy', contact: primaryAgent });
    }

    for (const { label, side, contact } of agentTargets) {
      const agentFirstName = firstNameFromContact(contact, 'your agent');
      const oppositeAgentContact = side === 'buy' ? sellSideContact : buySideContact;
      const oppositeAgentLabel =
        side === 'buy'
          ? 'Selling Agent at American Home Agents'
          : 'Buying Agent';
      const rendered = renderAgentIntroEmail({
        agentFirstName,
        introCopy: buildAgentIntroCopy(side),
        borrowerName,
        borrowerEmail: borrowerEmail ?? 'Not provided',
        borrowerPhone: borrowerPhone ?? 'Not provided',
        notes,
        oppositeAgent: oppositeAgentContact
          ? {
              label: oppositeAgentLabel,
              contact: {
                name: oppositeAgentContact.name ?? 'N/A',
                email: oppositeAgentContact.email ?? 'N/A',
                phone: oppositeAgentContact.phone ?? 'N/A',
              },
            }
          : null,
        mc: isSellerOnly
          ? null
          : {
              name: lenderContact?.name ?? 'Not provided',
              email: lenderContact?.email ?? 'Not provided',
              phone: lenderContact?.phone ?? 'Not provided',
              loanFileNumber,
            },
        isSellerOnly,
        borrowerFirstName,
        contactMadeLink,
        contactAttemptedLink,
        referralLink: referralLink || undefined,
      });

      await trySendEmail(
        contact?.email ?? null,
        agentEmailSubject,
        rendered.html,
        rendered.text,
        label,
        result,
        agentEmailCC
      );
    }
  }

  const mcAgentContacts: Array<{ label: string; contact: BasicContact }> = [];

  const pairedFallbackContact = primaryAgent ?? normalizeContact(referral.assignedAgent);

  if (referral.clientType === 'Both') {
    if (buySideContact || pairedFallbackContact) {
      mcAgentContacts.push({ label: 'Buying Agent', contact: buySideContact ?? pairedFallbackContact! });
    }

    if (sellSideContact) {
      mcAgentContacts.push({ label: 'Selling Agent', contact: sellSideContact });
    }
  } else if (referral.clientType === 'Seller') {
    if (sellSideContact || pairedFallbackContact) {
      mcAgentContacts.push({ label: 'Selling Agent', contact: sellSideContact ?? pairedFallbackContact! });
    }
  } else {
    if (buySideContact || pairedFallbackContact) {
      mcAgentContacts.push({ label: 'Buying Agent', contact: buySideContact ?? pairedFallbackContact! });
    }
  }

  if (mcAgentContacts.length === 0 && primaryAgent) {
    mcAgentContacts.push({ label: 'Agent', contact: primaryAgent });
  }

  const mcRendered = renderMcIntroEmail({
    lenderFirstName,
    borrowerName,
    loanFileNumber,
    agents: mcAgentContacts.map(({ label, contact }) => ({
      label,
      name: contact.name ?? 'N/A',
      email: contact.email ?? 'N/A',
      phone: contact.phone ?? 'N/A',
    })),
    includeBorrowerDetails: session.user.role === 'agent',
    borrowerEmail,
    borrowerPhone,
    borrowerFirstName,
    referralLink: referralLink || undefined,
  });

  // Skip MC email for seller-only referrals (no mortgage consultant needed)
  if (referral.clientType !== 'Seller') {
    await trySendEmail(
      lenderContact?.email ?? null,
      `Agent helping ${borrowerName}`,
      mcRendered.html,
      mcRendered.text,
      'mc',
      result,
      mcEmailCC
    );
  }

  // Send notification email to logan.graham@americanfinancing.net when referral is paired
  if (result.sent.length > 0) {
    (async () => {
      try {
        const pairedContacts: Array<{ label: string; contact: BasicContact }> = [];

        if (primaryAgent) {
          if (referral.clientType === 'Both') {
            if (buySideContact) {
              pairedContacts.push({ label: 'Buying Agent', contact: buySideContact });
            }
            if (sellSideContact) {
              pairedContacts.push({ label: 'Selling Agent', contact: sellSideContact });
            }
          } else if (referral.clientType === 'Seller' && sellSideContact) {
            pairedContacts.push({ label: 'Selling Agent', contact: sellSideContact });
          } else if (buySideContact) {
            pairedContacts.push({ label: 'Buying Agent', contact: buySideContact });
          }
          
          // If no specific side agent but there's a primary agent
          if (pairedContacts.length === 0 && primaryAgent) {
            pairedContacts.push({ label: 'Agent', contact: primaryAgent });
          }
        }

        if (lenderContact && referral.clientType !== 'Seller') {
          pairedContacts.push({ label: 'Mortgage Consultant', contact: lenderContact });
        }

        const referralLink = referralLinkBase ? buildReferralLink(referral._id.toString()) : '';

        const introSubject = `Introduction – Partnering on ${borrowerFirstName}'s Home Search`;
        const agentEntries = pairedContacts.filter(({ label }) => label !== 'Mortgage Consultant');
        const introLinks: Array<{ label: string; url: string }> = [];

        for (const { contact } of agentEntries) {
          if (!contact.email) continue;
          const agentFirst = firstNameFromContact(contact, 'your agent');
          const introBody = [
            `Hi ${agentFirst},`,
            '',
            `I wanted to take a quick moment to introduce you to ${lenderFirstName}, the Mortgage Consultant here at American Financing who's been working with ${borrowerFirstName} on their pre-approval.`,
            '',
            `I understand ${borrowerFirstName} has been paired with you through our partnership with American Home Agents, and we're excited for you to connect and help guide them through their home search!`,
            '',
            `${lenderFirstName} will be reaching out shortly to introduce themselves and share a bit more detail about ${borrowerFirstName}'s loan status and qualifications, so you're both on the same page as the search begins.`,
            '',
            "I'll be here as a resource in the background to help coordinate communication and ensure a smooth process from pre-approval through closing. Please don't hesitate to reach out if you need anything along the way.",
            '',
            `Looking forward to working together to help ${borrowerFirstName} find their new home!`,
            '',
            'Best regards,',
            'Logan'
          ].join('\n');

          const composePageParams = new URLSearchParams();
          composePageParams.set('to', contact.email);
          composePageParams.set('cc', lenderContact?.email ?? '');
          composePageParams.set('subject', introSubject);
          composePageParams.set('body', introBody);
          const composePageUrl = `${referralLinkBase}/compose-email?${composePageParams.toString()}`;
          introLinks.push({ label: contact.name ?? 'Agent', url: composePageUrl });
        }

        const pairing = renderPairingSummaryEmail({
          borrowerName,
          loanFileNumber,
          clientType: referral.clientType,
          pairedMembers: pairedContacts.map(({ label, contact }) => ({
            label,
            name: contact.name ?? 'N/A',
            email: contact.email ?? undefined,
            phone: contact.phone ?? undefined,
          })),
          referralLink: referralLink || undefined,
          introLinks,
        });

        await sendTransactionalEmail({
          to: ['logan.graham@americanfinancing.net'],
          subject: `Referral Paired: ${borrowerName}`,
          html: pairing.html,
          text: pairing.text
        });
      } catch (error) {
        console.error('Failed to send referral pairing notification email', error);
      }
    })().catch((error) => {
      console.error('Failed to send referral pairing notification email', error);
    });

    const ccSummaryParts: string[] = [];
    if (agentCcExtras.length > 0) {
      ccSummaryParts.push(`agent CC: ${agentCcExtras.join(', ')}`);
    }
    if (mcCcExtras.length > 0) {
      ccSummaryParts.push(`MC CC: ${mcCcExtras.join(', ')}`);
    }

    await logReferralActivity({
      referralId: referral._id,
      actorRole: session.user.role,
      actorId: session.user.id,
      channel: 'email',
      content: `Admin sent intro emails to: ${result.sent.join(', ')}${
        ccSummaryParts.length > 0 ? ` (${ccSummaryParts.join('; ')})` : ''
      }`,
    });
  }

  return NextResponse.json({
    ...result,
    agentCcRecipients: agentCcExtras,
    mcCcRecipients: mcCcExtras,
  });
}
