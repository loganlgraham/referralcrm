export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { AdminTaskBoard } from '@/components/admin/admin-task-board';

export const metadata: Metadata = {
  title: 'Admin Tasks | Referral CRM',
};

export default async function AdminTasksPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    redirect('/referrals');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin Tasks</h1>
          <p className="text-sm text-slate-500">
            Shared tasks across all referrals. All admins see the same task state.
          </p>
        </div>
      </div>
      <AdminTaskBoard />
    </div>
  );
}
