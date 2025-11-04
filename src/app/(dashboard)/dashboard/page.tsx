import { Metadata } from 'next';
import { KPICards } from '@/components/charts/kpi-cards';
import { Leaderboards } from '@/components/charts/leaderboards';

export const metadata: Metadata = {
  title: 'Dashboard | Referral CRM'
};

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <KPICards />
      <Leaderboards />
    </div>
  );
}
