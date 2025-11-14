import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { assignLenderSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { resolveAuditActorId } from '@/lib/server/audit';
import { logReferralActivity } from '@/lib/server/activities';
import { Types } from 'mongoose';

import { LenderMC } from '@/models/lender';
import { Agent } from '@/models/agent';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = assignLenderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId name');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canManageReferral(session, {
      assignedAgent: referral.assignedAgent,
      lender: referral.lender,
      org: referral.org
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const previousLenderValue = (referral.lender as any)?._id ?? referral.lender ?? null;
  const previousLender = previousLenderValue ? previousLenderValue.toString() : null;
  referral.lender = parsed.data.lenderId as any;
  referral.audit = referral.audit || [];
  const auditEntry: Record<string, unknown> = {
    actorRole: session.user.role,
    field: 'lender',
    previousValue: previousLender,
    newValue: parsed.data.lenderId,
    timestamp: new Date()
  };

  const auditActorId = resolveAuditActorId(session.user.id);
  if (auditActorId) {
    auditEntry.actorId = auditActorId;
  }

  referral.audit.push(auditEntry as any);
  await referral.save();

  const previousLenderDoc = previousLender
    ? await LenderMC.findById(previousLender)
        .select('name email')
        .lean<{ _id: Types.ObjectId; name?: string; email?: string }>()
    : null;
  const nextLenderDoc = await LenderMC.findById(parsed.data.lenderId)
    .select('name email')
    .lean<{ _id: Types.ObjectId; name?: string; email?: string }>();

  const previousLabel = previousLenderDoc?.name?.trim() || 'Unassigned';
  const nextLabel = nextLenderDoc?.name?.trim() || 'Unassigned';
  const activityContent =
    previousLender && previousLender !== parsed.data.lenderId
      ? `Reassigned mortgage consultant from ${previousLabel} to ${nextLabel}`
      : previousLender
      ? `Confirmed mortgage consultant assignment for ${nextLabel}`
      : `Assigned mortgage consultant ${nextLabel}`;

  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: auditActorId ?? session.user.id,
    channel: 'update',
    content: activityContent,
  });

  const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (
    referral.origin === 'agent' &&
    (!previousLender || previousLender !== parsed.data.lenderId) &&
    nextLenderDoc?.email &&
    isTransactionalEmailConfigured()
  ) {
    const borrowerName = [
      referral.borrower?.firstName,
      referral.borrower?.lastName,
    ]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(' ');
    const borrowerEmail = referral.borrower?.email ?? '';
    const borrowerPhone = referral.borrower?.phone ?? '';

    const agentId = (() => {
      if (!referral.assignedAgent) {
        return null;
      }
      if (referral.assignedAgent instanceof Types.ObjectId) {
        return referral.assignedAgent;
      }
      if (typeof (referral.assignedAgent as any)._id === 'string') {
        return new Types.ObjectId((referral.assignedAgent as any)._id);
      }
      if ((referral.assignedAgent as any)._id instanceof Types.ObjectId) {
        return (referral.assignedAgent as any)._id as Types.ObjectId;
      }
      return null;
    })();

    const agentDetails = agentId
      ? await Agent.findById(agentId).select('name email phone').lean<{ name?: string; email?: string; phone?: string }>()
      : null;

    const agentName = agentDetails?.name?.trim() || 'Your partner agent';
    const agentEmail = agentDetails?.email ?? '';
    const agentPhone = agentDetails?.phone ?? '';
    const referralLink = baseUrl ? `${baseUrl}/referrals/${referral._id.toString()}` : '';

    const htmlLines = [
      `<p>Hi ${nextLenderDoc.name ?? 'there'},</p>`,
      `<p>${agentName} just referred a client for mortgage support. Here are the details so you can reach out right away:</p>`,
      '<ul>',
      `<li><strong>Borrower:</strong> ${borrowerName || 'Unknown'}</li>`,
      borrowerEmail ? `<li><strong>Email:</strong> ${borrowerEmail}</li>` : null,
      borrowerPhone ? `<li><strong>Phone:</strong> ${borrowerPhone}</li>` : null,
      `<li><strong>Referring agent:</strong> ${agentName}</li>`,
      agentEmail ? `<li><strong>Agent email:</strong> ${agentEmail}</li>` : null,
      agentPhone ? `<li><strong>Agent phone:</strong> ${agentPhone}</li>` : null,
      '</ul>',
      referralLink
        ? `<p>You can review the referral here: <a href="${referralLink}">${referralLink}</a>.</p>`
        : null,
      '<p>Please let the agent know once you have connected with the client.</p>',
    ].filter(Boolean);

    const html = htmlLines.join('');
    const textLines = [
      `Hi ${nextLenderDoc.name ?? 'there'},`,
      '',
      `${agentName} just referred a client for mortgage support. Here are the details so you can reach out right away:`,
      `Borrower: ${borrowerName || 'Unknown'}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null,
      `Referring agent: ${agentName}`,
      agentEmail ? `Agent email: ${agentEmail}` : null,
      agentPhone ? `Agent phone: ${agentPhone}` : null,
      referralLink ? `Review the referral: ${referralLink}` : null,
      '',
      'Please let the agent know once you have connected with the client.',
    ].filter(Boolean);

    try {
      await sendTransactionalEmail({
        to: [nextLenderDoc.email],
        subject: `New client referral from ${agentName}`,
        html,
        text: textLines.join('\n'),
      });
    } catch (error) {
      console.error('Failed to send lender referral notification', error);
    }
  }

  return NextResponse.json({ id: referral._id.toString() });
}
