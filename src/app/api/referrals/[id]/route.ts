import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral, ReferralDocument } from '@/models/referral';
import { Payment } from '@/models/payment';
import { updateReferralSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral, canViewReferral } from '@/lib/rbac';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';
import { DEFAULT_AGENT_COMMISSION_BPS, DEFAULT_REFERRAL_FEE_BPS } from '@/constants/referrals';
import { calculateReferralFeeDue } from '@/utils/referral';

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
  loanFileNumber: 'Loan File #',
  loanType: 'Loan Type',
  preApprovalAmount: 'Pre-approval Amount',
  timeline: 'Timeline',
  createdAt: 'Created Date',
} as const;

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const referral = await Referral.findById<ReferralDocument>(context.params.id)
    .populate('assignedAgent', 'userId')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
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
    buySideAgent: referral.buySideAgent,
    sellSideAgent: referral.sellSideAgent,
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
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
    .populate('lender', 'userId');
  if (!existing) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (existing.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (
    !canManageReferral(session, {
      assignedAgent: existing.assignedAgent,
      buySideAgent: existing.buySideAgent,
      sellSideAgent: existing.sellSideAgent,
      lender: existing.lender,
      org: existing.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const updatePayload = parsed.data as Record<string, unknown>;
  const preApprovalAmountCents =
    parsed.data.preApprovalAmount !== undefined
      ? Math.max(0, Math.round(parsed.data.preApprovalAmount * 100))
      : undefined;

  if (Array.isArray(parsed.data.lookingInZips)) {
    const uniqueZips = Array.from(
      new Set(
        parsed.data.lookingInZips
          .map((zip) => zip.trim())
          .filter((zip) => /^\d{5}$/u.test(zip))
      )
    );
    updatePayload.lookingInZips = uniqueZips;
    if (uniqueZips.length > 0) {
      updatePayload.lookingInZip = uniqueZips[0];
    }
  }
  if (preApprovalAmountCents !== undefined) {
    updatePayload.preApprovalAmountCents = preApprovalAmountCents;
    updatePayload.estPurchasePriceCents = preApprovalAmountCents;
  }
  const detailFieldKeys = Object.keys(DETAIL_FIELD_LABELS) as (keyof typeof DETAIL_FIELD_LABELS)[];
  const toComparableString = (value: unknown) => {
    if (value === undefined || value === null) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
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
    // Special handling for createdAt - compare ISO strings
    if (field === 'createdAt') {
      const nextValue = updatePayload[field];
      const previousValue = (existing as Record<string, unknown>)[field];
      if (nextValue instanceof Date && previousValue instanceof Date) {
        return nextValue.getTime() !== previousValue.getTime();
      }
      const nextISO = nextValue instanceof Date ? nextValue.toISOString() : String(nextValue);
      const prevISO = previousValue instanceof Date ? previousValue.toISOString() : String(previousValue);
      return nextISO !== prevISO;
    }
    const nextValue = toComparableString(updatePayload[field]);
    const previousValue = toComparableString((existing as Record<string, unknown>)[field]);
    return previousValue !== nextValue;
  });

  delete updatePayload.preApprovalAmount;

  // Handle createdAt update - only allow for admin users
  let createdAtDate: Date | undefined;
  if ('createdAt' in updatePayload) {
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can update the created date' }, { status: 403 });
    }
    const createdAtValue = updatePayload.createdAt;
    delete updatePayload.createdAt; // Remove from updatePayload, we'll use $set explicitly
    if (typeof createdAtValue === 'string') {
      try {
        createdAtDate = new Date(createdAtValue);
        if (Number.isNaN(createdAtDate.getTime())) {
          return NextResponse.json({ error: 'Invalid created date format' }, { status: 422 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid created date format' }, { status: 422 });
      }
    }
  }

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

    // Build update object with $set for createdAt if it was changed
    // Mongoose will automatically convert top-level fields to $set, but we use explicit $set for createdAt
    // to ensure it's definitely updated (since createdAt is a special timestamp field)
    const updateObject: Record<string, unknown> = {
      $push: {
        audit: auditEntry
      }
    };

    // Put all updatePayload fields in $set along with createdAt
    const setFields: Record<string, unknown> = { ...updatePayload };
    if (createdAtDate) {
      setFields.createdAt = createdAtDate;
    }
    
    // Only add $set if there are fields to set
    if (Object.keys(setFields).length > 0) {
      updateObject.$set = setFields;
    }

    referral = await Referral.findByIdAndUpdate(
      context.params.id,
      updateObject,
      { new: true, runValidators: false }
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

  if (preApprovalAmountCents !== undefined) {
    const commissionBasisPoints =
      typeof updatePayload.commissionBasisPoints === 'number'
        ? updatePayload.commissionBasisPoints
        : referral.commissionBasisPoints ?? DEFAULT_AGENT_COMMISSION_BPS;
    const referralFeeBasisPoints =
      typeof updatePayload.referralFeeBasisPoints === 'number'
        ? updatePayload.referralFeeBasisPoints
        : referral.referralFeeBasisPoints ?? DEFAULT_REFERRAL_FEE_BPS;

    if (!['Under Contract', 'Closed', 'Terminated', 'Lost'].includes(String(referral.status))) {
      referral.referralFeeDueCents = calculateReferralFeeDue(
        preApprovalAmountCents,
        commissionBasisPoints,
        referralFeeBasisPoints
      );
      await Payment.updateMany(
        { referralId: referral._id },
        { $set: { expectedAmountCents: referral.referralFeeDueCents ?? 0 } }
      );
    }

    referral.preApprovalAmountCents = preApprovalAmountCents;
    referral.estPurchasePriceCents = preApprovalAmountCents;
    await referral.save();
  }

  // Explicitly update createdAt on the document if it was changed
  // This is necessary because timestamps: true might prevent $set from working on createdAt
  // We use updateOne directly to bypass Mongoose's timestamp management
  if (createdAtDate) {
    await Referral.updateOne(
      { _id: context.params.id },
      { $set: { createdAt: createdAtDate } }
    );
    // Reload the referral to get the updated createdAt with populated fields
    referral = await Referral.findById(context.params.id)
      .populate('assignedAgent', 'userId')
      .populate('buySideAgent', 'userId')
      .populate('sellSideAgent', 'userId')
      .populate('lender', 'userId');
    if (!referral) {
      return new NextResponse('Not found', { status: 404 });
    }
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

  // Ensure createdAt is properly serialized as ISO string
  const referralResponse = referral.toObject ? referral.toObject() : referral;
  if (referralResponse.createdAt instanceof Date) {
    referralResponse.createdAt = referralResponse.createdAt.toISOString();
  } else if (referralResponse.createdAt && typeof referralResponse.createdAt === 'object' && 'toISOString' in referralResponse.createdAt) {
    referralResponse.createdAt = (referralResponse.createdAt as Date).toISOString();
  }

  // Verify createdAt was updated if it was in the request
  if (createdAtDate && referralResponse.createdAt) {
    const responseDate = new Date(referralResponse.createdAt);
    // Check if dates match (within 1 second tolerance for timezone/rounding)
    if (Math.abs(responseDate.getTime() - createdAtDate.getTime()) > 1000) {
      console.warn('CreatedAt update may not have persisted correctly', {
        requested: createdAtDate.toISOString(),
        returned: referralResponse.createdAt
      });
    }
  }

  return NextResponse.json(referralResponse);
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
  const agentDeletingAgentReferral = session.user.role === 'agent' && referral.origin === 'agent';
  const adminDeletingAdminReferral = session.user.role === 'admin' && referral.origin === 'admin';
  const canDelete = agentDeletingAgentReferral || adminDeletingAdminReferral;

  if (!canDelete) {
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
