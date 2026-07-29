import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
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
import { maybeNotifyAdminsOnUpdateRequestResponse } from '@/lib/server/update-request-response';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import { normalizePhoneNumber } from '@/utils/phone-utils';

interface RouteContext {
  params: { id: string };
}

const DETAIL_FIELD_LABELS = {
  borrowerFirstName: 'Borrower First Name',
  borrowerLastName: 'Borrower Last Name',
  borrowerEmail: 'Borrower Email',
  borrowerPhone: 'Borrower Phone',
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
  referralDate: 'Referral date (historical)',
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
  const canEditBorrowerContact =
    session.user.role === 'admin' ||
    session.user.role === 'manager' ||
    (session.user.role === 'agent' && existing.origin === 'agent');
  const borrowerFieldKeys = ['borrowerFirstName', 'borrowerLastName', 'borrowerEmail', 'borrowerPhone'] as const;
  const borrowerFieldUpdateRequested = borrowerFieldKeys.some((field) => field in updatePayload);
  if (borrowerFieldUpdateRequested && !canEditBorrowerContact) {
    return NextResponse.json(
      { error: 'Only admins, managers, or the creating agent can update borrower contact details' },
      { status: 403 }
    );
  }

  const nextBorrowerFirstName =
    typeof updatePayload.borrowerFirstName === 'string'
      ? updatePayload.borrowerFirstName.trim()
      : existing.borrower?.firstName?.trim() ?? '';
  const nextBorrowerLastName =
    typeof updatePayload.borrowerLastName === 'string'
      ? updatePayload.borrowerLastName.trim()
      : existing.borrower?.lastName?.trim() ?? '';

  if (borrowerFieldUpdateRequested) {
    const borrowerName =
      [nextBorrowerFirstName, nextBorrowerLastName].filter(Boolean).join(' ').trim() ||
      existing.borrower?.name?.trim() ||
      '';
    updatePayload['borrower.firstName'] = nextBorrowerFirstName;
    updatePayload['borrower.lastName'] = nextBorrowerLastName;
    updatePayload['borrower.name'] = borrowerName;
  }

  if (typeof updatePayload.borrowerEmail === 'string') {
    const nextBorrowerEmail = updatePayload.borrowerEmail.trim();
    const escapedEmail = nextBorrowerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingByEmail = await Referral.findOne({
      _id: { $ne: new Types.ObjectId(context.params.id) },
      deletedAt: null,
      'borrower.email': { $regex: new RegExp(`^${escapedEmail}$`, 'i') },
    })
      .select('_id borrower.name')
      .lean<{ _id: Types.ObjectId; borrower?: { name?: string } } | null>();
    if (existingByEmail) {
      return NextResponse.json(
        {
          error: 'A referral with this email already exists.',
          existingReferralId: existingByEmail._id.toString(),
          existingBorrowerName: existingByEmail.borrower?.name ?? '',
        },
        { status: 409 }
      );
    }
    updatePayload['borrower.email'] = nextBorrowerEmail;
  }

  if (typeof updatePayload.borrowerPhone === 'string') {
    const normalizedInputPhone = normalizePhoneNumber(updatePayload.borrowerPhone);
    if (normalizedInputPhone) {
      // Indexed lookup via borrower.phoneDigits (populated by the Referral
      // model hooks). Replaces an O(n) full collection scan.
      const duplicateByPhone = await Referral.findOne({
        _id: { $ne: new Types.ObjectId(context.params.id) },
        deletedAt: null,
        'borrower.phoneDigits': normalizedInputPhone,
      })
        .select('_id borrower.name')
        .lean<{ _id: Types.ObjectId; borrower: { name?: string | null } } | null>();

      if (duplicateByPhone) {
        return NextResponse.json(
          {
            error: 'A referral with this phone number already exists.',
            existingReferralId: duplicateByPhone._id.toString(),
            existingBorrowerName: duplicateByPhone.borrower?.name ?? '',
          },
          { status: 409 }
        );
      }
    }
    updatePayload['borrower.phone'] = updatePayload.borrowerPhone.trim();
  }

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
    // Special handling for referralDate - compare ISO strings or null
    if (field === 'referralDate') {
      const nextValue = updatePayload[field];
      const previousValue = (existing as Record<string, unknown>)[field];
      if (nextValue === null && (previousValue === null || previousValue === undefined)) return false;
      if (nextValue === null) return true;
      if (previousValue === null || previousValue === undefined) return true;
      const nextISO = nextValue instanceof Date ? nextValue.toISOString() : String(nextValue);
      const prevISO = previousValue instanceof Date ? previousValue.toISOString() : String(previousValue);
      return nextISO !== prevISO;
    }
    const nextValue = toComparableString(updatePayload[field]);
    const previousValue =
      field === 'borrowerFirstName'
        ? toComparableString(existing.borrower?.firstName ?? '')
        : field === 'borrowerLastName'
          ? toComparableString(existing.borrower?.lastName ?? '')
          : field === 'borrowerEmail'
            ? toComparableString(existing.borrower?.email ?? '')
            : field === 'borrowerPhone'
              ? toComparableString(existing.borrower?.phone ?? '')
              : toComparableString((existing as Record<string, unknown>)[field]);
    return previousValue !== nextValue;
  });

  delete updatePayload.preApprovalAmount;
  delete updatePayload.borrowerFirstName;
  delete updatePayload.borrowerLastName;
  delete updatePayload.borrowerEmail;
  delete updatePayload.borrowerPhone;

  // Handle referralDate update - only allow for admin users
  if ('referralDate' in updatePayload) {
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can update the referral date' }, { status: 403 });
    }
    const referralDateValue = updatePayload.referralDate;
    if (referralDateValue === null) {
      updatePayload.referralDate = null;
    } else if (typeof referralDateValue === 'string') {
      const parsedDate = new Date(referralDateValue);
      if (Number.isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: 'Invalid referral date format' }, { status: 422 });
      }
      updatePayload.referralDate = parsedDate;
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

    // Build update object with $set for updated fields
    const updateObject: Record<string, unknown> = {
      $push: {
        audit: auditEntry
      }
    };

    // Put all updatePayload fields in $set
    const setFields: Record<string, unknown> = { ...updatePayload };
    
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
      const duplicateError = error as { keyPattern?: Record<string, number> };
      if (duplicateError.keyPattern?.['borrower.email']) {
        return NextResponse.json({ error: 'A referral with this email already exists.' }, { status: 409 });
      }
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

    if (changedDetailFields.includes('timeline')) {
      await generateAndReconcileAdminTasks({
        referralId: existing._id.toString(),
        trigger: 'referral.timeline_changed',
        actorId: session.user.id,
      }).catch((error) => {
        console.error('[Admin Tasks] Failed to reconcile tasks after timeline change:', error);
      });
    }

    // Check if this agent action should trigger an update request response notification
    if (session.user.role === 'agent') {
      // Reload referral to get updated fields including lastUpdateRequestResponseNotifiedAt
      const updatedReferral = await Referral.findById(existing._id);
      if (updatedReferral) {
        const actorName = session.user.name || session.user.email || 'Agent';
        const updatedFieldsLabel = changedDetailFields
          .map((field) => DETAIL_FIELD_LABELS[field])
          .join(', ');
        await maybeNotifyAdminsOnUpdateRequestResponse({
          referral: {
            _id: updatedReferral._id,
            lastAutoReminderSentAt: updatedReferral.lastAutoReminderSentAt,
            lastManualReminderSentAt: updatedReferral.lastManualReminderSentAt,
            lastUpdateRequestResponseNotifiedAt: updatedReferral.lastUpdateRequestResponseNotifiedAt,
            borrower: updatedReferral.borrower,
          },
          actorRole: session.user.role,
          actorName,
          actionAt: new Date(),
          actionSummary: `updated referral details (${updatedFieldsLabel})`,
        });
      }
    }
  }

  // Ensure dates are properly serialized as ISO strings
  const referralResponse = referral.toObject ? referral.toObject() : referral;
  if (referralResponse.createdAt instanceof Date) {
    referralResponse.createdAt = referralResponse.createdAt.toISOString();
  } else if (referralResponse.createdAt && typeof referralResponse.createdAt === 'object' && 'toISOString' in referralResponse.createdAt) {
    referralResponse.createdAt = (referralResponse.createdAt as Date).toISOString();
  }
  if (referralResponse.referralDate instanceof Date) {
    referralResponse.referralDate = referralResponse.referralDate.toISOString();
  } else if (referralResponse.referralDate && typeof referralResponse.referralDate === 'object' && 'toISOString' in referralResponse.referralDate) {
    referralResponse.referralDate = (referralResponse.referralDate as Date).toISOString();
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
