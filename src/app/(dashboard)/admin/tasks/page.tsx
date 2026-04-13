export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { classifyDueDayBucket } from '@/lib/admin-task-day';
import { connectMongo } from '@/lib/mongoose';
import { AdminTask, getEffectiveDueDate, type AdminTaskLean } from '@/models/admin-task';
import { AdminTaskBoard } from '@/components/admin/admin-task-board';

export const metadata: Metadata = {
  title: 'Admin Tasks | Referral CRM',
};

export default async function AdminTasksPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    redirect('/referrals');
  }

  await connectMongo();
  const tasks = await AdminTask.find({ status: 'open' })
    .select('dueAt dueAtOverride snoozedUntil status')
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin Tasks</h1>
          <p className="text-sm text-slate-500">
            Shared tasks across all referrals. All admins see the same task state.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
            Due today: {dueTodayCount}
          </span>
          <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700 shadow-sm">
            Overdue: {overdueCount}
          </span>
        </div>
      </div>
      <AdminTaskBoard />
    </div>
  );
}
