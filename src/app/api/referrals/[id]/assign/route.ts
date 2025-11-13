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
    .populate('lender', 'userId');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!canManageReferral(session, { assignedAgent: referral.assignedAgent, lender: referral.lender, org: referral.org })) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const previousAgentValue = (referral.assignedAgent as any)?._id ?? referral.assignedAgent ?? null;
  const previousAgent = previousAgentValue ? previousAgentValue.toString() : null;
  referral.assignedAgent = parsed.data.agentId as any;
  referral.statusLastUpdated = new Date();
  referral.audit = referral.audit || [];
  const auditEntry: Record<string, unknown> = {
    actorRole: session.user.role,
    field: 'assignedAgent',
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
      ? `Reassigned agent from ${previousLabel} to ${nextLabel}`
      : previousAgent
      ? `Confirmed agent assignment for ${nextLabel}`
      : `Assigned agent ${nextLabel}`;

  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: auditActorId ?? session.user.id,
    channel: 'update',
    content: activityContent,
  });

  return NextResponse.json({ id: referral._id.toString() });
}
