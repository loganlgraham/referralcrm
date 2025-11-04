import { Metadata } from 'next';
import { Suspense } from 'react';
import { KPICards } from '@/components/charts/kpi-cards';
import { Leaderboards } from '@/components/charts/leaderboards';

export const metadata: Metadata = {
  title: 'Dashboard | Referral CRM'
};

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <Suspense fallback={<div>Loading metrics…</div>}>
        <KPICards />
      </Suspense>
      <Suspense fallback={<div>Loading leaderboards…</div>}>
        <Leaderboards />
      </Suspense>
    </div>
  );
}
