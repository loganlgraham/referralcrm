import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTask, toFollowUpTaskResponse, type FollowUpTaskLean } from '@/models/follow-up-task';
import { Referral } from '@/models/referral';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';

interface Params {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await connectMongo();

  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
    .populate('lender', 'userId');

  if (!referral || referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canViewReferral(session, {
      assignedAgent: referral.assignedAgent,
      buySideAgent: referral.buySideAgent,
      sellSideAgent: referral.sellSideAgent,
      lender: referral.lender,
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get('includeArchived') === 'true';
  const includeCompleted = searchParams.get('includeCompleted') !== 'false'; // Default true

  // Build status filter
  const statusFilter: string[] = ['open'];
  if (includeCompleted) {
    statusFilter.push('completed');
  }
  if (includeArchived) {
    statusFilter.push('archived');
  }

  const tasks = await FollowUpTask.find({
    referralId: params.id,
    status: { $in: statusFilter },
  })
    .sort({ dueAt: 1, createdAt: 1 })
    .lean<FollowUpTaskLean[]>();

  const response = tasks.map(toFollowUpTaskResponse);

  return NextResponse.json(response);
}
