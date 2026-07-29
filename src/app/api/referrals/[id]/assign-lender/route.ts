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
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import {
  deriveReferralStatusFromSides,
  pickPrimarySideForReferral,
} from '@/lib/server/referral-sides';

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
    .populate('assignedAgent', 'userId name email phone ahaDesignation')
    .populate('buySideAgent', 'userId ahaDesignation')
    .populate('sellSideAgent', 'userId ahaDesignation')
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

  if (session.user.role !== 'admin') {
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

  const isNewAssignment = !previousLender || previousLender !== parsed.data.lenderId;
  const previousStatusRaw = referral.status;
  const previousStatus = previousStatusRaw === 'Showing Homes' ? 'Active Lead' : previousStatusRaw;
  let advancedToPaired = false;
  const now = new Date();

  // Agent-sent AFC referrals: assigning an MC completes pairing.
  if (isNewAssignment && referral.origin === 'agent' && previousStatus === 'New Lead') {
    const clientType = referral.clientType ?? null;
    if (clientType === 'Both') {
      referral.buyStatus = 'Paired';
      referral.sellStatus = 'Paired';
    } else if (clientType === 'Seller') {
      referral.sellStatus = 'Paired';
      referral.dealSide = 'sell';
    } else {
      // Buyer (default) or missing clientType
      const side = pickPrimarySideForReferral({
        buySideAgent: referral.buySideAgent as any,
        sellSideAgent: referral.sellSideAgent as any,
        assignedAgent: referral.assignedAgent as any,
        dealSide: referral.dealSide ?? null,
        clientType,
      });
      if (side === 'sell') {
        referral.sellStatus = 'Paired';
        referral.dealSide = 'sell';
      } else {
        referral.buyStatus = 'Paired';
        referral.dealSide = 'buy';
      }
    }

    referral.status = deriveReferralStatusFromSides(
      referral.buyStatus ?? previousStatus,
      referral.sellStatus ?? previousStatus,
      clientType
    );
    referral.statusLastUpdated = now;

    const statusAuditEntry: Record<string, unknown> = {
      actorRole: session.user.role,
      field: 'status',
      previousValue: previousStatus,
      newValue: referral.status,
      timestamp: now,
    };
    if (auditActorId) {
      statusAuditEntry.actorId = auditActorId;
    }
    referral.audit.push(statusAuditEntry as any);

    const sla = (referral.sla ??= {} as any);
    sla.lastPairedAt = now;
    referral.markModified?.('sla');
    advancedToPaired = true;
  }

  await referral.save();

  const previousLenderDoc = previousLender
    ? await LenderMC.findById(previousLender)
        .select('name email phone')
        .lean<{ _id: Types.ObjectId; name?: string; email?: string; phone?: string }>()
    : null;
  const nextLenderDoc = await LenderMC.findById(parsed.data.lenderId)
    .select('name email phone')
    .lean<{ _id: Types.ObjectId; name?: string; email?: string; phone?: string }>();

  const previousLabel = previousLenderDoc?.name?.trim() || 'Pending';
  const nextLabel = nextLenderDoc?.name?.trim() || 'Pending';
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

  const lenderEmail = nextLenderDoc?.email?.trim();
  const lenderPhone = nextLenderDoc?.phone?.trim();
  const mcName = nextLenderDoc?.name?.trim() || 'a mortgage consultant';

  // Check if any attached agent has AGIT designation - skip MC notification if so
  const hasAgitAgent =
    (referral.assignedAgent as any)?.ahaDesignation === 'AGIT' ||
    (referral.buySideAgent as any)?.ahaDesignation === 'AGIT' ||
    (referral.sellSideAgent as any)?.ahaDesignation === 'AGIT';

  const shouldNotifyMc = referral.origin === 'agent' && !hasAgitAgent;
  const borrowerName = referral.borrower?.name?.trim() || 'your referral';
  const referralLink = buildReferralLink(referral._id.toString());
  const agentContact = referral.assignedAgent as
    | { name?: string; email?: string; phone?: string }
    | null
    | undefined;
  const agentName = typeof agentContact?.name === 'string' ? agentContact.name.trim() : '';
  const agentEmail = typeof agentContact?.email === 'string' ? agentContact.email.trim() : '';
  const agentPhone = typeof agentContact?.phone === 'string' ? agentContact.phone.trim() : '';

  if (isNewAssignment && lenderEmail && shouldNotifyMc && isTransactionalEmailConfigured()) {
    const borrowerEmail = referral.borrower?.email?.trim();
    const borrowerPhone = referral.borrower?.phone?.trim();

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

  // Notify the referring agent when an admin assigns the MC
  if (
    isNewAssignment &&
    referral.origin === 'agent' &&
    agentEmail &&
    isTransactionalEmailConfigured()
  ) {
    const mcLines = [
      mcName,
      lenderEmail ? `Email: ${lenderEmail}` : null,
      lenderPhone ? `Phone: ${lenderPhone}` : null,
    ].filter(Boolean) as string[];

    const greeting = agentName || 'there';
    const html = `
      <p>Hi ${greeting},</p>
      <p>Thank you so much for referring <strong>${borrowerName}</strong> — we really appreciate you trusting us with your client.</p>
      <p>We've paired them with <strong>${mcName}</strong>, who will take great care of them as their mortgage consultant. Here's how to reach them:</p>
      <p>${mcLines.join('<br />')}</p>
      <p><a href="${referralLink}">View the referral</a></p>
      <p>Thanks again for the referral!</p>
    `;
    const text = `Hi ${greeting},

Thank you so much for referring ${borrowerName} — we really appreciate you trusting us with your client.

We've paired them with ${mcName}, who will take great care of them as their mortgage consultant. Here's how to reach them:

${mcLines.join('\n')}

View the referral: ${referralLink}

Thanks again for the referral!`;

    try {
      await sendTransactionalEmail({
        to: [agentEmail],
        subject: `Thanks for your referral — ${mcName} is on it for ${borrowerName}`,
        html,
        text,
      });
    } catch (error) {
      console.error('Failed to deliver agent MC assignment email', error);
    }
  }

  if (advancedToPaired) {
    await generateAndReconcileAdminTasks({
      referralId: referral._id.toString(),
      trigger: 'referral.status_changed',
      actorId: session.user.id,
    }).catch((error) => {
      console.error('[Admin Tasks] Failed to reconcile tasks after MC assign Paired advance:', error);
    });
  }

  return NextResponse.json({
    id: referral._id.toString(),
    status: referral.status,
  });
}
