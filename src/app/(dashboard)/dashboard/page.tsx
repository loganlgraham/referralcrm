import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Dashboard | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getCurrentSession();

  if (session?.user?.role !== 'admin') {
    redirect('/referrals');
  }

  return (
    <div className="space-y-8">
      <DashboardTabs />
    </div>
  );
}
