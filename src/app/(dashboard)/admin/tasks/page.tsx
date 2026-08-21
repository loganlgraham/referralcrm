export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { classifyDueDayBucket } from '@/lib/admin-task-day';
import { connectMongo } from '@/lib/mongoose';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';
import { Referral } from '@/models/referral';
import { AdminTaskBoard } from '@/components/admin/admin-task-board';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Admin Tasks | Referral CRM',
};

// Referrals in these states no longer need follow-up tasks.
const TERMINAL_REFERRAL_STATUSES = ['Closed', 'Lost', 'Terminated'];

function BoardFallback() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-12 rounded-card" />
      <Skeleton className="h-48 rounded-card" />
    </div>
  );
}

export default async function AdminTasksPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    redirect('/referrals');
  }

  await connectMongo();
  const tasks = await AdminTask.find({ status: 'open' })
    .select('referralId dueAt dueAtOverride snoozedUntil status')
    .lean<AdminTaskLean[]>();

  const { dueTodayCount, overdueCount } = tasks.reduce((acc, task) => {
    const effectiveDue = getEffectiveDueDate(task);
    if (!effectiveDue) return acc;

    const bucket = classifyDueDayBucket(effectiveDue);
    if (bucket === 'today') {
      acc.dueTodayCount += 1;
    } else if (bucket === 'overdue') {
      acc.overdueCount += 1;
    }

    return acc;
  }, { dueTodayCount: 0, overdueCount: 0 });

  const openTaskReferralIds = [
    ...new Set(
      tasks
        .map((task) => task.referralId?.toString())
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const noOpenTaskCount = await Referral.countDocuments({
    deletedAt: null,
    status: { $nin: TERMINAL_REFERRAL_STATUSES },
    _id: { $nin: openTaskReferralIds.map((id) => new Types.ObjectId(id)) },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Admin tasks"
        description="Shared tasks across all referrals. Every admin sees the same task state."
        attention={overdueCount > 0}
      />
      <Suspense fallback={<BoardFallback />}>
        <AdminTaskBoard
          overdueCount={overdueCount}
          dueTodayCount={dueTodayCount}
          noOpenTaskCount={noOpenTaskCount}
        />
      </Suspense>
    </div>
  );
}
