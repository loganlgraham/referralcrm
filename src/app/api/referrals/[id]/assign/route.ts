import { differenceInMinutes } from 'date-fns';
import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { assignAgentSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { resolveAuditActorId } from '@/lib/server/audit';
import { logReferralActivity } from '@/lib/server/activities';
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
  const parsed = assignAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId name')
    .populate('buySideAgent', 'userId name')
    .populate('sellSideAgent', 'userId name')
    .populate('lender', 'userId');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (
    !canManageReferral(session, {
      assignedAgent: referral.assignedAgent,
      buySideAgent: referral.buySideAgent,
      sellSideAgent: referral.sellSideAgent,
      lender: referral.lender,
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const assignmentSide = parsed.data.side ?? (referral.clientType === 'Seller' ? 'sell' : 'buy');
  const previousAgentValue = (() => {
    if (assignmentSide === 'sell') return (referral.sellSideAgent as any)?._id ?? referral.sellSideAgent ?? null;
    return (referral.buySideAgent as any)?._id ?? referral.buySideAgent ?? null;
  })();
  const previousAgent = previousAgentValue ? previousAgentValue.toString() : null;
  if (assignmentSide === 'sell') {
    referral.sellSideAgent = parsed.data.agentId as any;
  } else {
    referral.buySideAgent = parsed.data.agentId as any;
  }
  referral.assignedAgent = referral.buySideAgent ?? referral.sellSideAgent ?? null;
  referral.statusLastUpdated = new Date();
  const sla = (referral.sla ??= {} as any);
  const createdAt = referral.createdAt instanceof Date ? referral.createdAt : new Date(referral.createdAt ?? Date.now());
  if (!Number.isNaN(createdAt.getTime()) && sla.timeToAssignmentHours == null) {
    const minutesSinceCreation = Math.max(differenceInMinutes(new Date(), createdAt), 0);
    sla.timeToAssignmentHours = Math.round((minutesSinceCreation / 60) * 10) / 10;
    referral.markModified('sla');
  }
  referral.audit = referral.audit || [];
  const auditEntry: Record<string, unknown> = {
    actorRole: session.user.role,
    field: `${assignmentSide}SideAgent`,
    previousValue: previousAgent,
    newValue: parsed.data.agentId,
    timestamp: new Date()
  };

  const auditActorId = resolveAuditActorId(session.user.id);
  if (auditActorId) {
    auditEntry.actorId = auditActorId;
  }

  referral.audit.push(auditEntry as any);
  await referral.save();

  type AgentNameLean = { _id: Types.ObjectId; name?: string | null; email?: string | null };

  const previousAgentPromise = previousAgent
    ? Agent.findById(previousAgent)
        .select('name')
        .lean<AgentNameLean | null>()
    : Promise.resolve<AgentNameLean | null>(null);

  const nextAgentPromise = Agent.findById(parsed.data.agentId)
    .select('name')
    .lean<AgentNameLean | null>();

  const [previousAgentDoc, nextAgentDoc] = await Promise.all([
    previousAgentPromise,
    nextAgentPromise,
  ]);

  const previousLabel = previousAgentDoc?.name?.trim() || 'Unassigned';
  const nextLabel = nextAgentDoc?.name?.trim() || 'Unassigned';
  const activityContent =
    previousAgent && previousAgent !== parsed.data.agentId
      ? `Reassigned ${assignmentSide} agent from ${previousLabel} to ${nextLabel}`
      : previousAgent
      ? `Confirmed ${assignmentSide} agent assignment for ${nextLabel}`
      : `Assigned ${assignmentSide} agent ${nextLabel}`;

  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: auditActorId ?? session.user.id,
    channel: 'update',
    content: activityContent,
  });

  const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const agentDetails = await Agent.findById(parsed.data.agentId)
    .select('name email')
    .lean<{ name?: string | null; email?: string | null }>();

  if (agentDetails?.email && isTransactionalEmailConfigured()) {
    const borrowerName = [
      referral.borrower?.firstName,
      referral.borrower?.lastName,
    ]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(' ');
    const borrowerEmail = referral.borrower?.email ?? '';
    const borrowerPhone = referral.borrower?.phone ?? '';
    const referralLink = baseUrl ? `${baseUrl}/referrals/${referral._id.toString()}` : '';
    const contactMadeLink = baseUrl
      ? `${baseUrl}/api/referrals/${referral._id.toString()}/contact-action?action=contact-made`
      : '';
    const contactAttemptedLink = baseUrl
      ? `${baseUrl}/api/referrals/${referral._id.toString()}/contact-action?action=contact-attempted`
      : '';

    const htmlLines = [
      `<p>Hi ${agentDetails.name ?? 'there'},</p>`,
      '<p>You have been assigned a new referral. Please reach out to the borrower as soon as possible, and within 24 hours.</p>',
      '<p>Borrower details:</p>',
      '<ul>',
      `<li><strong>Name:</strong> ${borrowerName || referral.borrower?.name || 'Unknown'}</li>`,
      borrowerEmail ? `<li><strong>Email:</strong> ${borrowerEmail}</li>` : null,
      borrowerPhone ? `<li><strong>Phone:</strong> ${borrowerPhone}</li>` : null,
      '</ul>',
      referralLink ? `<p>Review the referral: <a href="${referralLink}">${referralLink}</a></p>` : null,
      '<p>Update the referral status directly from these quick links:</p>',
      contactMadeLink
        ? `<p><a href="${contactMadeLink}">Contact made</a> – confirm you connected with the borrower.</p>`
        : null,
      contactAttemptedLink
        ? `<p><a href="${contactAttemptedLink}">Attempted but couldn’t reach</a> – log your outreach attempt.</p>`
        : null,
    ].filter(Boolean);

    const textLines = [
      `Hi ${agentDetails.name ?? 'there'},`,
      '',
      'You have been assigned a new referral. Please reach out to the borrower as soon as possible, and within 24 hours.',
      'Borrower details:',
      `Name: ${borrowerName || referral.borrower?.name || 'Unknown'}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null,
      referralLink ? `Review the referral: ${referralLink}` : null,
      contactMadeLink ? `Contact made: ${contactMadeLink}` : null,
      contactAttemptedLink ? `Attempted but couldn’t reach: ${contactAttemptedLink}` : null,
    ].filter(Boolean);

    try {
      await sendTransactionalEmail({
        to: [agentDetails.email],
        subject: 'New referral assignment',
        html: htmlLines.join(''),
        text: textLines.join('\n'),
      });
    } catch (error) {
      console.error('Failed to send agent referral assignment email', error);
    }
  }

  return NextResponse.json({ id: referral._id.toString() });
}
