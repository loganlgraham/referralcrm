import { differenceInMinutes } from 'date-fns';
import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { assignAgentSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { resolveAuditActorId } from '@/lib/server/audit';
import { logReferralActivity } from '@/lib/server/activities';
import { Agent } from '@/models/agent';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = assignAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId name')
    .populate('buySideAgent', 'userId name')
    .populate('sellSideAgent', 'userId name')
    .populate('lender', 'userId');
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
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const normalizedClientType = (() => {
    const raw = typeof referral.clientType === 'string' ? referral.clientType.trim().toLowerCase() : '';
    if (raw === 'seller') return 'Seller' as const;
    if (raw === 'buyer') return 'Buyer' as const;
    if (
      raw === 'both' ||
      raw === 'buyer & seller' ||
      raw === 'buyer and seller' ||
      raw === 'buying and selling' ||
      raw === 'buying & selling' ||
      raw === 'buy/sell'
    ) {
      return 'Both' as const;
    }

    if (raw.includes('buy') && raw.includes('sell')) {
      return 'Both' as const;
    }

    return null;
  })();

  const assignmentSide = parsed.data.side ?? (normalizedClientType === 'Seller' ? 'sell' : 'buy');
  const previousAgentValue = (() => {
    if (assignmentSide === 'sell') return (referral.sellSideAgent as any)?._id ?? referral.sellSideAgent ?? null;
    return (referral.buySideAgent as any)?._id ?? referral.buySideAgent ?? null;
  })();
  const previousAgent = previousAgentValue ? previousAgentValue.toString() : null;
  const previousAgentObjectId = previousAgentValue ? new Types.ObjectId(previousAgentValue) : null;
  if (assignmentSide === 'sell') {
    referral.sellSideAgent = parsed.data.agentId as any;
  } else {
    referral.buySideAgent = parsed.data.agentId as any;
  }
  referral.assignedAgent = referral.buySideAgent ?? referral.sellSideAgent ?? null;
  const sla = (referral.sla ??= {} as any);
  const createdAt = referral.createdAt instanceof Date ? referral.createdAt : new Date(referral.createdAt ?? Date.now());
  if (!Number.isNaN(createdAt.getTime()) && sla.timeToAssignmentHours == null) {
    const minutesSinceCreation = Math.max(differenceInMinutes(new Date(), createdAt), 0);
    sla.timeToAssignmentHours = Math.round((minutesSinceCreation / 60) * 10) / 10;
    referral.markModified('sla');
  }
  referral.audit = referral.audit || [];
  const auditEntry: Record<string, unknown> = {
    actorRole: session.user.role,
    field: `${assignmentSide}SideAgent`,
    previousValue: previousAgent,
    newValue: parsed.data.agentId,
    timestamp: new Date()
  };

  const auditActorId = resolveAuditActorId(session.user.id);
  if (auditActorId) {
    auditEntry.actorId = auditActorId;
  }

  referral.audit.push(auditEntry as any);

  if (previousAgentObjectId && previousAgent !== parsed.data.agentId) {
    referral.lostAssignments = referral.lostAssignments || ([] as any);
    referral.lostAssignments.push({
      agent: previousAgentObjectId,
      lostAt: new Date(),
      reason: 'reassigned'
    } as any);
    referral.markModified('lostAssignments');
  }

  await referral.save();

  type AgentNameLean = { _id: Types.ObjectId; name?: string | null; email?: string | null };

  const previousAgentPromise = previousAgent
    ? Agent.findById(previousAgent)
        .select('name')
        .lean<AgentNameLean | null>()
    : Promise.resolve<AgentNameLean | null>(null);

  const nextAgentPromise = Agent.findById(parsed.data.agentId)
    .select('name')
    .lean<AgentNameLean | null>();

  const [previousAgentDoc, nextAgentDoc] = await Promise.all([
    previousAgentPromise,
    nextAgentPromise,
  ]);

  const previousLabel = previousAgentDoc?.name?.trim() || 'Unassigned';
  const nextLabel = nextAgentDoc?.name?.trim() || 'Unassigned';
  const activityContent =
    previousAgent && previousAgent !== parsed.data.agentId
      ? `Reassigned ${assignmentSide} agent from ${previousLabel} to ${nextLabel}`
      : previousAgent
      ? `Confirmed ${assignmentSide} agent assignment for ${nextLabel}`
      : `Assigned ${assignmentSide} agent ${nextLabel}`;

  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: auditActorId ?? session.user.id,
    channel: 'update',
    content: activityContent,
  });

  generateAndReconcileAdminTasks({
    referralId: referral._id.toString(),
    trigger: 'referral.agent_assigned',
    actorId: session.user.id,
  }).catch((error) => {
    console.error('[Admin Tasks] Failed to reconcile tasks after agent assign:', error);
  });

  return NextResponse.json({ id: referral._id.toString() });
}
