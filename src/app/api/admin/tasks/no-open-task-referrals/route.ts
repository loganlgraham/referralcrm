import { NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { AdminTask } from '@/models/admin-task';
import { Referral } from '@/models/referral';

export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

// Referral-model terminal statuses — referrals in these states no longer need
// follow-up tasks, so they are excluded from the "no open tasks" call list.
const TERMINAL_REFERRAL_STATUS_KEYS = new Set<string>(['closed', 'lost', 'terminated']);

function normalizeStatusKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export interface NoOpenTaskReferralEntry {
  id: string;
  borrowerName: string;
  status: string;
  agentName: string | null;
  mcName: string | null;
  lastActivityAt: string | null;
}

interface PopulatedNameRef {
  name?: string;
}

interface ReferralLeanRow {
  _id: { toString: () => string };
  borrower?: { name?: string };
  status?: string;
  assignedAgent?: PopulatedNameRef | null;
  lender?: PopulatedNameRef | null;
  updatedAt?: Date;
  referralDate?: Date | null;
  createdAt?: Date;
}

export async function GET(): Promise<NextResponse> {
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
    .select('borrower.name status assignedAgent lender updatedAt referralDate createdAt')
    .lean<ReferralLeanRow[]>();

  const entries: NoOpenTaskReferralEntry[] = referrals
    .filter((referral) => {
      if (TERMINAL_REFERRAL_STATUS_KEYS.has(normalizeStatusKey(referral.status))) return false;
      return !openTaskReferralIds.has(referral._id.toString());
    })
    .map((referral) => {
      const lastActivityAt = referral.updatedAt ?? referral.referralDate ?? referral.createdAt;
      return {
        id: referral._id.toString(),
        borrowerName: referral.borrower?.name ?? 'Unknown',
        status: referral.status ?? 'New Lead',
        agentName: referral.assignedAgent?.name ?? null,
        mcName: referral.lender?.name ?? null,
        lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  return NextResponse.json(entries, { headers: NO_CACHE_HEADERS });
}
