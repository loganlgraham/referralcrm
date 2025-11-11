import { Metadata } from 'next';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';

export const metadata: Metadata = {
  title: 'Dashboard | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  return (
    <div className="space-y-8">
      <DashboardTabs />
    </div>
  );
}
