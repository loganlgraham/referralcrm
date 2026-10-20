export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { getAdminTaskSummary } from '@/lib/server/admin-task-summary';
import { AdminTaskBoard } from '@/components/admin/admin-task-board';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Admin Tasks | Referral CRM',
};

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

  const { overdueCount, dueTodayCount, noOpenTaskCount } = await getAdminTaskSummary('all');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Admin tasks"
        description="Shared tasks across all referrals. Every admin sees the same task state."
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
