import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Types } from 'mongoose';

import { Payment } from '@/models/payment';
import { paymentSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { Agent } from '@/models/agent';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';

type ReferralSummary = {
  _id: Types.ObjectId;
  borrower?: { name?: string | null } | null;
  propertyAddress?: string | null;
  lookingInZip?: string | null;
  lookingInZips?: string[] | null;
  assignedAgent?: Types.ObjectId | string | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  estPurchasePriceCents?: number | null;
  preApprovalAmountCents?: number | null;
  referralFeeDueCents?: number | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  dealSide?: 'buy' | 'sell' | null;
};

type PaymentWithReferral = {
  _id: Types.ObjectId;
  referralId: ReferralSummary | null;
  status: string;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  contractPriceCents?: number | null;
  terminatedReason?: string | null;
  agentAttribution?: string | null;
  usedAfc?: boolean | null;
  usedAssignedAgent?: boolean | null;
  invoiceDate?: Date | null;
  paidDate?: Date | null;
  createdAt?: Date | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
};

const toDate = (value?: Date | string | null): Date | null => {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const minutesBetweenDates = (start: Date | null, end: Date | null): number | null => {
  if (!start || !end) {
    return null;
  }

  const diff = end.getTime() - start.getTime();
  if (diff <= 0) {
    return 0;
  }

  return Math.round(diff / 60000);
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const role = session.user?.role;
  if (role !== 'admin' && role !== 'agent' && role !== 'manager') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const filter: Record<string, unknown> = {};

  if (role === 'agent') {
    const candidateIds: (Types.ObjectId | string)[] = [];
    if (session.user?.id && Types.ObjectId.isValid(session.user.id)) {
      candidateIds.push(new Types.ObjectId(session.user.id));
    }
    if (session.user?.id) {
      candidateIds.push(session.user.id);
    }

    const agentRecord = await Agent.findOne({ userId: session.user?.id })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>();
    if (agentRecord?._id) {
      candidateIds.push(agentRecord._id);
    }

    if (candidateIds.length === 0) {
      return NextResponse.json([]);
    }

    const referralDocs = await Referral.find({ assignedAgent: { $in: candidateIds } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();

    if (!referralDocs.length) {
      return NextResponse.json([]);
    }

    filter.referralId = { $in: referralDocs.map((doc) => doc._id) };
  }

  const payments = await Payment.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate<{ referralId: ReferralSummary }>({
      path: 'referralId',
      select:
        'borrower propertyAddress lookingInZip lookingInZips assignedAgent commissionBasisPoints referralFeeBasisPoints estPurchasePriceCents preApprovalAmountCents referralFeeDueCents ahaBucket loanFileNumber',
    })
    .lean<PaymentWithReferral[]>();

  const agentNameMap = new Map<string, string>();
  const assignedAgentIds = new Set<string>();

  payments.forEach((payment) => {
    const referral = payment.referralId as ReferralSummary | null;
    const assignedAgent = referral?.assignedAgent;
    if (assignedAgent) {
      const id =
        typeof assignedAgent === 'string'
          ? assignedAgent
          : assignedAgent instanceof Types.ObjectId
          ? assignedAgent.toString()
          : '';
      if (id && !assignedAgentIds.has(id)) {
        assignedAgentIds.add(id);
      }
    }
  });

  if (assignedAgentIds.size > 0) {
    const agentObjectIds: Types.ObjectId[] = [];
    assignedAgentIds.forEach((id) => {
      if (Types.ObjectId.isValid(id)) {
        agentObjectIds.push(new Types.ObjectId(id));
      }
    });

    if (agentObjectIds.length > 0) {
      const agentDocs = await Agent.find({ _id: { $in: agentObjectIds } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name?: string | null }[]>();

      agentDocs.forEach((agent) => {
        agentNameMap.set(agent._id.toString(), agent.name ?? '');
      });
    }
  }

  const serialized = payments.map((payment) => {
    const referral = payment.referralId ?? null;
    const fallbackReferralId = (payment as any).referralId;
    const referralId = referral?._id?.toString?.() ??
      (fallbackReferralId instanceof Types.ObjectId ? fallbackReferralId.toString() : '');
    const assignedAgentId = referral?.assignedAgent
      ? typeof referral.assignedAgent === 'string'
        ? referral.assignedAgent
        : referral.assignedAgent?.toString?.() ?? null
      : null;

    return {
      _id: payment._id.toString(),
      referralId,
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      contractPriceCents: payment.contractPriceCents ?? null,
      terminatedReason: payment.terminatedReason ?? null,
      agentAttribution: payment.agentAttribution ?? null,
      usedAfc: Boolean(payment.usedAfc),
      usedAssignedAgent: Boolean(payment.usedAssignedAgent),
      invoiceDate: payment.invoiceDate ? payment.invoiceDate.toISOString() : null,
      paidDate: payment.paidDate ? payment.paidDate.toISOString() : null,
      commissionBasisPoints: payment.commissionBasisPoints ?? null,
      referralFeeBasisPoints: payment.referralFeeBasisPoints ?? null,
      side: payment.side ?? 'buy',
      agent: assignedAgentId
        ? {
            id: assignedAgentId,
            name: agentNameMap.get(assignedAgentId) ?? null,
          }
        : null,
      referral: referral
        ? {
            borrowerName: referral.borrower?.name ?? null,
            propertyAddress: referral.propertyAddress ?? null,
            lookingInZip: (referral as any).lookingInZip ?? null,
            lookingInZips: Array.isArray((referral as any).lookingInZips)
              ? (referral as any).lookingInZips
              : null,
            assignedAgentId:
              typeof referral.assignedAgent === 'string'
                ? referral.assignedAgent
                : referral.assignedAgent?.toString?.() ?? null,
            commissionBasisPoints: referral.commissionBasisPoints ?? null,
            referralFeeBasisPoints: referral.referralFeeBasisPoints ?? null,
            estPurchasePriceCents: referral.estPurchasePriceCents ?? null,
            preApprovalAmountCents: referral.preApprovalAmountCents ?? null,
            referralFeeDueCents: referral.referralFeeDueCents ?? null,
            ahaBucket: (referral as any).ahaBucket ?? null,
            dealSide: (referral as any).dealSide ?? null,
            loanFileNumber: (referral as any).loanFileNumber ?? null,
          }
        : null,
    };
  });

  return NextResponse.json(serialized);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager', 'agent', 'mc'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json();
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const payment = await Payment.create({
    referralId: parsed.data.referralId,
    status: parsed.data.status,
    expectedAmountCents: parsed.data.expectedAmountCents,
    receivedAmountCents: parsed.data.receivedAmountCents,
    terminatedReason: parsed.data.terminatedReason ?? null,
    agentAttribution: parsed.data.agentAttribution ?? null,
    usedAfc: parsed.data.usedAfc ?? false,
    usedAssignedAgent: parsed.data.usedAssignedAgent ?? true,
    invoiceDate: parsed.data.invoiceDate,
    paidDate: parsed.data.paidDate,
    notes: parsed.data.notes,
    commissionBasisPoints: parsed.data.commissionBasisPoints ?? null,
    referralFeeBasisPoints: parsed.data.referralFeeBasisPoints ?? null,
    side: parsed.data.side ?? 'buy',
    contractPriceCents: parsed.data.contractPriceCents ?? null,
  });

  return NextResponse.json({ id: payment._id.toString() }, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager', 'agent', 'mc'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const parsed = paymentSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const existingPayment = await Payment.findById(body.id);
  if (!existingPayment) {
    return new NextResponse('Not found', { status: 404 });
  }

  const previousStatus = existingPayment.status;

  let nextContractPriceCents =
    parsed.data.contractPriceCents !== undefined
      ? parsed.data.contractPriceCents
      : existingPayment.contractPriceCents ?? null;
  const nextCommissionBasisPoints =
    parsed.data.commissionBasisPoints !== undefined
      ? parsed.data.commissionBasisPoints ?? null
      : existingPayment.commissionBasisPoints ?? null;
  const nextReferralFeeBasisPoints =
    parsed.data.referralFeeBasisPoints !== undefined
      ? parsed.data.referralFeeBasisPoints ?? null
      : existingPayment.referralFeeBasisPoints ?? null;
  const nextSide =
    parsed.data.side !== undefined ? parsed.data.side ?? existingPayment.side : existingPayment.side;

  let nextExpectedAmountCents = existingPayment.expectedAmountCents ?? 0;
  let nextReceivedAmountCents = existingPayment.receivedAmountCents ?? 0;
  const hasUsedAssignedAgentUpdate = Object.prototype.hasOwnProperty.call(
    parsed.data,
    'usedAssignedAgent'
  );
  const nextUsedAssignedAgent = hasUsedAssignedAgentUpdate
    ? Boolean(parsed.data.usedAssignedAgent)
    : Boolean(existingPayment.usedAssignedAgent);
  const shouldRecalculateReferralFee =
    parsed.data.expectedAmountCents === undefined &&
    (parsed.data.contractPriceCents !== undefined ||
      parsed.data.commissionBasisPoints !== undefined ||
      parsed.data.referralFeeBasisPoints !== undefined);

  if (shouldRecalculateReferralFee) {
    if (
      nextContractPriceCents != null &&
      nextCommissionBasisPoints != null &&
      nextReferralFeeBasisPoints != null
    ) {
      const computed = Math.round(
        (nextContractPriceCents * nextCommissionBasisPoints * nextReferralFeeBasisPoints) / 100_000_000
      );
      if (Number.isFinite(computed) && computed >= 0) {
        nextExpectedAmountCents = computed;
      }
    }
  } else if (parsed.data.expectedAmountCents !== undefined) {
    nextExpectedAmountCents = parsed.data.expectedAmountCents ?? nextExpectedAmountCents;
  }

  if (parsed.data.receivedAmountCents !== undefined) {
    nextReceivedAmountCents = parsed.data.receivedAmountCents ?? nextReceivedAmountCents;
  }

  if (hasUsedAssignedAgentUpdate && !nextUsedAssignedAgent) {
    nextExpectedAmountCents = 0;
    nextReceivedAmountCents = 0;
  }

  const updatePayload: Record<string, unknown> = { ...parsed.data };
  delete updatePayload.referralId;
  updatePayload.contractPriceCents = nextContractPriceCents ?? null;
  updatePayload.commissionBasisPoints = nextCommissionBasisPoints ?? null;
  updatePayload.referralFeeBasisPoints = nextReferralFeeBasisPoints ?? null;
  updatePayload.side = nextSide ?? 'buy';
  updatePayload.expectedAmountCents = nextExpectedAmountCents;
  updatePayload.receivedAmountCents = nextReceivedAmountCents;
  if (hasUsedAssignedAgentUpdate) {
    updatePayload.usedAssignedAgent = nextUsedAssignedAgent;
  }
  if ('usedAfc' in updatePayload && updatePayload.usedAfc === undefined) {
    updatePayload.usedAfc = false;
  }
  if ('usedAssignedAgent' in updatePayload && updatePayload.usedAssignedAgent === undefined) {
    updatePayload.usedAssignedAgent = false;
  }

  const payment = await Payment.findByIdAndUpdate(body.id, updatePayload, { new: true });
  if (!payment) {
    return new NextResponse('Not found', { status: 404 });
  }

  const referral = await Referral.findById(existingPayment.referralId);
  if (referral) {
    const now = new Date();
    const previousReferralStatus = referral.status ?? null;
    const sla = (referral.sla ??= {} as any);
    let slaChanged = false;
    let referralStatusChanged = false;

    if (hasUsedAssignedAgentUpdate && !nextUsedAssignedAgent) {
      referral.estPurchasePriceCents = 0;
      referral.referralFeeDueCents = 0;
      nextContractPriceCents = null;
      if (sla) {
        sla.lastUnderContractAt = null;
        sla.lastClosedAt = null;
        sla.lastPaidAt = null;
        slaChanged = true;
      }

      if (previousReferralStatus !== 'Lost') {
        const auditEntry: Record<string, unknown> = {
          actorRole: session.user.role,
          field: 'status',
          previousValue: previousReferralStatus,
          newValue: 'Lost',
          timestamp: now,
        };
        const actorId = resolveAuditActorId(session.user.id);
        if (actorId) {
          auditEntry.actorId = actorId;
        }

        referral.status = 'Lost';
        referral.statusLastUpdated = now;
        referral.audit = Array.isArray(referral.audit) ? referral.audit : [];
        referral.audit.push(auditEntry as any);
        referral.markModified('audit');
        referralStatusChanged = true;
      }

      await Payment.updateMany(
        { referralId: referral._id },
        { $set: { expectedAmountCents: 0, receivedAmountCents: 0 } }
      );
    }

    if (parsed.data.status && parsed.data.status !== previousStatus) {
      const nextStatus = parsed.data.status as string;

      if (nextStatus === 'under_contract') {
        sla.lastUnderContractAt = now;
        slaChanged = true;
      }

      if (['closed', 'payment_sent', 'paid'].includes(nextStatus)) {
        const underContractAt =
          toDate(sla.lastUnderContractAt) ??
          toDate(existingPayment.createdAt) ??
          toDate(payment.createdAt) ??
          now;
        const closedMinutes = minutesBetweenDates(underContractAt, now);
        if (closedMinutes != null) {
          sla.contractToCloseMinutes = closedMinutes;
          sla.lastClosedAt = now;
          slaChanged = true;
        }
      }

      if (nextStatus === 'paid') {
        const closedAt =
          toDate(sla.lastClosedAt) ??
          toDate(existingPayment.updatedAt) ??
          toDate(payment.updatedAt) ??
          now;
        const paidMinutes = minutesBetweenDates(closedAt, now);
        if (paidMinutes != null) {
          sla.closedToPaidMinutes = paidMinutes;
          sla.lastPaidAt = now;
          slaChanged = true;
        }
      }
    }

    if (nextContractPriceCents != null) {
      referral.estPurchasePriceCents = nextContractPriceCents;
    }
    if (nextCommissionBasisPoints != null) {
      referral.commissionBasisPoints = nextCommissionBasisPoints;
    }
    if (nextReferralFeeBasisPoints != null) {
      referral.referralFeeBasisPoints = nextReferralFeeBasisPoints;
    }
    if (nextSide) {
      referral.dealSide = nextSide;
    }
    referral.referralFeeDueCents = nextExpectedAmountCents;
    if (slaChanged) {
      referral.markModified('sla');
    }
    await referral.save();

    if (referralStatusChanged && previousReferralStatus !== referral.status) {
      await logReferralActivity({
        referralId: referral._id,
        actorRole: session.user.role,
        actorId: session.user.id,
        channel: 'status',
        content: `Status changed from ${previousReferralStatus ?? 'Unknown'} to ${referral.status}`,
      });
    }
  }

  if (
    parsed.data.status === 'payment_sent' &&
    previousStatus !== 'payment_sent' &&
    session.user.role === 'agent' &&
    isTransactionalEmailConfigured()
  ) {
    const adminUsers = await User.find({ role: 'admin', email: { $ne: null } })
      .select('name email')
      .lean<{ name?: string | null; email?: string | null }[]>();
    const adminEmails = adminUsers
      .map((user) => (typeof user.email === 'string' && user.email ? user.email : null))
      .filter((email): email is string => Boolean(email));

    if (adminEmails.length > 0) {
      const referral = await Referral.findById(existingPayment.referralId)
        .select('borrower referralFeeDueCents')
        .lean<Pick<ReferralSummary, '_id' | 'borrower' | 'referralFeeDueCents'> | null>();
      const borrowerName = referral?.borrower?.name ?? 'a referral client';
      const amountCents = payment.expectedAmountCents ?? referral?.referralFeeDueCents ?? 0;
      const formattedAmount = amountCents
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100)
        : 'the referral fee';
      const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
      const referralLink = referral && baseUrl ? `${baseUrl}/referrals/${referral._id.toString()}` : null;
      const agentName = session.user.name ?? 'An agent';

      const textBody = [
        `${agentName} marked the referral fee as Payment Sent for ${borrowerName}.`,
        `Amount: ${formattedAmount}.`,
        referralLink ? `View the referral: ${referralLink}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const htmlBody = `
        <p>${agentName} marked the referral fee as <strong>Payment Sent</strong> for ${borrowerName}.</p>
        <p>Amount: <strong>${formattedAmount}</strong></p>
        ${referralLink ? `<p><a href="${referralLink}" style="color:#2563eb;">View referral details</a></p>` : ''}
      `;

      await sendTransactionalEmail({
        to: adminEmails,
        subject: `${agentName} sent a referral payment for ${borrowerName}`,
        text: textBody,
        html: htmlBody,
      });
    }
  }

  return NextResponse.json({ id: payment._id.toString() });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager', 'agent', 'mc'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request
    .json()
    .catch(() => null) as { id?: string } | null;
  const id = body?.id ?? request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  await connectMongo();
  const payment = await Payment.findById(id);
  if (!payment) {
    return new NextResponse('Not found', { status: 404 });
  }

  await payment.deleteOne();

  return NextResponse.json({ id });
}
