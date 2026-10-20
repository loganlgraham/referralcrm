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
import {
  renderAgentMcAssignmentThankYouEmail,
  renderMcAssignmentEmail,
} from '@/lib/email-templates/referral-ops';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import {
  deriveReferralStatusFromSides,
  pickPrimarySideForReferral,
} from '@/lib/server/referral-sides';
import { formatPhoneNumber } from '@/utils/formatters';

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
    const rendered = renderMcAssignmentEmail({
      greetingName,
      borrowerLines,
      agentLines,
      referralLink,
    });

    try {
      await sendTransactionalEmail({
        to: [lenderEmail],
        subject: `New referral: ${borrowerName}`,
        html: rendered.html,
        text: rendered.text,
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
    const formattedLenderPhone = formatPhoneNumber(lenderPhone);
    const mcLines = [
      mcName,
      lenderEmail ? `Email: ${lenderEmail}` : null,
      formattedLenderPhone ? `Phone: ${formattedLenderPhone}` : null,
    ].filter(Boolean) as string[];

    const greeting = agentName || 'there';
    const rendered = renderAgentMcAssignmentThankYouEmail({
      greeting,
      borrowerName,
      mcName,
      mcLines,
      referralLink,
    });

    try {
      await sendTransactionalEmail({
        to: [agentEmail],
        subject: `Thanks for your referral — ${mcName} is on it for ${borrowerName}`,
        html: rendered.html,
        text: rendered.text,
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
