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
  const assignmentSide = parsed.data.side ?? (referral.clientType === 'Seller' ? 'sell' : 'buy');
  const previousAgentValue = (() => {
    if (assignmentSide === 'sell') return (referral.sellSideAgent as any)?._id ?? referral.sellSideAgent ?? null;
    return (referral.buySideAgent as any)?._id ?? referral.buySideAgent ?? null;
  })();
  const previousAgent = previousAgentValue ? previousAgentValue.toString() : null;
  if (assignmentSide === 'sell') {
    referral.sellSideAgent = parsed.data.agentId as any;
  } else {
    referral.buySideAgent = parsed.data.agentId as any;
  }
  referral.assignedAgent = referral.buySideAgent ?? referral.sellSideAgent ?? null;
  referral.statusLastUpdated = new Date();
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
  await referral.save();

  type AgentNameLean = { _id: Types.ObjectId; name?: string | null };

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

  return NextResponse.json({ id: referral._id.toString() });
}
