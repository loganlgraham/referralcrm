import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Types } from 'mongoose';

import { Payment } from '@/models/payment';
import { paymentSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { Agent } from '@/models/agent';
import { Referral } from '@/models/referral';

type ReferralSummary = {
  _id: Types.ObjectId;
  borrower?: { name?: string | null } | null;
  propertyAddress?: string | null;
  lookingInZip?: string | null;
  assignedAgent?: Types.ObjectId | string | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  estPurchasePriceCents?: number | null;
  preApprovalAmountCents?: number | null;
  referralFeeDueCents?: number | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
};

type PaymentWithReferral = {
  _id: Types.ObjectId;
  referralId: ReferralSummary | null;
  status: string;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  terminatedReason?: string | null;
  agentAttribution?: string | null;
  usedAfc?: boolean | null;
  invoiceDate?: Date | null;
  paidDate?: Date | null;
  createdAt?: Date | null;
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
        'borrower propertyAddress lookingInZip assignedAgent commissionBasisPoints referralFeeBasisPoints estPurchasePriceCents preApprovalAmountCents referralFeeDueCents ahaBucket',
    })
    .lean<PaymentWithReferral[]>();

  const serialized = payments.map((payment) => {
    const referral = payment.referralId ?? null;
    const fallbackReferralId = (payment as any).referralId;
    const referralId = referral?._id?.toString?.() ??
      (fallbackReferralId instanceof Types.ObjectId ? fallbackReferralId.toString() : '');

    return {
      _id: payment._id.toString(),
      referralId,
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      terminatedReason: payment.terminatedReason ?? null,
      agentAttribution: payment.agentAttribution ?? null,
      usedAfc: Boolean(payment.usedAfc),
      invoiceDate: payment.invoiceDate ? payment.invoiceDate.toISOString() : null,
      paidDate: payment.paidDate ? payment.paidDate.toISOString() : null,
      referral: referral
        ? {
            borrowerName: referral.borrower?.name ?? null,
            propertyAddress: referral.propertyAddress ?? null,
            lookingInZip: (referral as any).lookingInZip ?? null,
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
    invoiceDate: parsed.data.invoiceDate,
    paidDate: parsed.data.paidDate,
    notes: parsed.data.notes
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
  const updatePayload: Record<string, unknown> = { ...parsed.data };
  delete updatePayload.referralId;
  if ('usedAfc' in updatePayload && updatePayload.usedAfc === undefined) {
    updatePayload.usedAfc = false;
  }
  const payment = await Payment.findByIdAndUpdate(body.id, updatePayload, { new: true });
  if (!payment) {
    return new NextResponse('Not found', { status: 404 });
  }

  return NextResponse.json({ id: payment._id.toString() });
}
