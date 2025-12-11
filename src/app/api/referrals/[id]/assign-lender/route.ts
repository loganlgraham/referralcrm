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
import { buildReferralLink } from '@/lib/referral-links';
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
    .populate('assignedAgent', 'userId name email phone')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
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
      buySideAgent: referral.buySideAgent,
      sellSideAgent: referral.sellSideAgent,
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

  const isNewAssignment = !previousLender || previousLender !== parsed.data.lenderId;
  const lenderEmail = nextLenderDoc?.email?.trim();

  if (isNewAssignment && lenderEmail && isTransactionalEmailConfigured()) {
    const borrowerName = referral.borrower?.name?.trim() || 'your referral';
    const borrowerEmail = referral.borrower?.email?.trim();
    const borrowerPhone = referral.borrower?.phone?.trim();
    const referralLink = buildReferralLink(referral._id.toString());
    const agentContact = referral.assignedAgent as
      | { name?: string; email?: string; phone?: string }
      | null
      | undefined;
    const agentName = typeof agentContact?.name === 'string' ? agentContact.name.trim() : '';
    const agentEmail = typeof agentContact?.email === 'string' ? agentContact.email.trim() : '';
    const agentPhone = typeof agentContact?.phone === 'string' ? agentContact.phone.trim() : '';

    const borrowerLines = [
      `Borrower: ${borrowerName}`,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${borrowerPhone}` : null,
    ].filter(Boolean) as string[];

    const agentLines = [agentName, agentEmail, agentPhone].filter((line) => line && line.trim()) as string[];

    const greetingName = nextLenderDoc?.name?.trim() || 'there';
    const html = `
      <p>Hi ${greetingName},</p>
      <p>You have been assigned a new referral.</p>
      <p>${borrowerLines.join('<br />')}</p>
      ${
        agentLines.length > 0
          ? `<p><strong>Agent who sent it:</strong><br />${agentLines.join('<br />')}</p>`
          : ''
      }
      <p><a href="${referralLink}">View the referral</a> to acknowledge and follow up.</p>
    `;
    const text = `Hi ${greetingName},

You have been assigned a new referral.
${borrowerLines.join('\n')}

${agentLines.length > 0 ? `Agent who sent it:\n${agentLines.join('\n')}\n\n` : ''}View the referral: ${referralLink}`;

    try {
      await sendTransactionalEmail({
        to: [lenderEmail],
        subject: `New referral: ${borrowerName}`,
        html,
        text,
      });
    } catch (error) {
      console.error('Failed to deliver MC assignment email', error);
    }
  }

  return NextResponse.json({ id: referral._id.toString() });
}
