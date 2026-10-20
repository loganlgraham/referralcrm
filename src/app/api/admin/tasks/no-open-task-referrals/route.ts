import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { isTerminalReferralStatus } from '@/constants/referrals';
import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { loadReferralDesignationMap } from '@/lib/server/referral-networks';
import { parseTaskNetwork, referralMatchesTaskNetwork } from '@/lib/task-network';
import { AdminTask } from '@/models/admin-task';
import { Referral } from '@/models/referral';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

export interface NoOpenTaskReferralEntry {
  id: string;
  borrowerName: string;
  status: string;
  agentName: string | null;
  mcName: string | null;
  lastActivityAt: string | null;
  lastTaskTitle: string | null;
}

interface PopulatedNameRef {
  name?: string;
}

interface LatestCompletedTask {
  _id: { toString(): string };
  title?: string;
}

interface ReferralLeanRow {
  _id: { toString: () => string };
  borrower?: { name?: string };
  status?: string;
  assignedAgent?: PopulatedNameRef | null;
  buySideAgent?: unknown;
  sellSideAgent?: unknown;
  lender?: PopulatedNameRef | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  org?: string | null;
  updatedAt?: Date;
  referralDate?: Date | null;
  createdAt?: Date;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as {
      status?: number;
      message?: string;
    };
    return new NextResponse(message, { status });
  }

  await connectMongo();

  const network = parseTaskNetwork(new URL(request.url).searchParams.get('network'));

  const openTasks = await AdminTask.find({ status: 'open' })
    .select('referralId')
    .lean<{ referralId?: { toString: () => string } }[]>();

  const openTaskReferralIds = new Set(
    openTasks
      .map((task) => task.referralId?.toString())
      .filter((id): id is string => Boolean(id))
  );

  const referrals = await Referral.find({ deletedAt: null })
    .populate('assignedAgent', 'name')
    .populate('lender', 'name')
    .select('borrower.name status assignedAgent buySideAgent sellSideAgent lender updatedAt referralDate createdAt ahaBucket org')
    .lean<ReferralLeanRow[]>();

  const candidates = referrals.filter((referral) => {
    if (isTerminalReferralStatus(referral.status)) return false;
    return !openTaskReferralIds.has(referral._id.toString());
  });

  const designationByReferral = network === 'all'
    ? null
    : await loadReferralDesignationMap(candidates);

  const matched = designationByReferral
    ? candidates.filter((referral) =>
        referralMatchesTaskNetwork(designationByReferral.get(referral._id.toString()) ?? null, network)
      )
    : candidates;

  const matchedIds = matched.map((referral) => new Types.ObjectId(referral._id.toString()));
  const latestTasks: LatestCompletedTask[] = matchedIds.length === 0
    ? []
    : await AdminTask.aggregate<LatestCompletedTask>([
        { $match: { status: 'completed', referralId: { $in: matchedIds } } },
        { $sort: { completedAt: -1, updatedAt: -1 } },
        { $group: { _id: '$referralId', title: { $first: '$title' } } },
      ]);

  const titleByReferral = new Map(
    latestTasks.map((row) => [row._id.toString(), row.title?.trim() ? row.title : null])
  );

  const entries: NoOpenTaskReferralEntry[] = matched
    .map((referral) => {
      const lastActivityAt = referral.updatedAt ?? referral.referralDate ?? referral.createdAt;
      const id = referral._id.toString();
      return {
        id,
        borrowerName: referral.borrower?.name ?? 'Unknown',
        status: referral.status ?? 'New Lead',
        agentName: referral.assignedAgent?.name ?? null,
        mcName: referral.lender?.name ?? null,
        lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
        lastTaskTitle: titleByReferral.get(id) ?? null,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  return NextResponse.json(entries, { headers: NO_CACHE_HEADERS });
}
