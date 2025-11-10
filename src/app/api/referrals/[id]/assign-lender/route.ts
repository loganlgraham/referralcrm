import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { assignLenderSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { resolveAuditActorId } from '@/lib/server/audit';

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
    .populate('lender', 'userId');
  if (!referral) {
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

  const actorId = resolveAuditActorId(session.user.id);
  if (actorId) {
    auditEntry.actorId = actorId;
  }

  referral.audit.push(auditEntry as any);
  await referral.save();

  return NextResponse.json({ id: referral._id.toString() });
}
