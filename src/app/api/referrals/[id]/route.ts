import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral, ReferralDocument } from '@/models/referral';
import { Payment } from '@/models/payment';
import { updateReferralSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';

interface RouteContext {
  params: { id: string };
}

const DETAIL_FIELD_LABELS = {
  source: 'Source',
  endorser: 'Endorser',
  clientType: 'Client Type',
  lookingInZip: 'Looking In (Zip)',
  borrowerCurrentAddress: 'Borrower Current Address',
  stageOnTransfer: 'Stage on Transfer',
  initialNotes: 'Notes',
  loanFileNumber: 'Loan File #',
} as const;

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById<ReferralDocument>(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId')
    .lean();
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, {
    assignedAgent: referral.assignedAgent,
    lender: referral.lender,
    org: referral.org
  })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.json(referral);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = updateReferralSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const existing = await Referral.findById(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId');
  if (!existing) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (existing.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canManageReferral(session, { assignedAgent: existing.assignedAgent, lender: existing.lender, org: existing.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const updatePayload = parsed.data as Record<string, unknown>;
  const detailFieldKeys = Object.keys(DETAIL_FIELD_LABELS) as (keyof typeof DETAIL_FIELD_LABELS)[];
  const toComparableString = (value: unknown) => {
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return String(value);
  };

  const changedDetailFields = detailFieldKeys.filter((field) => {
    if (!(field in updatePayload)) {
      return false;
    }
    const nextValue = toComparableString(updatePayload[field]);
    const previousValue = toComparableString((existing as Record<string, unknown>)[field]);
    return previousValue !== nextValue;
  });

  let referral;
  const auditActorId = resolveAuditActorId(session.user.id);
  try {
    const auditEntry: Record<string, unknown> = {
      actorRole: session.user.role,
      field: 'update',
      previousValue: null,
      newValue: parsed.data,
      timestamp: new Date()
    };

    if (auditActorId) {
      auditEntry.actorId = auditActorId;
    }

    referral = await Referral.findByIdAndUpdate(
      context.params.id,
      {
        ...parsed.data,
        $push: {
          audit: auditEntry
        }
      },
      { new: true }
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: 'Loan file number must be unique' }, { status: 409 });
    }
    throw error;
  }

  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (changedDetailFields.length > 0) {
    const updatedFieldsLabel = changedDetailFields
      .map((field) => DETAIL_FIELD_LABELS[field])
      .join(', ');
    await logReferralActivity({
      referralId: existing._id,
      actorRole: session.user.role,
      actorId: auditActorId ?? session.user.id,
      channel: 'update',
      content: `Updated referral details (${updatedFieldsLabel})`,
    });
  }

  return NextResponse.json(referral);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canViewReferral(session, { assignedAgent: referral.assignedAgent, lender: referral.lender, org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  await Payment.deleteMany({ referralId: referral._id });
  await Referral.findByIdAndUpdate(context.params.id, { deletedAt: new Date() });

  const auditActorId = resolveAuditActorId(session.user.id);
  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: auditActorId ?? session.user.id,
    channel: 'update',
    content: 'Archived referral',
  });
  return new NextResponse(null, { status: 204 });
}
