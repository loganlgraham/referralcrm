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
        .select('name')
        .lean<{ _id: Types.ObjectId; name?: string }>()
    : null;
  const nextLenderDoc = await LenderMC.findById(parsed.data.lenderId)
    .select('name')
    .lean<{ _id: Types.ObjectId; name?: string }>();

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

  return NextResponse.json({ id: referral._id.toString() });
}
