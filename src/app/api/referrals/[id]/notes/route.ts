import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { createReferralNoteSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';
import { sendTransactionalEmail } from '@/lib/email';

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = createReferralNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId name email')
    .populate('lender', 'userId name email');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canViewReferral(session, {
      assignedAgent: referral.assignedAgent,
      lender: referral.lender,
      org: referral.org
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const allowHidden = session.user.role === 'admin' || session.user.role === 'manager';
  const note = {
    author: session.user.id as any,
    authorName: session.user.name || session.user.email || 'Team Member',
    authorRole: session.user.role,
    content: parsed.data.content,
    hiddenFromAgent: allowHidden ? Boolean(parsed.data.hiddenFromAgent) : false,
    hiddenFromMc: allowHidden ? Boolean(parsed.data.hiddenFromMc) : false,
    createdAt: new Date(),
    emailedTargets: [] as ('agent' | 'mc')[]
  } as any;

  const requestedTargets = new Set(parsed.data.emailTargets ?? []);
  const recipients: { email: string; name: string; target: 'agent' | 'mc' }[] = [];

  if (
    requestedTargets.has('agent') &&
    referral.assignedAgent &&
    'email' in referral.assignedAgent &&
    referral.assignedAgent.email &&
    !note.hiddenFromAgent
  ) {
    recipients.push({
      email: referral.assignedAgent.email as string,
      name: (referral.assignedAgent as any).name || 'Agent',
      target: 'agent'
    });
  }

  if (
    requestedTargets.has('mc') &&
    referral.lender &&
    'email' in referral.lender &&
    referral.lender.email &&
    !note.hiddenFromMc
  ) {
    recipients.push({
      email: referral.lender.email as string,
      name: (referral.lender as any).name || 'MC',
      target: 'mc'
    });
  }

  let emailedTargets: ('agent' | 'mc')[] = [];
  let deliveryFailed = false;

  if (requestedTargets.size > 0) {
    if (recipients.length === 0) {
      deliveryFailed = true;
    } else {
      const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
      const referralLink = baseUrl
        ? `${baseUrl}/referrals/${referral._id.toString()}`
        : undefined;

      const borrowerName = referral.borrower?.name ?? 'this referral';
      const authorName = note.authorName ?? 'A team member';
      const plainContent = note.content;
      const htmlContent = note.content.replace(/\n/g, '<br />');

      const delivered = await sendTransactionalEmail({
        to: recipients.map((recipient) => recipient.email),
        subject: `New note on ${borrowerName}`,
        html: `<p>${authorName} added a new note on ${borrowerName}.</p>
        <blockquote style="margin: 1rem 0; padding-left: 1rem; border-left: 4px solid #cbd5f5;">${htmlContent}</blockquote>
        ${
          referralLink
            ? `<p>Review the referral: <a href="${referralLink}">${referralLink}</a></p>`
            : ''
        }`,
        text: `${authorName} added a new note on ${borrowerName}.

${plainContent}

${referralLink ? `Review the referral: ${referralLink}` : ''}`
      });

      if (delivered) {
        emailedTargets = recipients.map((recipient) => recipient.target);
        note.emailedTargets = emailedTargets;
      } else {
        deliveryFailed = true;
      }
    }
  }

  referral.notes = referral.notes || [];
  referral.notes.push(note);
  await referral.save();

  const saved = referral.notes[referral.notes.length - 1];

  return NextResponse.json(
    {
      id: saved._id.toString(),
      createdAt: saved.createdAt,
      authorRole: saved.authorRole,
      authorName: saved.authorName,
      content: saved.content,
      hiddenFromAgent: saved.hiddenFromAgent,
      hiddenFromMc: saved.hiddenFromMc,
      emailedTargets,
      deliveryFailed
    },
    { status: 201 }
  );
}
